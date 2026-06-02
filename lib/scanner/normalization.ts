import { formatAmountDisplay } from "./amounts";
import type { NormalizedMatch } from "./types";

/** Canonical fields resolved from arbitrary CA SCO CSV headers */
export type CaScoColumnMap = {
  owner: string | null;
  ownerFirst: string | null;
  ownerLast: string | null;
  holder: string | null;
  amount: string | null;
  propertyId: string | null;
  address1: string | null;
  address2: string | null;
  /** NAUPA-style third owner street line (e.g. OWNER_STREET_3) */
  address3: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  propertyType: string | null;
};

export function normalizeHeaderKey(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9\s]/gi, "");
}

/**
 * Substring match only for longer aliases so headers like NO_OF_OWNERS do not
 * match alias "owner" (legacy CLCC uses exact OWNER_NAME mapping).
 */
function scoreAlias(headerNorm: string, alias: string): number {
  if (headerNorm === alias) return 100;
  const MIN_SUBSTRING_ALIAS = 8;
  if (alias.length >= MIN_SUBSTRING_ALIAS && headerNorm.includes(alias)) {
    return 80;
  }
  if (
    alias.length >= MIN_SUBSTRING_ALIAS &&
    alias.includes(headerNorm) &&
    headerNorm.length >= 4
  ) {
    return 60;
  }
  return 0;
}

/** Match CSV column by normalized header key (underscore/spacing insensitive). */
export function pickExactHeaderKey(
  headers: string[],
  canonicalCandidates: string[],
): string | null {
  const targets = new Set(
    canonicalCandidates.map((c) => normalizeHeaderKey(c)),
  );
  for (const raw of headers) {
    const t = raw.trim();
    if (!t) continue;
    if (targets.has(normalizeHeaderKey(t))) {
      return t;
    }
  }
  return null;
}

/** Startup diagnostics for CA SCO CSV import / debugging column drift. */
export function logCaScoColumnBinding(
  logPrefix: string,
  cols: CaScoColumnMap,
  parsedHeaders: string[],
): void {
  const head = parsedHeaders.slice(0, 30);
  console.log(
    `${logPrefix} CSV headers (first 30, as parsed): ${JSON.stringify(head)}`,
  );
  console.log(
    `${logPrefix} Column mapping — ownerName: ${cols.owner ?? "(none)"}`,
  );
  console.log(
    `${logPrefix} Column mapping — propertyId: ${cols.propertyId ?? "(none)"}`,
  );
  console.log(
    `${logPrefix} Column mapping — holderName: ${cols.holder ?? "(none)"}`,
  );
  console.log(
    `${logPrefix} Column mapping — amount: ${cols.amount ?? "(none)"}`,
  );
  console.log(
    `${logPrefix} Column mapping — address (street lines): ${cols.address1 ?? "(none)"}, ${cols.address2 ?? "(none)"}, ${cols.address3 ?? "(none)"}`,
  );
  console.log(`${logPrefix} Column mapping — city: ${cols.city ?? "(none)"}`);
  console.log(
    `${logPrefix} Column mapping — state: ${cols.state ?? "(none)"}`,
  );
  console.log(`${logPrefix} Column mapping — zip: ${cols.zip ?? "(none)"}`);
  console.log(
    `${logPrefix} Column mapping — propertyType: ${cols.propertyType ?? "(none)"}`,
  );
}

function pickBestColumn(
  headers: string[],
  aliases: string[],
): string | null {
  let best: { raw: string; score: number } | null = null;
  for (const raw of headers) {
    const n = normalizeHeaderKey(raw);
    for (const alias of aliases) {
      const s = scoreAlias(n, alias);
      if (!best || s > best.score) {
        best = { raw, score: s };
      }
    }
  }
  return best && best.score >= 60 ? best.raw : null;
}

/**
 * Map CSV header row to record keys.
 * Prefers exact NAUPA / California bulk headers — mirrors legacy CLCC
 * `app/ingestors/import_california_source_records.py` (OWNER_NAME, PROPERTY_ID, …).
 */
