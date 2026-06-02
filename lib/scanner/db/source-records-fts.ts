import type { PrismaClient } from "@prisma/client";

import { SCANNER_FTS_SOURCE_KEYS } from "../ca-sco-keys";

function sqlInPlaceholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

/**
 * Standalone FTS5 table (not external content): rows are populated explicitly from
 * `source_records` via INSERT…SELECT so MATCH always reflects indexed text. External
 * content FTS proved unreliable (empty / desynced index) with Prisma’s SQLite stack.
 *
 * Column names are camelCase in FTS DDL only; raw SQL against `source_records` uses
 * actual SQLite names from PRAGMA / schema (`owner_name_normalized`, etc.).
 *
 * Not `server-only`: imported by plain Node/tsx importers.
 */

/** MATCH filter column for normalized owner line (must match FTS DDL). */
export const FTS_COL_OWNER_NORMALIZED = "ownerNameNormalized";

const FTS_TABLE = "source_records_fts";

/** Physical SQLite columns on `source_records` (@@map); verified via PRAGMA, not Prisma field names. */
const SR_COL = {
  id: "id",
  source: "source",
  ownerNorm: "owner_name_normalized",
  owner: "owner_name",
  holder: "holder_name",
  address: "address",
  city: "city",
} as const;

const FTS_CREATE_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS "${FTS_TABLE}" USING fts5(
  sourceRecordId UNINDEXED,
  ownerNameNormalized,
  ownerName,
  holderName,
  address,
  city,
  tokenize = 'unicode61'
);
`.trim();

async function pragmaTableInfo(
  db: PrismaClient,
  table: string,
): Promise<{ name: string }[]> {
  return db.$queryRawUnsafe<{ name: string }[]>(
    `PRAGMA table_info(${JSON.stringify(table)})`,
  );
}

/** True when existing FTS was created with standalone camelCase columns + sourceRecordId. */
async function ftsStandaloneSchemaOk(db: PrismaClient): Promise<boolean> {
  const cols = await pragmaTableInfo(db, FTS_TABLE);
  const names = new Set(cols.map((c) => c.name));
  return names.has("sourceRecordId") && names.has("ownerNameNormalized");
}

export async function sourceRecordsFtsTableExists(
  db: PrismaClient,
): Promise<boolean> {
  const rows = await db.$queryRaw<{ name: string }[]>`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name = ${FTS_TABLE}
  `;
  return rows.length > 0;
}

/** Drop legacy external-content FTS or any mismatch, then create standalone table if missing. */
export async function ensureSourceRecordsFtsTable(db: PrismaClient): Promise<void> {
  const exists = await sourceRecordsFtsTableExists(db);
  if (exists && !(await ftsStandaloneSchemaOk(db))) {
    await db.$executeRawUnsafe(`DROP TABLE IF EXISTS ${FTS_TABLE}`);
  }
  if (!(await sourceRecordsFtsTableExists(db))) {
    await db.$executeRawUnsafe(FTS_CREATE_SQL);
  }
}

/** True when at least one FTS row exists. */
export async function sourceRecordsFtsIndexReady(
  db: PrismaClient,
): Promise<boolean> {
  try {
    const rows = await db.$queryRawUnsafe<{ x: number }[]>(
      `SELECT 1 AS x FROM ${FTS_TABLE} LIMIT 1`,
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Remove FTS rows whose backing `source_records` row matches one of `sourceKeys`.
 * Chunked so large truncates can log progress; safe while `source_records` rows still exist.
 */
export async function deleteSourceRecordsFtsForSources(
  db: PrismaClient,
  sourceKeys: readonly string[],
  opts?: {
    chunkSize?: number;
    onChunk?: (removedInChunk: number, removedTotal: number) => void;
  },
): Promise<number> {
  const keys = [...sourceKeys];
  if (keys.length === 0) return 0;
  if (!(await sourceRecordsFtsTableExists(db))) return 0;

  const chunkSize = opts?.chunkSize ?? 100_000;
  const placeholders = sqlInPlaceholders(keys.length);
  let total = 0;

  while (true) {
    const n = await db.$executeRawUnsafe(
      `DELETE FROM ${FTS_TABLE} WHERE sourceRecordId IN (
        SELECT id FROM source_records WHERE ${SR_COL.source} IN (${placeholders}) LIMIT ?
      )`,
      ...keys,
      chunkSize,
    );
    if (n === 0) break;
    total += n;
    opts?.onChunk?.(n, total);
  }

  return total;
}

/**
 * Full refresh: DELETE all FTS rows, then copy searchable columns from `source_records`
 * for unified scanner sources (CA SCO bulk + CA SCO Estates, etc.).
 */
export async function repopulateSourceRecordsFtsFromSourceRecords(
  db: PrismaClient,
): Promise<void> {
  const keys = [...SCANNER_FTS_SOURCE_KEYS];
  await db.$executeRawUnsafe(`DELETE FROM ${FTS_TABLE}`);
  await db.$executeRawUnsafe(
    `INSERT INTO ${FTS_TABLE}(sourceRecordId, ownerNameNormalized, ownerName, holderName, address, city)
     SELECT ${SR_COL.id}, ${SR_COL.ownerNorm}, ${SR_COL.owner}, ${SR_COL.holder}, ${SR_COL.address}, ${SR_COL.city}
     FROM source_records
     WHERE ${SR_COL.source} IN (${sqlInPlaceholders(keys.length)})`,
    ...keys,
  );
}

/** @deprecated Use {@link repopulateSourceRecordsFtsFromSourceRecords}. */
export async function rebuildSourceRecordsFtsIndex(db: PrismaClient): Promise<void> {
  await repopulateSourceRecordsFtsFromSourceRecords(db);
}

export function escapeFtsToken(token: string): string {
  return token.replace(/"/g, '""').replace(/\*/g, "");
}

export function ftsPhraseOnColumn(column: string, phrase: string): string {
  const esc = escapeFtsToken(phrase.trim());
  return `{${column}} : "${esc}"`;
}

export function ftsTokenAndQuery(tokens: string[]): string {
  return tokens.map((t) => `"${escapeFtsToken(t)}"`).join(" AND ");
}

export function ftsTokenOrQuery(tokens: string[]): string {
  return tokens.map((t) => `"${escapeFtsToken(t)}"`).join(" OR ");
}

export function ftsTokensAndOnColumn(column: string, tokens: string[]): string {
  if (tokens.length === 0) return "";
  const inner = tokens.map((t) => `"${escapeFtsToken(t)}"`).join(" AND ");
  return `{${column}} : (${inner})`;
}

export function ftsTokensOrOnColumn(column: string, tokens: string[]): string {
  if (tokens.length === 0) return "";
  const inner = tokens.map((t) => `"${escapeFtsToken(t)}"`).join(" OR ");
  return `{${column}} : (${inner})`;
}

export function ftsNearTokensOnColumn(
  column: string,
  tokens: string[],
  maxGap: number,
): string {
  if (tokens.length === 0) return "";
  const phrases = tokens.map((t) => `"${escapeFtsToken(t)}"`).join(" ");
  return `{${column}} : NEAR(${phrases}, ${maxGap})`;
}

export function ftsPrefixTokenOnColumn(column: string, token: string): string {
  const t = escapeFtsToken(token).replace(/\*/g, "");
  if (!t) return "";
  return `{${column}} : ${t}*`;
}

export async function ftsSearchRowIds(
  db: PrismaClient,
  matchExpression: string,
  limit: number,
  sourceKeys: readonly string[] = [...SCANNER_FTS_SOURCE_KEYS],
): Promise<number[]> {
  const keys = [...sourceKeys];
  const inList = sqlInPlaceholders(keys.length);
  if (keys.includes("ca_sco")) {
    const rows = await db.$queryRawUnsafe<{ id: number }[]>(
      `SELECT sourceRecordId AS id FROM ${FTS_TABLE}
       WHERE ${FTS_TABLE} MATCH ?
       LIMIT ?`,
      matchExpression,
      limit,
    );
    return rows.map((r) => Number(r.id));
  }

  try {
    const rows = await db.$queryRawUnsafe<{ id: number }[]>(
      `SELECT s.${SR_COL.id} AS id FROM source_records s
       INNER JOIN (
         SELECT sourceRecordId FROM ${FTS_TABLE}
         WHERE ${FTS_TABLE} MATCH ?
         ORDER BY bm25(${FTS_TABLE})
         LIMIT ?
       ) fts ON fts.sourceRecordId = s.${SR_COL.id}
       WHERE s.${SR_COL.source} IN (${inList})`,
      matchExpression,
      limit,
      ...keys,
    );
    return rows.map((r) => Number(r.id));
  } catch {
    const rows = await db.$queryRawUnsafe<{ id: number }[]>(
      `SELECT s.${SR_COL.id} AS id FROM source_records s
       INNER JOIN (
         SELECT sourceRecordId FROM ${FTS_TABLE}
         WHERE ${FTS_TABLE} MATCH ?
         LIMIT ?
       ) fts ON fts.sourceRecordId = s.${SR_COL.id}
       WHERE s.${SR_COL.source} IN (${inList})`,
      matchExpression,
      limit,
      ...keys,
    );
    return rows.map((r) => Number(r.id));
  }
}
