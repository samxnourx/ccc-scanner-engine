CREATE TABLE IF NOT EXISTS "intake_scan_progress" (
  "intake_id" TEXT NOT NULL PRIMARY KEY,
  "status" TEXT NOT NULL DEFAULT 'scan_pending',
  "query_json" TEXT,
  "matches_json" TEXT NOT NULL DEFAULT '[]',
  "match_count" INTEGER NOT NULL DEFAULT 0,
  "selected_count" INTEGER NOT NULL DEFAULT 0,
  "scan_ran_at" DATETIME,
  "results_sent_at" DATETIME,
  "no_match_reason" TEXT NOT NULL DEFAULT '',
  "intake_json" TEXT,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
