import type { PrismaClient } from "@prisma/client";

import { CA_SCO_SOURCE_KEY } from "../ca-sco-keys";

import { FTS_COL_OWNER_NORMALIZED } from "./source-records-fts";

const LOG_PREFIX = "[ca-sco-fts-diag]";
const FTS_TABLE = "source_records_fts";
const SR_TABLE = "source_records";

/** Set CA_SCO_FTS_DIAG=1 during scanner search for schema + row probes. */
export function ftsDiagEnabled(): boolean {
  const v = process.env.CA_SCO_FTS_DIAG?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

async function logPragmaTable(db: PrismaClient, table: string): Promise<void> {
  const rows = await db.$queryRawUnsafe<{ cid: number; name: string; type: string }[]>(
    `PRAGMA table_info(${JSON.stringify(table)})`,
  );
  console.log(
    `${LOG_PREFIX} PRAGMA table_info(${table}):`,
    rows.map((r) => `${r.name}:${r.type}`).join(", ") || "(empty)",
  );
}

export async function logCaScoFtsDiagnostics(db: PrismaClient): Promise<void> {
  if (!ftsDiagEnabled()) return;

  try {
    await logPragmaTable(db, SR_TABLE);
    await logPragmaTable(db, FTS_TABLE);

    const totalSrc = await db.$queryRawUnsafe<{ n: bigint | number }[]>(
      `SELECT COUNT(*) AS n FROM source_records`,
    );
    console.log(
      `${LOG_PREFIX} SELECT COUNT(*) FROM source_records → ${Number(totalSrc[0]?.n ?? 0)}`,
    );

    const ftsCnt = await db.$queryRawUnsafe<{ n: bigint | number }[]>(
      `SELECT COUNT(*) AS n FROM source_records_fts`,
    );
    console.log(
      `${LOG_PREFIX} SELECT COUNT(*) FROM source_records_fts → ${Number(ftsCnt[0]?.n ?? 0)}`,
    );

    const ftsSample = await db.$queryRawUnsafe<
      Record<string, string | number | null>[]
    >(
      `SELECT rowid, sourceRecordId, ownerNameNormalized, ownerName FROM source_records_fts LIMIT 10`,
    );
    console.log(
      `${LOG_PREFIX} SELECT rowid, sourceRecordId, ownerNameNormalized, ownerName FROM source_records_fts LIMIT 10:`,
      JSON.stringify(ftsSample, null, 0),
    );

    const srSample = await db.$queryRawUnsafe<
      Record<string, string | number | null>[]
    >(
      `SELECT id, owner_name_normalized, owner_name FROM source_records LIMIT 10`,
    );
    console.log(
      `${LOG_PREFIX} SELECT id, owner_name_normalized, owner_name FROM source_records LIMIT 10:`,
      JSON.stringify(srSample, null, 0),
    );

    const rc = await db.$queryRawUnsafe<{ n: bigint | number }[]>(
      `SELECT COUNT(*) AS n FROM source_records WHERE source = ?`,
      CA_SCO_SOURCE_KEY,
    );
    console.log(
      `${LOG_PREFIX} source_records rows where source=${CA_SCO_SOURCE_KEY}: ${Number(rc[0]?.n ?? 0)}`,
    );

    const ownCol = FTS_COL_OWNER_NORMALIZED;
    const probeQueries = [
      "ton AND that AND dinh",
      `{${ownCol}} : ("ton" AND "that" AND "dinh")`,
      `{${ownCol}} : "ton that dinh"`,
      `{${ownCol}} : NEAR("ton" "that" "dinh", 40)`,
      "john smith",
      `{${ownCol}} : ("john" AND "smith")`,
    ];

    for (const q of probeQueries) {
      try {
        const rows = await db.$queryRawUnsafe<{ n: bigint | number }[]>(
          `SELECT COUNT(*) AS n FROM source_records_fts WHERE source_records_fts MATCH ?`,
          q,
        );
        console.log(
          `${LOG_PREFIX} MATCH hit count (${JSON.stringify(q)}): ${Number(rows[0]?.n ?? 0)}`,
        );
      } catch (e) {
        console.warn(`${LOG_PREFIX} MATCH probe failed (${JSON.stringify(q)}):`, e);
      }
    }
  } catch (e) {
    console.warn(`${LOG_PREFIX} diagnostics failed:`, e);
  }
}