export function resolveCaScoColumns(headers: string[]): CaScoColumnMap {
  const uniq = [...new Set(headers.map((h) => h.trim()).filter(Boolean))];

  const owner =
    pickExactHeaderKey(uniq, [
      "OWNER_NAME",
      "PROPERTY_OWNER_NAME",
      "OWNER NAME",
    ]) ??
    pickBestColumn(uniq, [
      "owner name",
      "property owner name",
      "reported owner name",
      "business name",
      "reported owner",
    ]);

  const ownerFirst =
    pickExactHeaderKey(uniq, ["OWNER_FIRST_NAME", "OWNER FIRST NAME"]) ??
    pickBestColumn(uniq, [
      "owner first name",
      "first name",
      "firstname",
      "given name",
    ]);

  const ownerLast =
    pickExactHeaderKey(uniq, ["OWNER_LAST_NAME", "OWNER LAST NAME"]) ??
    pickBestColumn(uniq, [
      "owner last name",
      "last name",
      "lastname",
      "surname",
      "family name",
    ]);

  const holder =
    pickExactHeaderKey(uniq, ["HOLDER_NAME", "HOLDER NAME"]) ??
    pickBestColumn(uniq, [
      "holder name",
      "reporting business name",
      "name of holder",
      "company name",
    ]);

  const amount =
    pickExactHeaderKey(uniq, [
      "CURRENT_CASH_BALANCE",
      "CASH_REPORTED",
      "CURRENT CASH BALANCE",
      "CASH REPORTED",
    ]) ??
    pickBestColumn(uniq, [
      "cash reported",
      "reported amount",
      "property value",
      "amount",
      "balance",
    ]);

  const propertyId =
    pickExactHeaderKey(uniq, ["PROPERTY_ID", "PROPERTY ID"]) ??
    pickBestColumn(uniq, [
      "property id",
      "property number",
      "upd property id",
      "record id",
      "claim id",
      "claim number",
    ]);

  const address1 =
    pickExactHeaderKey(uniq, [
      "OWNER_STREET_1",
      "OWNER STREET 1",
      "ADDRESS_LINE_1",
    ]) ??
    pickBestColumn(uniq, [
      "owner street 1",
      "address line 1",
      "address 1",
      "street address",
      "last known address",
      "owner address",
    ]);

  const address2 =
    pickExactHeaderKey(uniq, [
      "OWNER_STREET_2",
      "OWNER STREET 2",
      "ADDRESS_LINE_2",
    ]) ??
    pickBestColumn(uniq, [
      "owner street 2",
      "address line 2",
      "address 2",
      "suite",
      "unit",
    ]);

  const address3 =
    pickExactHeaderKey(uniq, ["OWNER_STREET_3", "OWNER STREET 3"]) ??
    pickBestColumn(uniq, ["owner street 3", "address line 3"]);

  const city =
    pickExactHeaderKey(uniq, ["OWNER_CITY", "OWNER CITY"]) ??
    pickBestColumn(uniq, ["owner city", "mail city", "city"]);

  const state =
    pickExactHeaderKey(uniq, ["OWNER_STATE", "OWNER STATE"]) ??
    pickBestColumn(uniq, ["owner state", "state"]);

  const zip =
    pickExactHeaderKey(uniq, ["OWNER_ZIP", "OWNER ZIP", "OWNER_ZIPCODE"]) ??
    pickBestColumn(uniq, [
      "owner zip",
      "zip code",
      "postal code",
      "zipcode",
      "zip",
    ]);

  const propertyType =
    pickExactHeaderKey(uniq, ["PROPERTY_TYPE", "PROPERTY TYPE"]) ??
    pickBestColumn(uniq, [
      "property type",
      "type of property",
      "asset type",
      "upd property type",
    ]);

  return {
    owner,
    ownerFirst,
    ownerLast,
    holder,
    amount,
    propertyId,
    address1,
    address2,
    address3,
    city,
    state,
    zip,
    propertyType,
  };
}

export function getOwnerLine(
  row: Record<string, string>,
  cols: CaScoColumnMap,
): string {
  if (cols.owner) {
    const v = (row[cols.owner] ?? "").trim();
    if (v) return v;
  }
  const first = cols.ownerFirst ? (row[cols.ownerFirst] ?? "").trim() : "";
  const last = cols.ownerLast ? (row[cols.ownerLast] ?? "").trim() : "";
  const combined = [first, last].filter(Boolean).join(" ").trim();
  return combined;
}

/** Street lines only (no city/state/zip) — for DB `address` column. */
export function buildStreetAddressLines(
  row: Record<string, string>,
  cols: CaScoColumnMap,
): string {
  const a1 = cols.address1 ? (row[cols.address1] ?? "").trim() : "";
  const a2 = cols.address2 ? (row[cols.address2] ?? "").trim() : "";
  const a3 = cols.address3 ? (row[cols.address3] ?? "").trim() : "";
  return [a1, a2, a3].filter(Boolean).join(", ").trim();
}

