import "../lib/scanner/importers/load-importer-env";

import { PrismaClient } from "@prisma/client";

import {
  ensureSourceRecordsFtsTable,
  repopulateSourceRecordsFtsFromSourceRecords,
} from "../lib/scanner/db/source-records-fts";

const OLD_URL = process.env.OLD_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
const NEW_URL = process.env.NEW_DATABASE_URL?.trim();

const BATCH_SIZE = 2_000;

if (!OLD_URL) {
  throw new Error("OLD_DATABASE_URL or DATABASE_URL is required.");
}

if (!NEW_URL) {
  throw new Error("NEW_DATABASE_URL is required.");
}

const OLD_DATABASE_URL = OLD_URL;
const NEW_DATABASE_URL = NEW_URL;

function client(url: string): PrismaClient {
  return new PrismaClient({
    datasources: {
      db: { url },
    },
  });
}

async function initializeCompactSchema(db: PrismaClient): Promise<void> {
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "source_records" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "source" TEXT NOT NULL,
      "property_id" TEXT NOT NULL,
      "owner_name" TEXT NOT NULL,
      "owner_name_normalized" TEXT NOT NULL,
      "holder_name" TEXT NOT NULL,
      "amount" TEXT,
      "address" TEXT,
      "city" TEXT,
      "state" TEXT,
      "zip_code" TEXT,
      "property_type" TEXT,
      "raw_json" TEXT NOT NULL,
      "imported_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "lead_scan_batches" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "name" TEXT NOT NULL,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "status" TEXT NOT NULL DEFAULT 'imported',
      "total_businesses" INTEGER NOT NULL DEFAULT 0,
      "scanned_count" INTEGER NOT NULL DEFAULT 0,
      "matches_found_count" INTEGER NOT NULL DEFAULT 0,
      "approved_email_count" INTEGER NOT NULL DEFAULT 0,
      "sent_email_count" INTEGER NOT NULL DEFAULT 0
    )
  `);
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "lead_businesses" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "batch_id" INTEGER NOT NULL,
      "external_lead_id" TEXT,
      "business_name" TEXT NOT NULL,
      "email" TEXT NOT NULL,
      "emails_json" TEXT,
      "emails_raw" TEXT,
      "website" TEXT NOT NULL DEFAULT '',
      "phone" TEXT,
      "address" TEXT,
      "city" TEXT,
      "state" TEXT,
      "source" TEXT NOT NULL DEFAULT 'lead_scanner',
      "email_quality" TEXT,
      "website_found" BOOLEAN,
      "imported_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "last_scanned_at" DATETIME,
      "outreach_status" TEXT NOT NULL DEFAULT 'not_scanned',
      "notes" TEXT NOT NULL DEFAULT '',
      "enriched_at" DATETIME,
      "enrichment_source" TEXT,
      "enrichment_status" TEXT NOT NULL DEFAULT 'not_requested',
      "enrichment_message" TEXT NOT NULL DEFAULT '',
      "google_maps_url" TEXT,
      CONSTRAINT "lead_businesses_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "lead_scan_batches" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "lead_business_matches" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "lead_business_id" INTEGER NOT NULL,
      "batch_id" INTEGER NOT NULL,
      "source_record_id" INTEGER,
      "source_name" TEXT NOT NULL,
      "reported_owner_name" TEXT NOT NULL,
      "holder_name" TEXT NOT NULL,
      "property_id" TEXT NOT NULL,
      "amount" TEXT,
      "reported_address" TEXT NOT NULL,
      "account_type" TEXT,
      "confidence" TEXT NOT NULL,
      "match_score" REAL,
      "notes" TEXT NOT NULL DEFAULT '',
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "lead_business_matches_lead_business_id_fkey" FOREIGN KEY ("lead_business_id") REFERENCES "lead_businesses" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "lead_business_matches_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "lead_scan_batches" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await db.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "source_records_owner_name_normalized_idx" ON "source_records"("owner_name_normalized")`,
  );
  await db.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "source_records_source_property_id_idx" ON "source_records"("source", "property_id")`,
  );
  await db.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "lead_businesses_batch_id_idx" ON "lead_businesses"("batch_id")`,
  );
  await db.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "lead_business_matches_batch_id_idx" ON "lead_business_matches"("batch_id")`,
  );
  await db.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "lead_business_matches_lead_business_id_idx" ON "lead_business_matches"("lead_business_id")`,
  );
  await ensureSourceRecordsFtsTable(db);
}

