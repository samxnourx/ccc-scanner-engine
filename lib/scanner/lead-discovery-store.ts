import "server-only";

import { randomUUID } from "crypto";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";

import { parseAmountToNumber } from "./amounts";
import {
  isLeadDiscoveryStatus,
  isLeadTargetType,
  type LeadDiscoveryRecord,
  type LeadDiscoveryScannerQueryJson,
  type LeadDiscoveryStatus,
  type LeadTargetType,
  toScannerQueryJson,
} from "./lead-discovery-types";
import {
  ensureReportNumbersOnLeads,
  isValidAssignedReportNumber,
  reportNumberFromPersisted,
} from "./report-number";
import type { NormalizedMatch, ScannerQuery } from "./types";

const FILE_VERSION = 1;
const FILE_NAME = "lead-discoveries.json";

function storePath(): string {
  return path.join(process.cwd(), "data", FILE_NAME);
}

type FileEnvelope = {
  version: number;
  leads: LeadDiscoveryPersisted[];
};

/** Shape on disk (field names match product spec). Optional fields support legacy rows. */
export type LeadDiscoveryPersisted = {
  leadDiscoveryId: string;
  /** e.g. ROR-2026-0001 — assigned when the record is created. */
  reportNumber?: string;
  searchQuery?: LeadDiscoveryScannerQueryJson;
  /** @deprecated use searchQuery */
  scannerQuery?: LeadDiscoveryScannerQueryJson;
  targetName: string;
  targetType: string | null;
  status: string;
  matchCount: number;
  estimatedTotalAmount: number | null;
  matches?: NormalizedMatch[];
  outreachMatches?: NormalizedMatch[];
  outreachEmailTo?: string | null;
  outreachEmailSubject?: string | null;
  outreachEmailText?: string | null;
  outreachPortalUrl?: string | null;
  outreachIntakeId?: string | null;
  outreachSentAt?: string | null;
  mailingAddress?: string | null;
  /** @deprecated use matches */
  matchesSnapshot?: unknown;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

function sumEstimatedAmount(matches: NormalizedMatch[]): number | null {
  let sum = 0;
  let any = false;
  for (const m of matches) {
    const n = parseAmountToNumber(m.amount);
    if (n !== null) {
      sum += n;
      any = true;
    }
  }
  return any ? sum : null;
}

function parseMatchRow(raw: unknown): NormalizedMatch | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    id: typeof r.id === "string" ? r.id : "",
    sourceName: typeof r.sourceName === "string" ? r.sourceName : "",
    reportedOwnerName:
      typeof r.reportedOwnerName === "string" ? r.reportedOwnerName : "",
    holderName: typeof r.holderName === "string" ? r.holderName : "",
    propertyId: typeof r.propertyId === "string" ? r.propertyId : "",
    amount: typeof r.amount === "string" ? r.amount : "",
    reportedAddress:
      typeof r.reportedAddress === "string" ? r.reportedAddress : "",
    propertyType:
      typeof r.propertyType === "string"
        ? r.propertyType
        : typeof r.accountType === "string"
          ? r.accountType
          : null,
    confidence: typeof r.confidence === "string" ? r.confidence : "possible",
    notes: typeof r.notes === "string" ? r.notes : "",
  };
}

function computeNextReportNumber(
  leads: LeadDiscoveryPersisted[],
  year: number,
): string {
  const re = new RegExp(`^ROR-${year}-(\\d+)$`);
  let max = 0;
  for (const l of leads) {
    const rn = l.reportNumber?.trim();
    if (!rn || !isValidAssignedReportNumber(rn)) continue;
    const m = rn.match(re);
    if (m) max = Math.max(max, parseInt(m[1]!, 10));
  }
  return `ROR-${year}-${String(max + 1).padStart(4, "0")}`;
}

function parseSearchQuery(raw: unknown): LeadDiscoveryScannerQueryJson {
  if (!raw || typeof raw !== "object") {
    return {
      name: "",
      city: null,
      state: null,
      addressHint: null,
      intakeId: null,
    };
  }
  const o = raw as Record<string, unknown>;
  return {
    name: typeof o.name === "string" ? o.name : "",
    city: typeof o.city === "string" ? o.city : null,
    state: typeof o.state === "string" ? o.state : null,
    addressHint: typeof o.addressHint === "string" ? o.addressHint : null,
    intakeId: typeof o.intakeId === "string" ? o.intakeId : null,
  };
}

