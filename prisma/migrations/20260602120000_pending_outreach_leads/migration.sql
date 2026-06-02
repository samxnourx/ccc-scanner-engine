CREATE TABLE IF NOT EXISTS "pending_outreach_leads" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "token" TEXT NOT NULL UNIQUE,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "lead_source" TEXT NOT NULL,
  "lead_id" TEXT NOT NULL,
  "business_name" TEXT NOT NULL,
  "recipient_emails" TEXT NOT NULL,
  "imported_email" TEXT NOT NULL DEFAULT '',
  "phone" TEXT NOT NULL DEFAULT '',
  "website" TEXT NOT NULL DEFAULT '',
  "external_lead_id" TEXT NOT NULL DEFAULT '',
  "scanner_batch_id" TEXT NOT NULL DEFAULT '',
  "scanner_lead_business_id" TEXT NOT NULL DEFAULT '',
  "selected_matches_json" TEXT NOT NULL,
  "subject" TEXT NOT NULL DEFAULT '',
  "message_id" TEXT NOT NULL DEFAULT '',
  "sent_at" TEXT NOT NULL DEFAULT '',
  "confirmed_matches_json" TEXT NOT NULL DEFAULT '[]',
  "rejected_matches_json" TEXT NOT NULL DEFAULT '[]',
  "confirmed_at" TEXT NOT NULL DEFAULT '',
  "cms_claim_id" TEXT NOT NULL DEFAULT '',
  "cms_intake_id" TEXT NOT NULL DEFAULT '',
  "cms_dashboard_url" TEXT NOT NULL DEFAULT '',
  "cms_response_json" TEXT NOT NULL DEFAULT '',
  "conversion_error" TEXT NOT NULL DEFAULT '',
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "pending_outreach_leads_lead_idx"
ON "pending_outreach_leads"("lead_source", "lead_id");

CREATE INDEX IF NOT EXISTS "pending_outreach_leads_status_idx"
ON "pending_outreach_leads"("status");
