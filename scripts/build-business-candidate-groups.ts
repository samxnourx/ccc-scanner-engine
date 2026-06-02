import dotenv from "dotenv";

dotenv.config({ path: ".env.local", override: true });
dotenv.config();

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const SOURCE = "ca_sco";

async function main(): Promise<void> {
  const started = Date.now();
  await prisma.$queryRawUnsafe(`PRAGMA busy_timeout = 120000`);
  await prisma.$queryRawUnsafe(`PRAGMA journal_mode = WAL`);
  await prisma.$queryRawUnsafe(`PRAGMA synchronous = NORMAL`);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS source_record_business_candidate_groups (
      source TEXT NOT NULL,
      owner_name_normalized TEXT NOT NULL,
      display_name TEXT NOT NULL,
      total_amount REAL NOT NULL,
      property_count INTEGER NOT NULL,
      city_count INTEGER NOT NULL,
      address_count INTEGER NOT NULL,
      cities_csv TEXT,
      addresses_csv TEXT,
      top_holder TEXT,
      top_amount REAL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (source, owner_name_normalized)
    )
  `);
  console.log("[business-candidate-groups] Rebuilding grouped candidate table.");
  console.log("[business-candidate-groups] This only refreshes a derived table; saved leads/prospects are not deleted.");

  await prisma.$executeRawUnsafe(
    `DELETE FROM source_record_business_candidate_groups WHERE source = ?`,
    SOURCE,
  );

  await prisma.$executeRawUnsafe(`
    INSERT INTO source_record_business_candidate_groups (
      source,
      owner_name_normalized,
      display_name,
      total_amount,
      property_count,
      city_count,
      address_count,
      cities_csv,
      addresses_csv,
      top_holder,
      top_amount,
      updated_at
    )
    SELECT
      c.source,
      c.owner_name_normalized,
      MIN(c.owner_name) AS display_name,
      ROUND(SUM(c.amount_num), 2) AS total_amount,
      COUNT(*) AS property_count,
      COUNT(DISTINCT COALESCE(NULLIF(TRIM(c.city), ''), '(blank)')) AS city_count,
      COUNT(DISTINCT COALESCE(NULLIF(TRIM(c.address), ''), '(blank)')) AS address_count,
      GROUP_CONCAT(DISTINCT NULLIF(TRIM(c.city), '')) AS cities_csv,
      GROUP_CONCAT(DISTINCT NULLIF(TRIM(c.address), '')) AS addresses_csv,
      MAX(c.holder_name) AS top_holder,
      MAX(c.amount_num) AS top_amount,
      CURRENT_TIMESTAMP
    FROM source_record_business_candidates c
    WHERE c.source = ?
    GROUP BY c.source, c.owner_name_normalized
  `, SOURCE);

  const rows = await prisma.$queryRawUnsafe<{ count: number | bigint }[]>(
    `SELECT COUNT(*) AS count
     FROM source_record_business_candidate_groups
     WHERE source = ?`,
    SOURCE,
  );
  console.log(
    `[business-candidate-groups] Grouped ${Number(rows[0]?.count ?? 0).toLocaleString("en-US")} businesses. Refreshing indexes...`,
  );

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS business_candidate_groups_total_idx
    ON source_record_business_candidate_groups(source, total_amount DESC)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS business_candidate_groups_name_idx
    ON source_record_business_candidate_groups(source, display_name)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS business_candidate_groups_properties_idx
    ON source_record_business_candidate_groups(source, property_count DESC)
  `);

  console.log(
    `[business-candidate-groups] Complete: ${Number(rows[0]?.count ?? 0).toLocaleString("en-US")} grouped businesses in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
}

main()
  .catch((e) => {
    console.error("[business-candidate-groups] Build failed", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
