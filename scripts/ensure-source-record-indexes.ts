import dotenv from "dotenv";

dotenv.config({ path: ".env.local", override: true });
dotenv.config();

const lightIndexes = [
  {
    name: "source_records_source_idx",
    sql: `CREATE INDEX IF NOT EXISTS "source_records_source_idx" ON "source_records"("source")`,
  },
];

const heavyIndexes = [
  {
    name: "source_records_source_owner_name_normalized_idx",
    sql: `CREATE INDEX IF NOT EXISTS "source_records_source_owner_name_normalized_idx" ON "source_records"("source", "owner_name_normalized")`,
  },
  {
    name: "source_records_holder_name_idx",
    sql: `CREATE INDEX IF NOT EXISTS "source_records_holder_name_idx" ON "source_records"("holder_name")`,
  },
  {
    name: "source_records_source_holder_name_idx",
    sql: `CREATE INDEX IF NOT EXISTS "source_records_source_holder_name_idx" ON "source_records"("source", "holder_name")`,
  },
  {
    name: "source_records_property_id_idx",
    sql: `CREATE INDEX IF NOT EXISTS "source_records_property_id_idx" ON "source_records"("property_id")`,
  },
];

async function main(): Promise<void> {
  const { prisma } = await import("../lib/scanner/db/client");
  const includeHeavy = process.argv.includes("--heavy");
  const indexes = includeHeavy
    ? [...lightIndexes, ...heavyIndexes]
    : lightIndexes;
  try {
    console.log("[db:indexes] Ensuring source_records indexes");
    if (!includeHeavy) {
      console.log(
        "[db:indexes] Heavy owner/holder/property indexes skipped. Run `npm run db:indexes -- --heavy` during a maintenance window to build them.",
      );
    }
    for (const idx of indexes) {
      const started = Date.now();
      console.log(`[db:indexes] ${idx.name}...`);
      await prisma.$executeRawUnsafe(idx.sql);
      console.log(
        `[db:indexes] ${idx.name} ready in ${((Date.now() - started) / 1000).toFixed(1)}s`,
      );
    }

    await prisma.$executeRawUnsafe("PRAGMA optimize");
    const rows = await prisma.$queryRawUnsafe<
      { name: string; origin: string; partial: bigint | number }[]
    >("PRAGMA index_list(source_records)");
    console.log("[db:indexes] Active indexes:");
    for (const row of rows) {
      console.log(`  - ${row.name}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