/** Normalize persisted row (supports legacy scannerQuery / matchesSnapshot). */
function persistedToRecord(p: LeadDiscoveryPersisted): LeadDiscoveryRecord {
  const searchQuery =
    p.searchQuery ?? parseSearchQuery(p.scannerQuery ?? undefined);
  let matches = Array.isArray(p.matches)
    ? (p.matches.map(parseMatchRow).filter(Boolean) as NormalizedMatch[])
    : [];
  if (matches.length === 0 && Array.isArray(p.matchesSnapshot)) {
    matches = p.matchesSnapshot
      .map(parseMatchRow)
      .filter(Boolean) as NormalizedMatch[];
  }
  const outreachMatches = Array.isArray(p.outreachMatches)
    ? (p.outreachMatches.map(parseMatchRow).filter(Boolean) as NormalizedMatch[])
    : [];

  const status = isLeadDiscoveryStatus(p.status) ? p.status : "detected";
  const targetType =
    p.targetType && isLeadTargetType(p.targetType) ? p.targetType : null;

  const reportNumber = reportNumberFromPersisted(p.reportNumber);

  return {
    leadDiscoveryId: p.leadDiscoveryId,
    reportNumber,
    searchQuery,
    targetName: p.targetName || searchQuery.name,
    targetType,
    status,
    matchCount:
      typeof p.matchCount === "number" ? p.matchCount : matches.length,
    estimatedTotalAmount:
      typeof p.estimatedTotalAmount === "number" ? p.estimatedTotalAmount : null,
    matches,
    outreachMatches,
    outreachEmailTo:
      typeof p.outreachEmailTo === "string" ? p.outreachEmailTo : null,
    outreachEmailSubject:
      typeof p.outreachEmailSubject === "string" ? p.outreachEmailSubject : null,
    outreachEmailText:
      typeof p.outreachEmailText === "string" ? p.outreachEmailText : null,
    outreachPortalUrl:
      typeof p.outreachPortalUrl === "string" ? p.outreachPortalUrl : null,
    outreachIntakeId:
      typeof p.outreachIntakeId === "string" ? p.outreachIntakeId : null,
    outreachSentAt:
      typeof p.outreachSentAt === "string" ? p.outreachSentAt : null,
    mailingAddress:
      typeof p.mailingAddress === "string" ? p.mailingAddress : null,
    notes: typeof p.notes === "string" ? p.notes : "",
    createdAt: p.createdAt || new Date(0).toISOString(),
    updatedAt: p.updatedAt || p.createdAt || new Date(0).toISOString(),
  };
}

function emptyEnvelope(): FileEnvelope {
  return { version: FILE_VERSION, leads: [] };
}

