/**
 * FTS smoke test without importing server-only modules.
 * Usage: `npx tsx scripts/test-ton-dinh.ts`
 */
import { config } from "dotenv";
import path from "path";

config({ path: path.join(process.cwd(), ".env.local") });
config({ path: path.join(process.cwd(), ".env") });

import { prisma } from "../lib/scanner/db/client";
import {
  FTS_COL_OWNER_NORMALIZED,
  ftsSearchRowIds,
  ftsTokensAndOnColumn,
} from "../lib/scanner/db/source-records-fts";

async function main() {
  const tokens = ["ton", "that", "dinh"];
  const expr = ftsTokensAndOnColumn(FTS_COL_OWNER_NORMALIZED, tokens);
  console.log("[test-ton-dinh] MATCH:", expr);
  const ids = await ftsSearchRowIds(prisma, expr, 50);
  console.log("[test-ton-dinh] FTS candidate ids:", ids.length, ids.slice(0, 10));

  const rows =
    ids.length > 0
      ? await prisma.sourceRecord.findMany({
          where: { id: { in: ids.slice(0, 10) } },
        })
      : await prisma.sourceRecord.findMany({ take: 3, orderBy: { id: "asc" } });
  console.log(
    "[test-ton-dinh] sample owners:",
    rows.map((r) => `${r.id}: ${r.ownerName} / ${r.ownerNameNormalized}`),
  );

  const cnt = await prisma.$queryRawUnsafe<{ n: bigint | number }[]>(
    `SELECT COUNT(*) AS n FROM source_records_fts`,
  );
  console.log("[test-ton-dinh] source_records_fts rows:", Number(cnt[0]?.n ?? 0));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
