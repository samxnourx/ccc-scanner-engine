-- Multiple emails per imported lead (Lead Scanner)

ALTER TABLE "lead_businesses" ADD COLUMN "emails_json" TEXT;
ALTER TABLE "lead_businesses" ADD COLUMN "emails_raw" TEXT;
