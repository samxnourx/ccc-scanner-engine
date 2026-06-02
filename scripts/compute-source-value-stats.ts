import { config } from "dotenv";
import { appendFileSync } from "node:fs";
import { join } from "node:path";

config({ path: ".env.local", override: true });
config({ path: ".env" });

const logPath = join(process.cwd(), "source-value-stats.log");

function log(message: string): void {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  appendFileSync(logPath, `${line}\n`);
}

async function main(): Promise<void> {
  const { prisma } = await import("@/lib/scanner/db/client");
  const source = "ca_sco";
  const started = Date.now();
  const chunkSize = Math.max(
    Number.parseInt(process.env.VALUE_STATS_CHUNK_SIZE || "250000", 10) ||
      250000,
    1000,
  );
  const maxChunks = Math.max(
    Number.parseInt(process.env.VALUE_STATS_MAX_CHUNKS || "0", 10) || 0,
    0,
  );
  log(
    `[value-stats] Computing totals for ${source} in ${chunkSize.toLocaleString("en-US")}-row chunks...`,
  );

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS source_record_value_stats (
      source TEXT NOT NULL PRIMARY KEY,
      last_source_record_id INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'not_started',
      source_record_count INTEGER NOT NULL DEFAULT 0,
      source_record_total_amount REAL NOT NULL DEFAULT 0,
      candidate_record_count INTEGER NOT NULL DEFAULT 0,
      candidate_total_amount REAL NOT NULL DEFAULT 0,
      computed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  const columns = await prisma.$queryRawUnsafe<{ name: string }[]>(
    `PRAGMA table_info(source_record_value_stats)`,
  );
  const existingColumns = new Set(columns.map((column) => column.name));
  if (!existingColumns.has("last_source_record_id")) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE source_record_value_stats ADD COLUMN last_source_record_id INTEGER NOT NULL DEFAULT 0`,
    );
  }
  if (!existingColumns.has("status")) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE source_record_value_stats ADD COLUMN status TEXT NOT NULL DEFAULT 'not_started'`,
    );
  }

  const [stateRows, maxRows, candidateRows] = await Promise.all([
    prisma.$queryRawUnsafe<
      {
        lastSourceRecordId: number | bigint;
        sourceRecordCount: number | bigint;
        sourceRecordTotalAmount: number | bigint | null;
      }[]
    >(
      `SELECT
         last_source_record_id AS lastSourceRecordId,
         source_record_count AS sourceRecordCount,
         source_record_total_amount AS sourceRecordTotalAmount
       FROM source_record_value_stats
       WHERE source = ?
       LIMIT 1`,
      source,
    ),
    prisma.$queryRawUnsafe<{ maxId: number | bigint | null }[]>(
      `SELECT MAX(id) AS maxId FROM source_records`,
    ),
    prisma.$queryRawUnsafe<
      {
        candidateRecordCount: number | bigint;
        candidateTotalAmount: number | bigint | null;
      }[]
    >(
      `SELECT
         COUNT(*) AS candidateRecordCount,
         ROUND(SUM(amount_num), 2) AS candidateTotalAmount
       FROM source_record_business_candidates
       WHERE source = ?`,
      source,
    ),
  ]);

  const state = stateRows[0];
  const maxId = Number(maxRows[0]?.maxId ?? 0);
  const candidateRow = candidateRows[0];
  let lastSourceRecordId = Number(state?.lastSourceRecordId ?? 0);
  let sourceRecordCount = Number(state?.sourceRecordCount ?? 0);
  let sourceRecordTotalAmount = Number(state?.sourceRecordTotalAmount ?? 0);
  const candidateRecordCount = Number(candidateRow?.candidateRecordCount ?? 0);
  const candidateTotalAmount = Number(candidateRow?.candidateTotalAmount ?? 0);

  await prisma.$executeRawUnsafe(
    `INSERT INTO source_record_value_stats (
       source,
       last_source_record_id,
       status,
       source_record_count,
       source_record_total_amount,
       candidate_record_count,
       candidate_total_amount,
       computed_at
     ) VALUES (?, ?, 'running', ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(source) DO UPDATE SET
       candidate_record_count = excluded.candidate_record_count,
       candidate_total_amount = excluded.candidate_total_amount,
       status = 'running',
       computed_at = CURRENT_TIMESTAMP`,
    source,
    lastSourceRecordId,
    sourceRecordCount,
    sourceRecordTotalAmount,
    candidateRecordCount,
    candidateTotalAmount,
  );

  let chunksProcessed = 0;
  while (lastSourceRecordId < maxId) {
    const upperId = Math.min(lastSourceRecordId + chunkSize, maxId);
    const rows = await prisma.$queryRawUnsafe<
      { rowCount: number | bigint; totalAmount: number | bigint | null }[]
    >(
      `SELECT
         COUNT(*) AS rowCount,
         ROUND(SUM(CAST(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(amount,'')), '$', ''), ',', ''), ' ', '') AS REAL)), 2) AS totalAmount
       FROM source_records
       WHERE source = ?
         AND id > ?
         AND id <= ?`,
      source,
      lastSourceRecordId,
      upperId,
    );
    const row = rows[0];
    sourceRecordCount += Number(row?.rowCount ?? 0);
    sourceRecordTotalAmount += Number(row?.totalAmount ?? 0);
    lastSourceRecordId = upperId;

    await prisma.$executeRawUnsafe(
      `UPDATE source_record_value_stats
       SET last_source_record_id = ?,
           status = ?,
           source_record_count = ?,
           source_record_total_amount = ?,
           candidate_record_count = ?,
           candidate_total_amount = ?,
           computed_at = CURRENT_TIMESTAMP
       WHERE source = ?`,
      lastSourceRecordId,
      lastSourceRecordId >= maxId ? "complete" : "running",
      sourceRecordCount,
      Number(sourceRecordTotalAmount.toFixed(2)),
      candidateRecordCount,
      candidateTotalAmount,
      source,
    );

    chunksProcessed += 1;
    log(
      `[value-stats] through id ${lastSourceRecordId.toLocaleString("en-US")} / ${maxId.toLocaleString("en-US")}; rows=${sourceRecordCount.toLocaleString("en-US")}; total=$${sourceRecordTotalAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    );
    if (maxChunks > 0 && chunksProcessed >= maxChunks) {
      log(`[value-stats] Pausing after ${chunksProcessed} chunk(s) because VALUE_STATS_MAX_CHUNKS=${maxChunks}.`);
      break;
    }
  }

  log(
    `[value-stats] ${source} source rows=${sourceRecordCount.toLocaleString("en-US")} total=$${sourceRecordTotalAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  );
  log(
    `[value-stats] ${source} candidate rows=${candidateRecordCount.toLocaleString("en-US")} total=$${candidateTotalAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  );
  log(`[value-stats] Complete in ${((Date.now() - started) / 1000).toFixed(1)}s`);

  await prisma.$disconnect();
}

main()
  .catch((error) => {
    log(`[value-stats] Failed ${error instanceof Error ? error.stack : String(error)}`);
    process.exitCode = 1;
  });
