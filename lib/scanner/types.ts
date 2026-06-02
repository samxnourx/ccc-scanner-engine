/** Query submitted from the /scanner search form. */
export type ScannerQuery = {
  /** Full name or business name */
  name: string;
  city?: string;
  state?: string;
  addressHint?: string;
  intakeId?: string;
};

/** Normalized row shown in the results table and sent to intake. */
export type NormalizedMatch = {
  id: string;
  sourceName: string;
  reportedOwnerName: string;
  holderName: string;
  propertyId: string;
  amount: string;
  reportedAddress: string;
  confidence: ScanConfidence;
  notes: string;
  /** Present when match came from SQLite `source_records` (not CSV stream fallback). */
  sourceRecordId?: number;
  /** Name similarity score from {@link scoreNameMatch} when sourced from DB rows. */
  nameMatchScore?: number;
  /** Catalog property / account type label when available. */
  propertyType?: string | null;
};

export type ScanConfidence = "possible" | "likely" | "unlikely" | string;

/** Payload item for POST /api/intakes/[intakeId]/scan-results */
export type IntakeScanResultPayload = {
  sourceName: string;
  reportedOwnerName: string;
  holderName: string;
  propertyId: string;
  amount: string;
  reportedAddress: string;
  propertyType?: string | null;
  accountType?: string | null;
  confidence: string;
  notes: string;
};
