-- Standalone FTS5 (not external content). Drops legacy external-content FTS if present.
-- Physical source row keys use SQLite names in INSERT…SELECT (owner_name_normalized, …).
DROP TABLE IF EXISTS source_records_fts;
CREATE VIRTUAL TABLE source_records_fts USING fts5(
  sourceRecordId UNINDEXED,
  ownerNameNormalized,
  ownerName,
  holderName,
  address,
  city,
  tokenize = 'unicode61'
);
