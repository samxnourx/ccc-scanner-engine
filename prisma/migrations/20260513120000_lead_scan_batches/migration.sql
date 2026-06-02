-- Lead Scanner batch import + match review (SQLite)

CREATE TABLE "lead_scan_batches" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'imported',
    "total_businesses" INTEGER NOT NULL DEFAULT 0,
    "scanned_count" INTEGER NOT NULL DEFAULT 0,
    "matches_found_count" INTEGER NOT NULL DEFAULT 0,
    "approved_email_count" INTEGER NOT NULL DEFAULT 0,
    "sent_email_count" INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE "lead_businesses" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "batch_id" INTEGER NOT NULL,
    "external_lead_id" TEXT,
    "business_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "website" TEXT NOT NULL DEFAULT '',
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "source" TEXT NOT NULL DEFAULT 'lead_scanner',
    "email_quality" TEXT,
    "website_found" INTEGER,
    "imported_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_scanned_at" DATETIME,
    "outreach_status" TEXT NOT NULL DEFAULT 'not_scanned',
    "notes" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "lead_businesses_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "lead_scan_batches" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "lead_businesses_batch_id_idx" ON "lead_businesses"("batch_id");

CREATE TABLE "lead_business_matches" (
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
);

CREATE INDEX "lead_business_matches_batch_id_idx" ON "lead_business_matches"("batch_id");
CREATE INDEX "lead_business_matches_lead_business_id_idx" ON "lead_business_matches"("lead_business_id");
