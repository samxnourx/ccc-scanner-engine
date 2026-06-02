import dotenv from "dotenv";

dotenv.config({ path: ".env.local", override: true });
dotenv.config();

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  await prisma.$queryRawUnsafe(`PRAGMA busy_timeout = 120000`);
  await prisma.$queryRawUnsafe(`PRAGMA journal_mode = WAL`);
  await prisma.$queryRawUnsafe(`PRAGMA synchronous = NORMAL`);

  await prisma.$executeRawUnsafe(`
    CREATE VIRTUAL TABLE IF NOT EXISTS source_record_business_candidates_fts
    USING fts5(
      owner_name,
      owner_name_normalized,
      holder_name,
      city,
      address,
      content='source_record_business_candidates',
      content_rowid='source_record_id'
    )
  `);

  const candidateRows = await prisma.$queryRawUnsafe<{ c: number | bigint }[]>(
    `SELECT COUNT(*) AS c FROM source_record_business_candidates`,
  );
  const ftsRows = await prisma.$queryRawUnsafe<{ c: number | bigint }[]>(
    `SELECT COUNT(*) AS c FROM source_record_business_candidates_fts`,
  );
  const candidateCount = Number(candidateRows[0]?.c ?? 0);
  const ftsCount = Number(ftsRows[0]?.c ?? 0);

  console.log(
    `[business-candidates:fts] candidates=${candidateCount.toLocaleString("en-US")} fts=${ftsCount.toLocaleString("en-US")}`,
  );

  if (candidateCount !== ftsCount) {
    console.log("[business-candidates:fts] Rebuilding candidate FTS search index...");
    await prisma.$executeRawUnsafe(
      `INSERT INTO source_record_business_candidates_fts(source_record_business_candidates_fts) VALUES('rebuild')`,
    );
  }

  await prisma.$executeRawUnsafe(`PRAGMA optimize`);
  const finalRows = await prisma.$queryRawUnsafe<{ c: number | bigint }[]>(
    `SELECT COUNT(*) AS c FROM source_record_business_candidates_fts`,
  );
  console.log(
    `[business-candidates:fts] Ready: ${Number(finalRows[0]?.c ?? 0).toLocaleString("en-US")} searchable rows`,
  );
}

main()
  .catch((e) => {
    console.error("[business-candidates:fts] Failed", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
