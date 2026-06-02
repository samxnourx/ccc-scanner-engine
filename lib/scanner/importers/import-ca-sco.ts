/**
 * Phase 1 — Stream CA SCO bulk CSV into SQLite `source_records`.
 * Run via: npm run import:ca-sco -- [--file <path>] [--truncate] [--skip-truncate]
 *   [--resume] [--max-rows N] [--limit N]
 *
 * Smoke test (truncate + checkpoint + CSV + small insert, no full FTS rebuild):
 *   npm run import:ca-sco -- --truncate --limit 1000
 *
 * `.env` then `.env.local` (override) via `./load-importer-env` — must stay first import.
 */

import "./load-importer-env";
import { createReadStream } from "fs";
import { access, constants, stat } from "fs/promises";
import type { Prisma } from "@prisma/client";
import { parse } from "csv-parse";

import { CA_SCO_SOURCE_KEY } from "../ca-sco-keys";
import { CA_SCO_DATA_PATH, CA_SCO_MAX_ROWS } from "../config";
import { prisma } from "../db/client";
import {
  deleteSourceRecordsFtsForSources,
  ensureSourceRecordsFtsTable,
  repopulateSourceRecordsFtsFromSourceRecords,
} from "../db/source-records-fts";
import { normalizeText } from "../normalizeText";
import {
  buildStreetAddressLines,
  getOwnerLine,
  logCaScoColumnBinding,
  resolveCaScoColumns,
  type CaScoColumnMap,
} from "../normalization";

const LOG_PREFIX = "[ca-sco-import]";
/** SQLite-safe batch size (variable limit ~999). */
const INSERT_BATCH_SIZE = 5000;
const PROGRESS_EVERY_ROWS = 250_000;
const IMPORT_ROWS_LOG_EVERY = 250_000;
/** Smoke test: log CSV read progress often enough to see on short runs. */
const SMOKE_CSV_READ_LOG_EVERY = 250;
const SMOKE_ROWS_IMPORTED_LOG_EVERY = 100;
/** Chunked truncate keeps the DB responsive and allows progress logs on huge tables. */
const TRUNCATE_SOURCE_RECORDS_CHUNK = 250_000;
const TRUNCATE_FTS_CHUNK = 100_000;

function coerceRow(row: unknown): Record<string, string> {
  const o = row as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) {
    out[k] = v === null || v === undefined ? "" : String(v);
  }
  return out;
}

function parseCliArgs(): {
  file?: string;
  truncate: boolean;
  skipTruncate: boolean;
  resume: boolean;
  maxRows?: number;
  limit?: number;
} {
  const args = process.argv.slice(2);
  let file: string | undefined;
  let truncate = false;
  let skipTruncate = false;
  let resume = false;
  let maxRows: number | undefined;
  let limit: number | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--truncate") {
      truncate = true;
    } else if (a === "--skip-truncate") {
      skipTruncate = true;
    } else if (a === "--resume") {
      resume = true;
    } else if (a.startsWith("--file=")) {
      file = a.slice("--file=".length);
    } else if (a === "--file" && args[i + 1]) {
      file = args[++i];
    } else if (a === "--max-rows" && args[i + 1]) {
      const n = Number.parseInt(args[++i], 10);
      if (Number.isFinite(n) && n > 0) {
        maxRows = n;
      }
    } else if (a.startsWith("--limit=")) {
      const n = Number.parseInt(a.slice("--limit=".length), 10);
      if (Number.isFinite(n) && n > 0) {
        limit = n;
      }
    } else if (a === "--limit" && args[i + 1]) {
      const n = Number.parseInt(args[++i], 10);
      if (Number.isFinite(n) && n > 0) {
        limit = n;
      }
    }
  }
  return { file, truncate, skipTruncate, resume, maxRows, limit };
}

