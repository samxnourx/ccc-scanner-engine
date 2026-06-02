import { LEGACY_REPORT_NUMBER_FALLBACK } from "./lead-discovery-types";

/** Assigned report numbers: ROR-YYYY-NNNN (four-digit sequence). */
const VALID_ROR = /^ROR-(\d{4})-(\d{4})$/;

export function isValidAssignedReportNumber(rn: string | undefined): boolean {
  if (!rn?.trim()) return false;
  return VALID_ROR.test(rn.trim());
}

type LeadWithReportNumber = {
  reportNumber?: string;
  createdAt: string;
};

/**
 * Ensures every persisted row has a valid ROR-YYYY-NNNN on disk.
 * Legacy rows (missing, ROR-DRAFT, or malformed) are assigned using the
 * record's createdAt year and the next available sequence for that year.
 * Mutates `leads` in place. Returns whether any row changed.
 */
export function ensureReportNumbersOnLeads(leads: LeadWithReportNumber[]): boolean {
  let changed = false;
  const maxPerYear = new Map<number, number>();

  for (const l of leads) {
    const m = l.reportNumber?.trim().match(VALID_ROR);
    if (m) {
      const y = parseInt(m[1]!, 10);
      const n = parseInt(m[2]!, 10);
      maxPerYear.set(y, Math.max(maxPerYear.get(y) ?? 0, n));
    }
  }

  const need = leads.filter((l) => !isValidAssignedReportNumber(l.reportNumber));
  need.sort((a, b) =>
    (a.createdAt || "").localeCompare(b.createdAt || "", "en"),
  );

  for (const l of need) {
    const d = new Date(l.createdAt || Date.now());
    const y = Number.isFinite(d.getTime())
      ? d.getFullYear()
      : new Date().getFullYear();
    const next = (maxPerYear.get(y) ?? 0) + 1;
    maxPerYear.set(y, next);
    l.reportNumber = `ROR-${y}-${String(next).padStart(4, "0")}`;
    changed = true;
  }

  return changed;
}

/** Display-safe number after migration; last-resort draft label only if invalid. */
export function reportNumberFromPersisted(reportNumber: string | undefined): string {
  const rn = reportNumber?.trim() ?? "";
  if (isValidAssignedReportNumber(rn)) return rn;
  return LEGACY_REPORT_NUMBER_FALLBACK;
}
