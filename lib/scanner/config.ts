import path from "path";

/**
 * Absolute or relative path to the extracted CA SCO bulk CSV (from claimit.ca.gov
 * UPD property record ZIPs). Override via environment for local MVP / legacy paths.
 *
 * Legacy CLCC deployments sometimes hardcoded a repo-relative CSV; keep those paths
 * here while migrating.
 */
export const CA_SCO_DATA_PATH =
  process.env.CA_SCO_DATA_PATH?.trim() ||
  path.join(/* turbopackIgnore: true */ process.cwd(), "data", "ca-sco", "upd-records.csv");

/** Default California SCO Estates workbook (legacy: real_data/california_sco_estates.xlsx). */
export const CA_SCO_ESTATES_DATA_PATH =
  process.env.CA_SCO_ESTATES_DATA_PATH?.trim() ||
  path.join(
    /* turbopackIgnore: true */ process.cwd(),
    "data",
    "ca-sco-estates",
    "california_sco_estates.xlsx",
  );

/** Default City SD Finance Unclaimed PDF (legacy: real_data/city_san_diego_finance/…). */
export const CITY_SD_FINANCE_UNCLAIMED_PDF_PATH =
  process.env.CITY_SD_FINANCE_UNCLAIMED_PDF_PATH?.trim() ||
  path.join(
    /* turbopackIgnore: true */ process.cwd(),
    "data",
    "city-san-diego-unclaimed",
    "city_sd_unclaimed_monies_2026_q3.pdf",
  );

/** Metadata echoed into `raw_json` (override per publication). */
export const CITY_SD_FINANCE_REPORT_QUARTER_ENDING =
  process.env.CITY_SD_FINANCE_REPORT_QUARTER_ENDING?.trim() || "03/31/2026";

export const CITY_SD_FINANCE_UPDATED_LABEL =
  process.env.CITY_SD_FINANCE_UPDATED_LABEL?.trim() || "April 2026";

/** Default folder for sdcac_*.pdf (legacy: real_data/san_diego_county_auditor). */
export const SD_COUNTY_AUDITOR_DATA_DIR =
  process.env.SD_COUNTY_AUDITOR_DATA_DIR?.trim() ||
  path.join(
    /* turbopackIgnore: true */ process.cwd(),
    "data",
    "san-diego-county-auditor",
  );

/** Local folder for saved TTC HTML/CSV/XLSX/PDF exports (optional; empty dir triggers live fetch). */
export const SD_COUNTY_TTC_DATA_DIR =
  process.env.SD_COUNTY_TTC_DATA_DIR?.trim() ||
  path.join(
    /* turbopackIgnore: true */ process.cwd(),
    "data",
    "sd-county-ttc",
  );

/** Shipped sample rows for development when the full CSV is not present. */
export const CA_SCO_SAMPLE_PATH = path.join(
  /* turbopackIgnore: true */ process.cwd(),
  "data",
  "ca-sco",
  "upd-records.sample.csv",
);

/** Hard stop aligned with claimit web UI (first 500 matches). */
export const CA_SCO_MATCH_LIMIT = 500;

function parseOptionalPositiveInt(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

/**
 * Dev safety: when set, stop scanning after this many CSV data rows (excluding header).
 * Omit or empty for full-file scans.
 */
export const CA_SCO_MAX_ROWS = parseOptionalPositiveInt(
  process.env.CA_SCO_MAX_ROWS,
);

/**
 * Max rows Prisma returns before in-memory scoring (token-AND query). Tune if needed.
 */
export const CA_SCO_DB_CANDIDATE_LIMIT =
  parseOptionalPositiveInt(process.env.CA_SCO_DB_CANDIDATE_LIMIT) ?? 8000;

/**
 * Max rowids FTS returns before Node-side scoring (target ~100–300).
 * Override via CA_SCO_FTS_CANDIDATE_LIMIT.
 */
export const CA_SCO_FTS_CANDIDATE_LIMIT =
  parseOptionalPositiveInt(process.env.CA_SCO_FTS_CANDIDATE_LIMIT) ?? 250;

/** When true, skip SQLite and stream CSV (escape hatch / parity testing). */
export function caScoForceCsvFallback(): boolean {
  const v = process.env.CA_SCO_FORCE_CSV_FALLBACK?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}
