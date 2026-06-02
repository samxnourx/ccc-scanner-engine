-- Lead Scanner contact enrichment fields

ALTER TABLE "lead_businesses" ADD COLUMN "enriched_at" DATETIME;
ALTER TABLE "lead_businesses" ADD COLUMN "enrichment_source" TEXT;
ALTER TABLE "lead_businesses" ADD COLUMN "enrichment_status" TEXT NOT NULL DEFAULT 'not_requested';
ALTER TABLE "lead_businesses" ADD COLUMN "enrichment_message" TEXT NOT NULL DEFAULT '';
ALTER TABLE "lead_businesses" ADD COLUMN "google_maps_url" TEXT;
