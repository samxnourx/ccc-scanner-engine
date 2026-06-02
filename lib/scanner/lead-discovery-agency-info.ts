import {
  CA_SCO_ESTATES_SOURCE_LABEL,
  CA_SCO_SOURCE_LABEL,
  CITY_SD_FINANCE_UNCLAIMED_LABEL,
  SD_COUNTY_AUDITOR_UNCLAIMED_LABEL,
  SD_COUNTY_TTC_UNCLAIMED_LABEL,
} from "./normalization";

// TODO(agency-contacts): Replace recipient-facing guidance below with verified
// official phone numbers, claim URLs, and mailing addresses for each source.

/** Shown on recipient reports after the primary agency line. */
const RECIPIENT_VERIFY_LINE =
  "Please verify current filing instructions with the agency before submitting a claim.";

export type AgencyContactSection = {
  /** Primary heading (agency / program name). */
  title: string;
  /** Supporting lines (recipient-facing; no internal “placeholder” wording). */
  lines: string[];
};

export function agencyContactSectionForSource(
  sourceName: string,
): AgencyContactSection {
  const s = sourceName.trim();

  if (s === CA_SCO_SOURCE_LABEL) {
    return {
      title: "California State Controller's Office — Unclaimed Property Division",
      lines: [RECIPIENT_VERIFY_LINE],
    };
  }

  if (
    s === CA_SCO_ESTATES_SOURCE_LABEL ||
    (s.includes("Estates") && s.includes("SCO"))
  ) {
    return {
      title:
        "California State Controller's Office — Estates / deceased persons programs (verify division)",
      lines: [RECIPIENT_VERIFY_LINE],
    };
  }

  if (
    s === CITY_SD_FINANCE_UNCLAIMED_LABEL ||
    (s.includes("City of San Diego") && s.includes("Unclaimed"))
  ) {
    return {
      title: "City of San Diego Department of Finance — Unclaimed Monies",
      lines: [RECIPIENT_VERIFY_LINE],
    };
  }

  if (
    s === SD_COUNTY_AUDITOR_UNCLAIMED_LABEL ||
    (s.includes("San Diego County") && s.includes("Auditor"))
  ) {
    return {
      title: "San Diego County Auditor & Controller",
      lines: [RECIPIENT_VERIFY_LINE],
    };
  }

  if (
    s === SD_COUNTY_TTC_UNCLAIMED_LABEL ||
    (s.includes("San Diego County") && s.includes("Treasurer"))
  ) {
    return {
      title: "San Diego County Treasurer-Tax Collector",
      lines: [RECIPIENT_VERIFY_LINE],
    };
  }

  return {
    title: s || "Unknown source",
    lines: [
      "Use the Source column in the preceding matches to identify the correct public agency for this listing.",
      RECIPIENT_VERIFY_LINE,
    ],
  };
}

export function uniqueSortedSources(sourceNames: string[]): string[] {
  return [...new Set(sourceNames.map((x) => x.trim()).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b),
  );
}
