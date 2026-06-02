/** Stored in `source_records.source` for CA State Controller UPD CSV imports. */
export const CA_SCO_SOURCE_KEY = "ca_sco";

/** California SCO Estates of Deceased Persons (Excel workbook imports). */
export const CA_SCO_ESTATES_SOURCE_KEY = "ca_sco_estates";

/** City of San Diego Finance — Unclaimed Monies (PDF). */
export const CITY_SD_FINANCE_UNCLAIMED_SOURCE_KEY =
  "city_san_diego_finance_unclaimed";

/** San Diego County Auditor & Controller unclaimed warrants (PDF set). */
export const SD_COUNTY_AUDITOR_UNCLAIMED_SOURCE_KEY =
  "sd_county_auditor_unclaimed";

/** San Diego County Treasurer-Tax Collector listings (HTML grids / exports). */
export const SD_COUNTY_TTC_UNCLAIMED_SOURCE_KEY = "sd_county_ttc_unclaimed";

/** Catalog sources replicated into `source_records_fts` for unified MATCH queries. */
export const SCANNER_FTS_SOURCE_KEYS = [
  CA_SCO_SOURCE_KEY,
  CA_SCO_ESTATES_SOURCE_KEY,
  CITY_SD_FINANCE_UNCLAIMED_SOURCE_KEY,
  SD_COUNTY_AUDITOR_UNCLAIMED_SOURCE_KEY,
  SD_COUNTY_TTC_UNCLAIMED_SOURCE_KEY,
] as const;
