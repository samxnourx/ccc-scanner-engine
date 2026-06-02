import dotenv from "dotenv";

dotenv.config({ path: ".env.local", override: true });
dotenv.config();

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SOURCE = "ca_sco";
const DEFAULT_MIN_AMOUNT = 5000;
const DEFAULT_LIMIT = 5000;

function argValue(name: string): string | null {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === name && args[i + 1]) return args[i + 1]!;
    if (a.startsWith(`${name}=`)) return a.slice(name.length + 1);
  }
  return null;
}

function parsePositiveNumber(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function ensureTable(): Promise<void> {
  await prisma.$queryRawUnsafe(`PRAGMA busy_timeout = 120000`);
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

type CandidateGroup = {
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
  amount: string | number | null;
  reportedAddress: string;
  accountType: string | null;
  confidence: string;
  city: string | null;
  address: string | null;
};

async function main(): Promise<void> {
  const source = argValue("--source") ?? SOURCE;
  const minAmount = parsePositiveNumber(argValue("--min-amount"), DEFAULT_MIN_AMOUNT);
  const limit = Math.trunc(parsePositiveNumber(argValue("--limit"), DEFAULT_LIMIT));
  const started = Date.now();
  const builtAt = new Date().toISOString();

  await ensureTable();

  const tableRows = await prisma.$queryRawUnsafe<{ name: string }[]>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'source_record_business_candidates'`,
  );
  if (tableRows.length === 0) {
    throw new Error(
      "source_record_business_candidates does not exist. Run `npm run prospects:candidates` first.",
    );
  }

  console.log(
    `[prospects:candidate-build] Building scanner_prospects from candidates: source=${source}, min=${minAmount}, limit=${limit}`,
  );
  console.log("[prospects:candidate-build] Existing saved/contact/email status is preserved on conflicts.");

  const groups = await prisma.$queryRawUnsafe<CandidateGroup[]>(
    `
    SELECT
      owner_name_normalized AS ownerNameNormalized,
      MIN(owner_name) AS displayName,
      COUNT(*) AS propertyCount,
      ROUND(SUM(amount_num), 2) AS totalAmount,
      COUNT(DISTINCT COALESCE(NULLIF(TRIM(city), ''), '(blank)')) AS cityCount,
      COUNT(DISTINCT COALESCE(NULLIF(TRIM(address), ''), '(blank)')) AS addressCount
    FROM source_record_business_candidates
    WHERE source = ?
    GROUP BY owner_name_normalized
    HAVING totalAmount >= ?
       AND cityCount <= 3
       AND addressCount <= 8
    ORDER BY totalAmount DESC
    LIMIT ?
    `,
    source,
    minAmount,
    limit,
  );

  let upserted = 0;
  for (const group of groups) {
    const samples = await prisma.$queryRawUnsafe<SampleRow[]>(
      `
      SELECT
        'California SCO' AS sourceName,
        owner_name AS reportedOwnerName,
        holder_name AS holderName,
        property_id AS propertyId,
        printf('%.2f', amount_num) AS amount,
        TRIM(COALESCE(address, '') || CASE WHEN city IS NOT NULL AND city <> '' THEN ', ' || city ELSE '' END || CASE WHEN state IS NOT NULL AND state <> '' THEN ', ' || state ELSE '' END || CASE WHEN zip_code IS NOT NULL AND zip_code <> '' THEN ', ' || zip_code ELSE '' END) AS reportedAddress,
        property_type AS accountType,
        'high' AS confidence,
        city,
        address
      FROM source_record_business_candidates
      WHERE source = ?
        AND owner_name_normalized = ?
      ORDER BY amount_num DESC, source_record_id ASC
      LIMIT 25
      `,
      source,
      group.ownerNameNormalized,
    );
    const cities = [...new Set(samples.map((row) => row.city?.trim()).filter(Boolean))];
    const addresses = [...new Set(samples.map((row) => row.address?.trim()).filter(Boolean))];
    const sampleMatches = samples.map((row) => ({
      sourceName: row.sourceName,
      reportedOwnerName: row.reportedOwnerName,
      holderName: row.holderName,
      propertyId: row.propertyId,
      amount: row.amount == null ? null : String(row.amount),
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
      source,
      group.ownerNameNormalized,
      group.displayName,
      Number(group.totalAmount),
      Number(group.propertyCount),
      Number(group.cityCount),
      Number(group.addressCount),
      JSON.stringify(cities),
      JSON.stringify(addresses),
      JSON.stringify(sampleMatches),
      builtAt,
    );
    upserted++;
    if (upserted % 500 === 0) {
      console.log(`[prospects:candidate-build] Upserted ${upserted.toLocaleString("en-US")} prospects`);
    }
  }

  console.log(
    `[prospects:candidate-build] Done. Upserted ${upserted.toLocaleString("en-US")} prospects in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
}

main()
  .catch((e) => {
    console.error("[prospects:candidate-build] Build failed", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
