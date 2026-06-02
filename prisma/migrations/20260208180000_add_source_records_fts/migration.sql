-- -----------------------------------------------------------------------------
-- Optional migration snapshot. Prefer standalone FTS via prisma/sql + runtime
-- ensureSourceRecordsFtsTable() (standalone schema replaces legacy external-content).
-- -----------------------------------------------------------------------------
-- Standalone FTS5: explicit rows + sourceRecordId UNINDEXED for joins.
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS "source_records_fts";
CREATE VIRTUAL TABLE "source_records_fts" USING fts5(
  sourceRecordId UNINDEXED,
  ownerNameNormalized,
  ownerName,
  holderName,
  address,
  city,
  tokenize = 'unicode61'
);
