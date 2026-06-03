import type { NormalizedMatch, ScannerQuery } from "./types";

export const LEAD_DISCOVERY_STATUSES = [
  "detected",
  "reviewed",
  "approved_for_outreach",
  "outreach_sent",
  "responded",
  "converted",
  "declined",
  "archived",
] as const;

export type LeadDiscoveryStatus = (typeof LEAD_DISCOVERY_STATUSES)[number];

export const LEAD_TARGET_TYPES = [
  "individual",
  "business",
  "organization",
  "unknown",
] as const;

export type LeadTargetType = (typeof LEAD_TARGET_TYPES)[number];

/** JSON-safe scanner query stored with each lead (`searchQuery` on disk). */
export type LeadDiscoveryScannerQueryJson = {
  name: string;
  city: string | null;
  state: string | null;
  addressHint: string | null;
  intakeId: string | null;
};

/** Fallback only if a row cannot be assigned a valid ROR-YYYY-NNNN (should not occur after migration). */
export const LEGACY_REPORT_NUMBER_FALLBACK = "ROR-DRAFT";

export type LeadDiscoveryRecord = {
  leadDiscoveryId: string;
  /** Human-readable report number; never show leadDiscoveryId on client-facing report. */
  reportNumber: string;
  searchQuery: LeadDiscoveryScannerQueryJson;
  targetName: string;
  targetType: LeadTargetType | null;
  status: LeadDiscoveryStatus;
  matchCount: number;
  estimatedTotalAmount: number | null;
  matches: NormalizedMatch[];
  outreachMatches: NormalizedMatch[];
  outreachEmailTo: string | null;
  outreachEmailSubject: string | null;
  outreachEmailText: string | null;
  outreachPortalUrl: string | null;
  outreachIntakeId: string | null;
  outreachSentAt: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export function toScannerQueryJson(q: ScannerQuery): LeadDiscoveryScannerQueryJson {
  return {
    name: q.name.trim(),
    city: q.city?.trim() || null,
    state: q.state?.trim() || null,
    addressHint: q.addressHint?.trim() || null,
    intakeId: q.intakeId?.trim() || null,
  };
}

export function isLeadDiscoveryStatus(s: string): s is LeadDiscoveryStatus {
  return (LEAD_DISCOVERY_STATUSES as readonly string[]).includes(s);
}

export function isLeadTargetType(s: string): s is LeadTargetType {
  return (LEAD_TARGET_TYPES as readonly string[]).includes(s);
}
