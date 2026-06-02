-- Full FTS refresh from source_records (unified scanner sources). Safe to re-run.
DELETE FROM source_records_fts;
INSERT INTO source_records_fts(sourceRecordId, ownerNameNormalized, ownerName, holderName, address, city)
SELECT id, owner_name_normalized, owner_name, holder_name, address, city
FROM source_records
WHERE source IN ('ca_sco', 'ca_sco_estates', 'city_san_diego_finance_unclaimed', 'sd_county_auditor_unclaimed', 'sd_county_ttc_unclaimed');