async function copyInBatches<T extends { id: number }>(
  label: string,
  readPage: (lastId: number) => Promise<T[]>,
  writePage: (rows: T[]) => Promise<void>,
): Promise<number> {
  let total = 0;
  let lastId = 0;
  while (true) {
    const rows = await readPage(lastId);
    if (rows.length === 0) break;
    await writePage(rows);
    total += rows.length;
    lastId = rows[rows.length - 1]!.id;
    if (total % 20_000 === 0 || rows.length < BATCH_SIZE) {
      console.log(`[compact-db] copied ${label}: ${total.toLocaleString()}`);
    }
  }
  return total;
}

async function tableCounts(db: PrismaClient) {
  const [
    sourceRecords,
    leadScanBatches,
    leadBusinesses,
    leadBusinessMatches,
    ftsRows,
  ] = await Promise.all([
    db.sourceRecord.count(),
    db.leadScanBatch.count(),
    db.leadBusiness.count(),
    db.leadBusinessMatch.count(),
    db.$queryRawUnsafe<{ n: bigint | number }[]>(
      "SELECT COUNT(*) AS n FROM source_records_fts",
    ),
  ]);

  return {
    sourceRecords,
    leadScanBatches,
    leadBusinesses,
    leadBusinessMatches,
    ftsRows: Number(ftsRows[0]?.n ?? 0),
  };
}

async function main() {
  const oldDb = client(OLD_DATABASE_URL);
  const newDb = client(NEW_DATABASE_URL);

  try {
    await initializeCompactSchema(newDb);

    console.log("[compact-db] old counts", await tableCounts(oldDb));
    console.log("[compact-db] new counts before", await tableCounts(newDb));

    await copyInBatches(
      "source_records",
      (lastId) =>
        oldDb.sourceRecord.findMany({
          where: { id: { gt: lastId } },
          orderBy: { id: "asc" },
          take: BATCH_SIZE,
        }),
      async (rows) => {
        await newDb.sourceRecord.createMany({ data: rows });
      },
    );

    await copyInBatches(
      "lead_scan_batches",
      (lastId) =>
        oldDb.leadScanBatch.findMany({
          where: { id: { gt: lastId } },
          orderBy: { id: "asc" },
          take: BATCH_SIZE,
        }),
      async (rows) => {
        await newDb.leadScanBatch.createMany({ data: rows });
      },
    );

    await copyInBatches(
      "lead_businesses",
      (lastId) =>
        oldDb.leadBusiness.findMany({
          where: { id: { gt: lastId } },
          orderBy: { id: "asc" },
          take: BATCH_SIZE,
        }),
      async (rows) => {
        await newDb.leadBusiness.createMany({ data: rows });
      },
    );

    await copyInBatches(
      "lead_business_matches",
      (lastId) =>
        oldDb.leadBusinessMatch.findMany({
          where: { id: { gt: lastId } },
          orderBy: { id: "asc" },
          take: BATCH_SIZE,
        }),
      async (rows) => {
        await newDb.leadBusinessMatch.createMany({ data: rows });
      },
    );

    console.log("[compact-db] rebuilding FTS in compact database");
    await repopulateSourceRecordsFtsFromSourceRecords(newDb);

    console.log("[compact-db] new counts after", await tableCounts(newDb));
  } finally {
    await oldDb.$disconnect();
    await newDb.$disconnect();
  }
}

main().catch((error) => {
  console.error("[compact-db] failed", error);
  process.exit(1);
});