async function readEnvelopeFromDisk(): Promise<FileEnvelope> {
  const fp = storePath();
  try {
    const raw = await readFile(fp, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return emptyEnvelope();
    const o = parsed as Record<string, unknown>;
    if (!Array.isArray(o.leads)) return emptyEnvelope();
    return {
      version: typeof o.version === "number" ? o.version : FILE_VERSION,
      leads: o.leads as LeadDiscoveryPersisted[],
    };
  } catch (e: unknown) {
    const code = typeof e === "object" && e && "code" in e ? String((e as { code: unknown }).code) : "";
    if (code === "ENOENT") return emptyEnvelope();
    throw e;
  }
}

/** Reads store and persists assigned report numbers for legacy rows when needed. */
async function readEnvelope(): Promise<FileEnvelope> {
  const env = await readEnvelopeFromDisk();
  if (ensureReportNumbersOnLeads(env.leads)) {
    env.version = FILE_VERSION;
    await writeEnvelope(env);
  }
  return env;
}

async function writeEnvelope(env: FileEnvelope): Promise<void> {
  const fp = storePath();
  const dir = path.dirname(fp);
  await mkdir(dir, { recursive: true });
  const body = `${JSON.stringify(env, null, 2)}\n`;
  const tmp = `${fp}.${randomUUID()}.tmp`;
  await writeFile(tmp, body, "utf8");
  await rename(tmp, fp);
}

/** Raw persisted rows (unsorted). */
export async function readLeadDiscoveries(): Promise<LeadDiscoveryRecord[]> {
  const env = await readEnvelope();
  return env.leads.map(persistedToRecord);
}

export async function listLeadDiscoveries(): Promise<LeadDiscoveryRecord[]> {
  const rows = await readLeadDiscoveries();
  return [...rows].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export async function getLeadDiscovery(
  id: string,
): Promise<LeadDiscoveryRecord | null> {
  const trimmed = id.trim();
  if (!trimmed) return null;
  const env = await readEnvelope();
  const hit = env.leads.find((l) => l.leadDiscoveryId === trimmed);
  if (!hit) return null;
  return persistedToRecord(hit);
}

export async function createLeadDiscovery(input: {
  scannerQuery: ScannerQuery;
  matches: NormalizedMatch[];
}): Promise<string> {
  const { scannerQuery, matches } = input;
  if (!scannerQuery.name.trim()) {
    throw new Error("Search name is required.");
  }
  if (matches.length === 0) {
    throw new Error("At least one match is required to save a lead discovery.");
  }

  const snapshot = matches.map((m) => ({ ...m }));
  const est = sumEstimatedAmount(snapshot);
  const searchQuery = toScannerQueryJson(scannerQuery);
  const now = new Date().toISOString();
  const id = randomUUID();
  const env = await readEnvelope();
  const year = new Date().getFullYear();
  const reportNumber = computeNextReportNumber(env.leads, year);

  const row: LeadDiscoveryPersisted = {
    leadDiscoveryId: id,
    reportNumber,
    searchQuery,
    targetName: searchQuery.name,
    targetType: null,
    status: "detected",
    matchCount: snapshot.length,
    estimatedTotalAmount: est,
    matches: snapshot,
    notes: "",
    createdAt: now,
    updatedAt: now,
  };

  env.version = FILE_VERSION;
  env.leads.push(row);
  await writeEnvelope(env);

  console.log(
    `[lead-discovery] JSON store created id=${id} reportNumber=${reportNumber} matches=${snapshot.length} est=${est ?? "n/a"}`,
  );

  return id;
}

export type LeadDiscoveryUpdatePatch = {
  status?: LeadDiscoveryStatus;
  notes?: string;
  targetName?: string;
  targetType?: LeadTargetType | null;
  outreachEmailTo?: string | null;
  outreachEmailSubject?: string | null;
  outreachEmailText?: string | null;
  outreachPortalUrl?: string | null;
  outreachIntakeId?: string | null;
  outreachSentAt?: string | null;
  mailingAddress?: string | null;
  outreachMatches?: NormalizedMatch[];
};

export async function updateLeadDiscovery(
  id: string,
  patch: LeadDiscoveryUpdatePatch,
): Promise<void> {
  const trimmed = id.trim();
  if (!trimmed) throw new Error("Lead ID is required.");

  const env = await readEnvelope();
  const idx = env.leads.findIndex((l) => l.leadDiscoveryId === trimmed);
  if (idx === -1) {
    throw new Error("Lead discovery not found.");
  }

  const cur = env.leads[idx]!;
  const now = new Date().toISOString();
  const next: LeadDiscoveryPersisted = {
    ...cur,
    status: patch.status ?? cur.status,
    notes: patch.notes ?? cur.notes,
    targetName:
      patch.targetName !== undefined
        ? patch.targetName.trim() || "—"
        : cur.targetName,
    targetType:
      patch.targetType !== undefined ? patch.targetType : cur.targetType,
    outreachEmailTo:
      patch.outreachEmailTo !== undefined ? patch.outreachEmailTo : cur.outreachEmailTo,
    outreachEmailSubject:
      patch.outreachEmailSubject !== undefined
        ? patch.outreachEmailSubject
        : cur.outreachEmailSubject,
    outreachEmailText:
      patch.outreachEmailText !== undefined
        ? patch.outreachEmailText
        : cur.outreachEmailText,
    outreachPortalUrl:
      patch.outreachPortalUrl !== undefined
        ? patch.outreachPortalUrl
        : cur.outreachPortalUrl,
    outreachIntakeId:
      patch.outreachIntakeId !== undefined
        ? patch.outreachIntakeId
        : cur.outreachIntakeId,
    outreachSentAt:
      patch.outreachSentAt !== undefined
        ? patch.outreachSentAt
        : cur.outreachSentAt,
    mailingAddress:
      patch.mailingAddress !== undefined
        ? patch.mailingAddress
        : cur.mailingAddress,
    outreachMatches:
      patch.outreachMatches !== undefined
        ? patch.outreachMatches.map((m) => ({ ...m }))
        : cur.outreachMatches,
    updatedAt: now,
  };

  env.leads[idx] = next;
  await writeEnvelope(env);
  console.log(
    `[lead-discovery] JSON store updated id=${trimmed} status=${next.status}`,
  );
}

export async function deleteLeadDiscoveries(ids: string[]): Promise<number> {
  const targets = new Set(ids.map((id) => id.trim()).filter(Boolean));
  if (targets.size === 0) return 0;

  const env = await readEnvelope();
  const before = env.leads.length;
  env.leads = env.leads.filter((lead) => !targets.has(lead.leadDiscoveryId));
  const deleted = before - env.leads.length;
  if (deleted > 0) {
    env.version = FILE_VERSION;
    await writeEnvelope(env);
    console.log(
      `[lead-discovery] JSON store deleted ${deleted.toLocaleString("en-US")} saved lead(s)`,
    );
  }
  return deleted;
}

/**
 * After a staff-sent report email: set status to outreach_sent and append audit line to notes.
 */
export async function markLeadReportEmailed(input: {
  leadDiscoveryId: string;
  recipientEmail: string;
  staffOptionalNote?: string;
}): Promise<void> {
  const id = input.leadDiscoveryId.trim();
  if (!id) throw new Error("Lead ID is required.");

  const env = await readEnvelope();
  const idx = env.leads.findIndex((l) => l.leadDiscoveryId === id);
  if (idx === -1) throw new Error("Lead discovery not found.");

  const cur = env.leads[idx]!;
  const sentOn = new Date().toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const audit = `Report emailed to ${input.recipientEmail.trim()} on ${sentOn}`;
  const parts = [
    (cur.notes ?? "").trim(),
    audit,
    (input.staffOptionalNote ?? "").trim(),
  ].filter(Boolean);
  const newNotes = parts.join("\n\n");

  const now = new Date().toISOString();
  env.leads[idx] = {
    ...cur,
    status: "outreach_sent",
    notes: newNotes,
    updatedAt: now,
  };
  await writeEnvelope(env);
  console.log(`[lead-discovery] report email audit id=${id} to=${input.recipientEmail.trim()}`);
}