function formatGb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(4)} GB`;
}

async function flushBatch(
  batch: Prisma.SourceRecordCreateManyInput[],
): Promise<number> {
  if (batch.length === 0) return 0;
  const result = await prisma.sourceRecord.createMany({ data: batch });
  return result.count;
}

/**
 * Raw chunked DELETE is faster than Prisma `deleteMany` on multi-million-row SQLite tables
 * and yields progress logs between chunks.
 */
async function deleteSourceRecordsBySourceChunked(
  source: string,
  chunkSize: number,
  onChunk: (removedInChunk: number, removedTotal: number) => void,
): Promise<number> {
  let total = 0;
  while (true) {
    const n = await prisma.$executeRawUnsafe(
      `DELETE FROM source_records WHERE rowid IN (
        SELECT rowid FROM (
          SELECT rowid FROM source_records WHERE source = ? LIMIT ?
        ) AS del
      )`,
      source,
      chunkSize,
    );
    if (n === 0) break;
    total += n;
    onChunk(n, total);
  }
  return total;
}

export async function importCaScoCsv(options?: {
  filePath?: string;
  truncate?: boolean;
  skipTruncate?: boolean;
  resume?: boolean;
  maxRows?: number;
  /** Smoke test: stop after this many CSV rows read; skips full FTS repopulate. */
  limit?: number;
}): Promise<void> {
  const cli = parseCliArgs();
  const csvPath = options?.filePath ?? cli.file ?? CA_SCO_DATA_PATH;
  const truncateRequested = options?.truncate ?? cli.truncate;
  const skipTruncate = options?.skipTruncate ?? cli.skipTruncate;
  const resume = options?.resume ?? cli.resume;
  const truncate = truncateRequested && !skipTruncate;
  const smokeLimit = options?.limit ?? cli.limit;
  const isSmokeTest = smokeLimit !== undefined;
  const rowCap =
    smokeLimit ??
    options?.maxRows ??
    cli.maxRows ??
    CA_SCO_MAX_ROWS;
  const csvReadLogEvery = isSmokeTest ? SMOKE_CSV_READ_LOG_EVERY : PROGRESS_EVERY_ROWS;
  const importLogEvery = isSmokeTest ? SMOKE_ROWS_IMPORTED_LOG_EVERY : IMPORT_ROWS_LOG_EVERY;

  const envPathRaw = process.env.CA_SCO_DATA_PATH?.trim();
  if (envPathRaw) {
    console.log(
      `${LOG_PREFIX} CA_SCO_DATA_PATH from process.env (loaded via .env / .env.local)`,
    );
    console.log(`${LOG_PREFIX} process.env.CA_SCO_DATA_PATH → ${envPathRaw}`);
  } else {
    console.log(
      `${LOG_PREFIX} CA_SCO_DATA_PATH not set in environment — using config default (project data/ca-sco/upd-records.csv)`,
    );
  }

  if (cli.file || options?.filePath) {
    console.log(`${LOG_PREFIX} CSV path overridden by --file / options: ${csvPath}`);
  } else {
    console.log(`${LOG_PREFIX} Resolved CSV path: ${csvPath}`);
  }

  if (isSmokeTest) {
    console.log(
      `${LOG_PREFIX} Smoke test mode — will stop after ${rowCap!.toLocaleString()} CSV rows read (no full FTS rebuild).`,
    );
  } else if (rowCap !== undefined) {
    const src =
      options?.maxRows !== undefined || cli.maxRows !== undefined
        ? "--max-rows CLI"
        : "CA_SCO_MAX_ROWS env";
    console.log(
      `${LOG_PREFIX} Row cap: ${rowCap.toLocaleString()} (${src})`,
    );
  } else {
    console.log(`${LOG_PREFIX} Row cap: none (full CSV stream)`);
  }
  if (truncateRequested && skipTruncate) {
    console.log(
      `${LOG_PREFIX} --skip-truncate set — skipping truncate/checkpoint/sequence despite --truncate.`,
    );
  }
  if (resume && truncateRequested) {
    console.log(
      `${LOG_PREFIX} --resume set with --truncate; resume wins, so truncate will be skipped.`,
    );
  }
  try {
    await access(csvPath, constants.R_OK);
    const st = await stat(csvPath);
    console.log(
      `${LOG_PREFIX} File readable — size ${formatGb(st.size)} (${st.size.toLocaleString()} bytes)`,
    );
  } catch {
    console.error(`${LOG_PREFIX} File missing or unreadable: ${csvPath}`);
    process.exitCode = 1;
    return;
  }

  if (!process.env.DATABASE_URL?.trim()) {
    console.error(
      `${LOG_PREFIX} DATABASE_URL is not set. Example: file:../data/scanner.db (see prisma/schema.prisma).`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`${LOG_PREFIX} DATABASE_URL OK (SQLite)`);

  const t0 = Date.now();

  const parser = createReadStream(csvPath).pipe(
    parse({
      columns: true,
      trim: true,
      bom: true,
      relax_column_count: true,
      skip_records_with_error: true,
    }),
  );

  let cols: CaScoColumnMap | null = null;
  let rowsRead = 0;
  let rowsImported = 0;
  let rowsSkippedNoOwner = 0;
  let batch: Prisma.SourceRecordCreateManyInput[] = [];

  try {
    await ensureSourceRecordsFtsTable(prisma);

    let resumeSkipRows = 0;

    if (resume) {
      const existing = await prisma.sourceRecord.count({
        where: { source: CA_SCO_SOURCE_KEY },
      });
      resumeSkipRows = existing;
      console.log(
        `${LOG_PREFIX} Resume mode — existing ca_sco rows: ${resumeSkipRows.toLocaleString()}; skipping that many CSV data rows before inserting.`,
      );
      console.log(
        `${LOG_PREFIX} Resume assumes the existing partial import started at CSV row 1 and had no skipped-owner gaps.`,
      );
    }

    if (truncate && !resume) {
      console.log(`${LOG_PREFIX} Starting truncate for ca_sco...`);
      const tTruncate = Date.now();

      const ftsRemoved = await deleteSourceRecordsFtsForSources(
        prisma,
        [CA_SCO_SOURCE_KEY],
        {
          chunkSize: TRUNCATE_FTS_CHUNK,
          onChunk: (chunk, sum) => {
            const sec = ((Date.now() - tTruncate) / 1000).toFixed(1);
            console.log(
              `${LOG_PREFIX} Truncate progress (FTS): +${chunk.toLocaleString()} rows this chunk, ${sum.toLocaleString()} FTS rows removed so far, ${sec}s elapsed`,
            );
          },
        },
      );
      if (ftsRemoved > 0) {
        console.log(
          `${LOG_PREFIX} FTS clear for source="${CA_SCO_SOURCE_KEY}" complete: ${ftsRemoved.toLocaleString()} rows`,
        );
      }

      const removed = await deleteSourceRecordsBySourceChunked(
        CA_SCO_SOURCE_KEY,
        TRUNCATE_SOURCE_RECORDS_CHUNK,
        (chunk, sum) => {
          const sec = ((Date.now() - tTruncate) / 1000).toFixed(1);
          console.log(
            `${LOG_PREFIX} Truncate progress (source_records): +${chunk.toLocaleString()} rows this chunk, ${sum.toLocaleString()} removed so far, ${sec}s elapsed`,
          );
        },
      );

      const truncateSec = ((Date.now() - tTruncate) / 1000).toFixed(2);
      console.log(
        `${LOG_PREFIX} Finished truncate: ${removed.toLocaleString()} rows removed in ${truncateSec}s`,
      );
      console.log(
        `${LOG_PREFIX} Truncate complete — source_records for ca_sco is empty (or had no rows).`,
      );
      console.log(
        `${LOG_PREFIX} Resume note: if this run fails after truncate, rerun with the same flags; --truncate clears again. Without --truncate, import appends to whatever is already in the table.`,
      );

      try {
        const maxRows = await prisma.$queryRawUnsafe<{ m: number }[]>(
          `SELECT COALESCE(MAX(id), 0) AS m FROM source_records`,
        );
        const maxId = Number(maxRows[0]?.m ?? 0);
        const updated = await prisma.$executeRawUnsafe(
          `UPDATE sqlite_sequence SET seq = ? WHERE name = 'source_records'`,
          maxId,
        );
        if (updated > 0) {
          console.log(
            `${LOG_PREFIX} Reset sequence complete (sqlite_sequence.seq synced to max(id)=${maxId.toLocaleString()}).`,
          );
        } else {
          console.log(
            `${LOG_PREFIX} Reset sequence skipped (no sqlite_sequence row for source_records yet; safe for empty or fresh tables).`,
          );
        }
      } catch (seqErr) {
        console.log(
          `${LOG_PREFIX} Reset sequence skipped (${seqErr instanceof Error ? seqErr.message : String(seqErr)}).`,
        );
      }

      // PRAGMA wal_checkpoint returns rows in SQLite — must use $queryRawUnsafe, not $executeRawUnsafe.
      await prisma.$queryRawUnsafe(`PRAGMA wal_checkpoint(PASSIVE)`);
    }

    console.log(`${LOG_PREFIX} Import starting — streaming CSV into source_records.`);
    console.log(`${LOG_PREFIX} CSV path: ${csvPath}`);
    console.log(
      `${LOG_PREFIX} Batch insert size: ${INSERT_BATCH_SIZE}; CSV read progress every ${csvReadLogEvery.toLocaleString()} rows; rows-inserted milestone every ${importLogEvery.toLocaleString()} committed rows.`,
    );

    let lastImportedLogMilestone = 0;

    for await (const raw of parser) {
      rowsRead++;

      if (rowCap !== undefined && rowsRead > rowCap) {
        rowsRead--;
        console.log(
          `${LOG_PREFIX} Stopping at row cap (${rowCap.toLocaleString()}) — processed ${rowsRead.toLocaleString()} CSV rows`,
        );
        break;
      }

      if (rowsRead % csvReadLogEvery === 0) {
        const sec = ((Date.now() - t0) / 1000).toFixed(1);
        console.log(
          `${LOG_PREFIX} Progress — CSV rows read: ${rowsRead.toLocaleString()}, rows inserted (committed): ${rowsImported.toLocaleString()}, batch pending: ${batch.length}, elapsed: ${sec}s`,
        );
      }

      const row = coerceRow(raw);
      if (!cols) {
        const headerKeys = Object.keys(row);
        cols = resolveCaScoColumns(headerKeys);
        logCaScoColumnBinding(LOG_PREFIX, cols, headerKeys);
      }

      if (resumeSkipRows > 0 && rowsRead <= resumeSkipRows) {
        if (rowsRead % csvReadLogEvery === 0) {
          const sec = ((Date.now() - t0) / 1000).toFixed(1);
          console.log(
            `${LOG_PREFIX} Resume skip progress — CSV rows skipped: ${rowsRead.toLocaleString()} / ${resumeSkipRows.toLocaleString()}, elapsed: ${sec}s`,
          );
        }
        continue;
      }

      const ownerLine = getOwnerLine(row, cols);
      if (!ownerLine) {
        rowsSkippedNoOwner++;
        continue;
      }

      const propertyId = cols.propertyId
        ? (row[cols.propertyId] ?? "").trim()
        : "";
      const holderName = cols.holder ? (row[cols.holder] ?? "").trim() : "";
      const amount = cols.amount ? (row[cols.amount] ?? "").trim() : "";
      const city = cols.city ? (row[cols.city] ?? "").trim() : "";
      const state = cols.state ? (row[cols.state] ?? "").trim() : "";
      const zipCode = cols.zip ? (row[cols.zip] ?? "").trim() : "";
      const propertyType = cols.propertyType
        ? (row[cols.propertyType] ?? "").trim()
        : "";

      batch.push({
        source: CA_SCO_SOURCE_KEY,
        propertyId,
        ownerName: ownerLine,
        ownerNameNormalized: normalizeText(ownerLine),
        holderName,
        amount: amount || null,
        address: buildStreetAddressLines(row, cols) || null,
        city: city || null,
        state: state || null,
        zipCode: zipCode || null,
        propertyType: propertyType || null,
        rawJson: JSON.stringify(row),
      });

      if (batch.length >= INSERT_BATCH_SIZE) {
        rowsImported += await flushBatch(batch);
        batch = [];
        const milestone =
          Math.floor(rowsImported / importLogEvery) * importLogEvery;
        if (milestone > 0 && milestone > lastImportedLogMilestone) {
          lastImportedLogMilestone = milestone;
          const sec = ((Date.now() - t0) / 1000).toFixed(1);
          console.log(
            `${LOG_PREFIX} Rows imported (committed): ${rowsImported.toLocaleString()} — milestone log, elapsed ${sec}s`,
          );
        }
      }
    }

    rowsImported += await flushBatch(batch);
    batch = [];
    {
      const milestone =
        Math.floor(rowsImported / importLogEvery) * importLogEvery;
      if (milestone > 0 && milestone > lastImportedLogMilestone) {
        lastImportedLogMilestone = milestone;
        const sec = ((Date.now() - t0) / 1000).toFixed(1);
        console.log(
          `${LOG_PREFIX} Rows imported (committed): ${rowsImported.toLocaleString()} — milestone log, elapsed ${sec}s`,
        );
      }
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
    console.log(
      `${LOG_PREFIX} Done — CSV rows read: ${rowsRead.toLocaleString()}`,
    );
    console.log(
      `${LOG_PREFIX} Rows inserted: ${rowsImported.toLocaleString()}; skipped (no owner): ${rowsSkippedNoOwner.toLocaleString()}; elapsed: ${elapsed}s`,
    );

    if (isSmokeTest) {
      console.log(
        `${LOG_PREFIX} Smoke test complete — pipeline OK (truncate path if used, CSV read, inserts, flush).`,
      );
      console.log(
        `${LOG_PREFIX} Skipping full FTS repopulate in smoke mode (run a full import without --limit to rebuild FTS).`,
      );
    } else {
      const rb = Date.now();
      console.log(
        `${LOG_PREFIX} Repopulating FTS (DELETE + INSERT…SELECT from source_records)…`,
      );
      await repopulateSourceRecordsFtsFromSourceRecords(prisma);
      console.log(
        `${LOG_PREFIX} FTS repopulate done in ${((Date.now() - rb) / 1000).toFixed(1)}s`,
      );
    }
  } catch (e) {
    console.error(
      `${LOG_PREFIX} Import failed after ${rowsRead.toLocaleString()} CSV rows:`,
      e,
    );
    process.exitCode = 1;
    throw e;
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  await importCaScoCsv();
}

main().catch(() => {
  process.exit(1);
});
