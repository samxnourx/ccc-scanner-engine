import dotenv from "dotenv";

dotenv.config({ path: ".env.local", override: true });
dotenv.config();

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SOURCE = "ca_sco";
const DEFAULT_CHUNK_SIZE = 250_000;

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

function parsePositiveInt(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
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

async function ensureTables(): Promise<void> {
  await prisma.$queryRawUnsafe(`PRAGMA busy_timeout = 120000`);
  await prisma.$queryRawUnsafe(`PRAGMA journal_mode = WAL`);
  await prisma.$queryRawUnsafe(`PRAGMA synchronous = NORMAL`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS source_record_business_candidates (
      source_record_id INTEGER NOT NULL PRIMARY KEY,
      source TEXT NOT NULL,
      owner_name_normalized TEXT NOT NULL,
      owner_name TEXT NOT NULL,
      holder_name TEXT NOT NULL,
      property_id TEXT NOT NULL,
      amount_num REAL NOT NULL,
      address TEXT,
      city TEXT,
      state TEXT,
      zip_code TEXT,
      property_type TEXT,
      business_signal TEXT NOT NULL,
      indexed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS business_candidates_source_owner_idx
    ON source_record_business_candidates(source, owner_name_normalized)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS business_candidates_source_owner_amount_idx
    ON source_record_business_candidates(source, owner_name_normalized, amount_num DESC, source_record_id ASC)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS business_candidates_source_amount_idx
    ON source_record_business_candidates(source, amount_num DESC)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS business_candidates_source_city_idx
    ON source_record_business_candidates(source, city)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS source_record_business_candidate_index_state (
      source TEXT NOT NULL PRIMARY KEY,
      last_source_record_id INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'idle',
      started_at DATETIME,
      updated_at DATETIME,
      completed_at DATETIME,
      candidate_count INTEGER NOT NULL DEFAULT 0
    )
  `);
}

async function resetState(source: string): Promise<void> {
  console.log(`[business-candidates] Resetting candidate index for ${source}`);
  await prisma.$executeRawUnsafe(
    `DELETE FROM source_record_business_candidates WHERE source = ?`,
    source,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO source_record_business_candidate_index_state (
       source, last_source_record_id, status, started_at, updated_at, completed_at, candidate_count
     ) VALUES (?, 0, 'idle', NULL, CURRENT_TIMESTAMP, NULL, 0)
     ON CONFLICT(source) DO UPDATE SET
       last_source_record_id = 0,
       status = 'idle',
       started_at = NULL,
       updated_at = CURRENT_TIMESTAMP,
       completed_at = NULL,
       candidate_count = 0`,
    source,
  );
}

async function main(): Promise<void> {
  const source = argValue("--source") ?? SOURCE;
  const chunkSize = parsePositiveInt(argValue("--chunk-size"), DEFAULT_CHUNK_SIZE);
  const maxChunks = parsePositiveInt(argValue("--max-chunks"), Number.MAX_SAFE_INTEGER);
  const reset = flag("--reset");
  const started = Date.now();

  await ensureTables();
  if (reset) await resetState(source);

  await prisma.$executeRawUnsafe(
    `INSERT INTO source_record_business_candidate_index_state (
       source, last_source_record_id, status, started_at, updated_at, completed_at, candidate_count
     ) VALUES (?, 0, 'running', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL, 0)
     ON CONFLICT(source) DO UPDATE SET
       status = 'running',
       started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
       updated_at = CURRENT_TIMESTAMP,
       completed_at = NULL`,
    source,
  );

  const stateRows = await prisma.$queryRawUnsafe<{ lastId: number | bigint }[]>(
    `SELECT last_source_record_id AS lastId
     FROM source_record_business_candidate_index_state
     WHERE source = ?`,
    source,
  );
  let lastId = Number(stateRows[0]?.lastId ?? 0);

  const maxRows = await prisma.$queryRawUnsafe<{ maxId: number | bigint | null }[]>(
    `SELECT MAX(id) AS maxId FROM source_records WHERE source = ?`,
    source,
  );
  const maxId = Number(maxRows[0]?.maxId ?? 0);
  console.log(
    `[business-candidates] Building candidate index: source=${source}, chunk=${chunkSize.toLocaleString("en-US")}, resumeAfter=${lastId.toLocaleString("en-US")}, maxId=${maxId.toLocaleString("en-US")}`,
  );
  console.log("[business-candidates] This does not delete or replace scanner_prospects.");

  let chunks = 0;
  let totalInsertedOrReplaced = 0;
  while (lastId < maxId && chunks < maxChunks) {
    const nextId = Math.min(lastId + chunkSize, maxId);
    const chunkStarted = Date.now();
    const inserted = await prisma.$executeRawUnsafe(
      `
      INSERT OR REPLACE INTO source_record_business_candidates (
        source_record_id,
        source,
        owner_name_normalized,
        owner_name,
        holder_name,
        property_id,
        amount_num,
        address,
        city,
        state,
        zip_code,
        property_type,
        business_signal,
        indexed_at
      )
      SELECT
        id AS source_record_id,
        source,
        owner_name_normalized,
        owner_name,
        holder_name,
        property_id,
        CAST(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(amount,'')), '$', ''), ',', ''), ' ', '') AS REAL) AS amount_num,
        address,
        city,
        state,
        zip_code,
        property_type,
        'business-name',
        CURRENT_TIMESTAMP
      FROM source_records
      WHERE source = ?
        AND id > ?
        AND id <= ?
        AND owner_name_normalized <> ''
        AND amount IS NOT NULL
        AND amount <> ''
        AND CAST(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(amount,'')), '$', ''), ',', ''), ' ', '') AS REAL) > 0
        AND ${businessLikeSql()}
      `,
      source,
      lastId,
      nextId,
    );
    totalInsertedOrReplaced += Number(inserted);
    lastId = nextId;
    chunks++;

    await prisma.$executeRawUnsafe(
      `UPDATE source_record_business_candidate_index_state
       SET last_source_record_id = ?,
           updated_at = CURRENT_TIMESTAMP,
           candidate_count = candidate_count + ?
       WHERE source = ?`,
      lastId,
      Number(inserted),
      source,
    );

    console.log(
      `[business-candidates] chunk ${chunks.toLocaleString("en-US")} indexed through id ${lastId.toLocaleString("en-US")} / ${maxId.toLocaleString("en-US")}; candidates in chunk=${Number(inserted).toLocaleString("en-US")}; elapsed=${((Date.now() - chunkStarted) / 1000).toFixed(1)}s`,
    );
  }

  if (lastId >= maxId) {
    await prisma.$executeRawUnsafe(
      `UPDATE source_record_business_candidate_index_state
       SET status = 'complete',
           updated_at = CURRENT_TIMESTAMP,
           completed_at = CURRENT_TIMESTAMP,
           candidate_count = (SELECT COUNT(*) FROM source_record_business_candidates WHERE source = ?)
       WHERE source = ?`,
      source,
      source,
    );
  }

  await prisma.$executeRawUnsafe(`PRAGMA optimize`);
  console.log(
    `[business-candidates] Paused/done after ${chunks.toLocaleString("en-US")} chunks; inserted/replaced ${totalInsertedOrReplaced.toLocaleString("en-US")} candidate rows in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
}

main()
  .catch((e) => {
    console.error("[business-candidates] Build failed", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
