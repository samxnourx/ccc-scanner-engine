import dotenv from "dotenv";

dotenv.config({ path: ".env.local", override: true });
dotenv.config();

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SOURCE = "ca_sco";
const DEFAULT_MIN_AMOUNT = 5000;
const DEFAULT_LIMIT = 5000;
const DEFAULT_PREFIX_DEPTH = 2;

function argValue(name: string): string | null {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === name && args[i + 1]) return args[i + 1]!;
    if (a.startsWith(`${name}=`)) return a.slice(name.length + 1);
  }
  return null;
}

function flag(name: string): boolean {
  return process.argv.slice(2).includes(name);
}

function parsePositiveNumber(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function prefixes(depth: number): string[] {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789".split("");
  let out = [""];
  for (let i = 0; i < depth; i++) {
    out = out.flatMap((prefix) => chars.map((char) => `${prefix}${char}`));
  }
  return out;
}

function nextPrefix(prefix: string): string {
  if (!prefix) return "\uffff";
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const arr = prefix.split("");
  for (let i = arr.length - 1; i >= 0; i--) {
    const idx = chars.indexOf(arr[i]!);
    if (idx >= 0 && idx < chars.length - 1) {
      arr[i] = chars[idx + 1]!;
      return arr.slice(0, i + 1).join("");
    }
  }
  return `${prefix}\uffff`;
}

async function ensureTable(): Promise<void> {
  await prisma.$queryRawUnsafe(`PRAGMA busy_timeout = 60000`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS scanner_prospects (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      owner_name_normalized TEXT NOT NULL,
      display_name TEXT NOT NULL,
      total_amount REAL NOT NULL,
      property_count INTEGER NOT NULL,
      city_count INTEGER NOT NULL,
      address_count INTEGER NOT NULL,
      cities_json TEXT NOT NULL,
      addresses_json TEXT NOT NULL,
      sample_matches_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      contact_emails_json TEXT,
      contact_phone TEXT,
      contact_website TEXT,
      outreach_email_to TEXT,
      outreach_email_subject TEXT,
      outreach_email_text TEXT,
      outreach_portal_url TEXT,
      outreach_intake_id TEXT,
      outreach_sent_at DATETIME,
      built_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source, owner_name_normalized)
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS scanner_prospects_total_amount_idx
    ON scanner_prospects(total_amount DESC)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS scanner_prospects_status_total_idx
    ON scanner_prospects(status, total_amount DESC)
  `);
}

function businessLikeSql(): string {
  return `
    (
      owner_name LIKE '% INC%' OR owner_name LIKE '% LLC%' OR owner_name LIKE '% LLP%' OR owner_name LIKE '% LP%' OR
      owner_name LIKE '% CORP%' OR owner_name LIKE '% COMPANY%' OR owner_name LIKE '% CO %' OR owner_name LIKE '% LTD%' OR
      owner_name LIKE '% MEDICAL%' OR owner_name LIKE '% DENTAL%' OR owner_name LIKE '% HEALTH%' OR owner_name LIKE '% PHARM%' OR
      owner_name LIKE '% CLINIC%' OR owner_name LIKE '% CENTER%' OR owner_name LIKE '% GROUP%' OR owner_name LIKE '% HOSPITAL%' OR
      owner_name LIKE '% BANK%' OR owner_name LIKE '% CREDIT UNION%' OR owner_name LIKE '% INSURANCE%' OR
      owner_name LIKE '% RESTAURANT%' OR owner_name LIKE '% AUTO%' OR owner_name LIKE '% MARKET%' OR owner_name LIKE '% STORE%' OR
      owner_name LIKE '% SCHOOL%' OR owner_name LIKE '% CHURCH%' OR owner_name LIKE '% FOUNDATION%' OR owner_name LIKE '% ASSOCIATION%'
    )
  `;
}

type Candidate = {
  ownerNameNormalized: string;
  displayName: string;
  propertyCount: number | bigint;
  totalAmount: number;
  cityCount: number | bigint;
  addressCount: number | bigint;
};

type SampleRow = {
  sourceName: string;
  reportedOwnerName: string;
  holderName: string;
  propertyId: string;
  amount: string | null;
  reportedAddress: string;
  accountType: string | null;
  confidence: string;
  city: string | null;
  address: string | null;
};

async function main(): Promise<void> {
  const minAmount = parsePositiveNumber(argValue("--min-amount"), DEFAULT_MIN_AMOUNT);
  const limit = Math.trunc(parsePositiveNumber(argValue("--limit"), DEFAULT_LIMIT));
  const prefixArg = argValue("--prefix");
  const prefixDepth = Math.trunc(
    parsePositiveNumber(argValue("--prefix-depth"), DEFAULT_PREFIX_DEPTH),
  );
  const full = flag("--full");
  const started = Date.now();

  await ensureTable();

  console.log(
    `[prospects] Building ${full ? "full" : "top"} prospect index: source=${SOURCE}, min=${minAmount}, limit=${limit}`,
  );
  console.log(
    "[prospects] This is a derived index build. The app reads scanner_prospects after this finishes.",
  );

  const chunks = prefixArg ? [prefixArg.trim().toLowerCase()] : prefixes(prefixDepth);
  const builtAt = new Date().toISOString();
  let inserted = 0;
  let chunkNumber = 0;

  for (const prefix of chunks) {
    if (!full && inserted >= limit) break;
    chunkNumber++;
    const startPrefix = prefix;
    const endPrefix = nextPrefix(prefix);
    const candidates = await prisma.$queryRawUnsafe<Candidate[]>(
      `
      WITH business_rows AS (
        SELECT
          owner_name_normalized,
          owner_name,
          address,
          city,
          CAST(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(amount,'')), '$', ''), ',', ''), ' ', '') AS REAL) AS amount_num
        FROM source_records INDEXED BY source_records_owner_name_normalized_idx
        WHERE owner_name_normalized >= ?
          AND owner_name_normalized < ?
          AND source = '${SOURCE}'
          AND amount IS NOT NULL
          AND amount <> ''
          AND CAST(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(amount,'')), '$', ''), ',', ''), ' ', '') AS REAL) > 0
          AND ${businessLikeSql()}
      )
      SELECT
        owner_name_normalized AS ownerNameNormalized,
        MIN(owner_name) AS displayName,
        COUNT(*) AS propertyCount,
        ROUND(SUM(amount_num), 2) AS totalAmount,
        COUNT(DISTINCT COALESCE(NULLIF(TRIM(city), ''), '(blank)')) AS cityCount,
        COUNT(DISTINCT COALESCE(NULLIF(TRIM(address), ''), '(blank)')) AS addressCount
      FROM business_rows
      GROUP BY owner_name_normalized
      HAVING totalAmount >= ?
         AND cityCount <= 3
         AND addressCount <= 8
      ORDER BY totalAmount DESC
      ${full ? "" : "LIMIT 100"}
      `,
      startPrefix,
      endPrefix,
      minAmount,
    );
    if (candidates.length > 0 || chunkNumber % 50 === 0) {
      console.log(
        `[prospects] Prefix ${prefix} (${chunkNumber}/${chunks.length}) candidates=${candidates.length} totalSaved=${inserted}`,
      );
    }

    for (const c of candidates) {
      if (!full && inserted >= limit) break;
    const samples = await prisma.$queryRawUnsafe<SampleRow[]>(
      `
      SELECT
        'California SCO' AS sourceName,
        owner_name AS reportedOwnerName,
        holder_name AS holderName,
        property_id AS propertyId,
        amount,
        TRIM(COALESCE(address, '') || CASE WHEN city IS NOT NULL AND city <> '' THEN ', ' || city ELSE '' END || CASE WHEN state IS NOT NULL AND state <> '' THEN ', ' || state ELSE '' END || CASE WHEN zip_code IS NOT NULL AND zip_code <> '' THEN ', ' || zip_code ELSE '' END) AS reportedAddress,
        property_type AS accountType,
        'high' AS confidence,
        city,
        address
      FROM source_records INDEXED BY source_records_owner_name_normalized_idx
      WHERE source = ?
        AND owner_name_normalized = ?
      ORDER BY CAST(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(amount,'')), '$', ''), ',', ''), ' ', '') AS REAL) DESC
      LIMIT 25
      `,
      SOURCE,
      c.ownerNameNormalized,
    );
    const cities = [...new Set(samples.map((row) => row.city?.trim()).filter(Boolean))];
    const addresses = [...new Set(samples.map((row) => row.address?.trim()).filter(Boolean))];
    const sampleMatches = samples.map((row) => ({
      sourceName: row.sourceName,
      reportedOwnerName: row.reportedOwnerName,
      holderName: row.holderName,
      propertyId: row.propertyId,
      amount: row.amount,
      reportedAddress: row.reportedAddress,
      accountType: row.accountType,
      confidence: row.confidence,
    }));
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO scanner_prospects (
        source,
        owner_name_normalized,
        display_name,
        total_amount,
        property_count,
        city_count,
        address_count,
        cities_json,
        addresses_json,
        sample_matches_json,
        status,
        built_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)
      ON CONFLICT(source, owner_name_normalized) DO UPDATE SET
        display_name = excluded.display_name,
        total_amount = excluded.total_amount,
        property_count = excluded.property_count,
        city_count = excluded.city_count,
        address_count = excluded.address_count,
        cities_json = excluded.cities_json,
        addresses_json = excluded.addresses_json,
        sample_matches_json = excluded.sample_matches_json,
        built_at = excluded.built_at
      `,
      SOURCE,
      c.ownerNameNormalized,
      c.displayName,
      Number(c.totalAmount),
      Number(c.propertyCount),
      Number(c.cityCount),
      Number(c.addressCount),
      JSON.stringify(cities),
      JSON.stringify(addresses),
      JSON.stringify(sampleMatches),
      builtAt,
    );
    inserted++;
    if (inserted % 100 === 0) {
      console.log(`[prospects] Upserted ${inserted.toLocaleString("en-US")} groups`);
    }
  }
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`[prospects] Done. Upserted ${inserted.toLocaleString("en-US")} groups in ${seconds}s`);
}

main()
  .catch((e) => {
    console.error("[prospects] Build failed", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