export function buildReportedAddress(
  row: Record<string, string>,
  cols: CaScoColumnMap,
): string {
  const parts: string[] = [];
  const a1 = cols.address1 ? (row[cols.address1] ?? "").trim() : "";
  const a2 = cols.address2 ? (row[cols.address2] ?? "").trim() : "";
  const a3 = cols.address3 ? (row[cols.address3] ?? "").trim() : "";
  const city = cols.city ? (row[cols.city] ?? "").trim() : "";
  const state = cols.state ? (row[cols.state] ?? "").trim() : "";
  const zip = cols.zip ? (row[cols.zip] ?? "").trim() : "";
  if (a1) parts.push(a1);
  if (a2) parts.push(a2);
  if (a3) parts.push(a3);
  const cityLine = [city, state, zip].filter(Boolean).join(" ").trim();
  if (cityLine) parts.push(cityLine);
  return parts.join(", ") || "—";
}

/** Display label for bulk UPD / DB rows keyed as `ca_sco`. */
export const CA_SCO_SOURCE_LABEL = "California SCO";

/** Display label for Excel estate listings keyed as `ca_sco_estates`. */
export const CA_SCO_ESTATES_SOURCE_LABEL = "California SCO Estates";

/** Display label for City of San Diego Finance unclaimed PDF imports. */
export const CITY_SD_FINANCE_UNCLAIMED_LABEL =
  "City of San Diego Unclaimed Monies";

/** Display label for San Diego County Auditor unclaimed warrant PDF imports. */
export const SD_COUNTY_AUDITOR_UNCLAIMED_LABEL =
  "San Diego County Auditor & Controller";

/** Display label for San Diego County TTC unclaimed / refund listings. */
export const SD_COUNTY_TTC_UNCLAIMED_LABEL =
  "San Diego County Treasurer-Tax Collector";

export type CaScoMatchParts = {
  row: Record<string, string>;
  cols: CaScoColumnMap;
  ownerLine: string;
  holderText: string;
  amountRaw: string;
  propertyIdText: string;
  reportedAddress: string;
  confidence: NormalizedMatch["confidence"];
  notes: string;
};

export function buildCaScoMatchParts(
  row: Record<string, string>,
  cols: CaScoColumnMap,
  ownerLine: string,
  nameNotes: string[],
  confidence: NormalizedMatch["confidence"],
): CaScoMatchParts {
  const holderText = cols.holder ? (row[cols.holder] ?? "").trim() : "";
  const amountRaw = cols.amount ? (row[cols.amount] ?? "").trim() : "";
  const propertyIdText = cols.propertyId
    ? (row[cols.propertyId] ?? "").trim()
    : "";

  const reportedAddress = buildReportedAddress(row, cols);

  const noteParts = [...nameNotes];
  noteParts.push("CA SCO bulk CSV row");

  return {
    row,
    cols,
    ownerLine,
    holderText,
    amountRaw,
    propertyIdText,
    reportedAddress,
    confidence,
    notes: noteParts.join("; "),
  };
}

export function caScoPartsToNormalized(
  parts: CaScoMatchParts,
): Omit<NormalizedMatch, "id"> {
  const propertyType = parts.cols.propertyType
    ? (parts.row[parts.cols.propertyType] ?? "").trim()
    : "";
  return {
    sourceName: CA_SCO_SOURCE_LABEL,
    reportedOwnerName: parts.ownerLine,
    holderName: parts.holderText || "—",
    propertyId: parts.propertyIdText || "—",
    amount: formatAmountDisplay(parts.amountRaw),
    reportedAddress: parts.reportedAddress,
    propertyType: propertyType || null,
    confidence: parts.confidence,
    notes: parts.notes,
  };
}

/**
 * Maps loose legacy/raw objects into NormalizedMatch (non-CA-SCO paths).
 */
export function normalizeScannerMatch(rawMatch: unknown): NormalizedMatch {
  const r = rawMatch as Record<string, unknown>;

  const sourceName = String(r.source ?? r.sourceName ?? "");
  const reportedOwnerName = String(
    r.owner ?? r.reportedOwnerName ?? r.reportedOwner ?? "",
  );
  const holderName = String(r.holder ?? r.holderName ?? "");
  const propertyId = String(r.propertyId ?? r.id ?? "");
  const amount = String(r.amount ?? "");
  const reportedAddress = String(r.address ?? r.reportedAddress ?? "");
  const confidence = String(r.confidence ?? "possible");
  const notes = String(r.reason ?? r.notes ?? "");
  const propertyType =
    typeof r.propertyType === "string"
      ? r.propertyType
      : typeof r.accountType === "string"
        ? r.accountType
        : null;

  return {
    id: "",
    sourceName,
    reportedOwnerName,
    holderName,
    propertyId,
    amount,
    reportedAddress,
    propertyType,
    confidence,
    notes,
  };
}
