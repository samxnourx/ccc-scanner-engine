import "server-only";

import type { LeadBusiness } from "@prisma/client";

import { CA_SCO_SOURCE_KEY } from "./ca-sco-keys";
import { prisma } from "./db/client";
import { leadOutreachEmailBody, leadOutreachEmailSubject } from "./lead-outreach-copy";
import {
  postEnrichBusinessContact,
  type LeadEnrichmentSuccess,
} from "./lead-enrichment-client";
import { runScannerForLeadBusiness } from "./run-scanner-for-lead";

export type LeadImportRow = {
  businessName: string;
  /** Primary recipient email (normalized). */
  email: string;
  /** JSON array string of all emails (deduped, primary first). */
  emailsJson?: string | null;
  emailsRaw?: string | null;
  website?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  externalLeadId?: string;
  emailQuality?: string;
  websiteFound?: boolean;
};

/** Dedupe by lowercase; preserve first-seen casing and order. */
export function dedupeEmailsCaseInsensitiveOrdered(addresses: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of addresses) {
    const a = raw.trim();
    if (!a.includes("@")) continue;
    const k = a.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  return out;
}

/** Split a delimiter-separated blob (Lead Scanner `emailsRaw` or a single string `emails`). */
export function splitEmailsFromDelimitedRaw(raw: string): string[] {
  const t = raw.trim();
  if (!t) return [];
  const parts = t.split(/[;,|\n\r]+/).map((s) => s.trim()).filter(Boolean);
  return parts.filter((p) => p.includes("@"));
}

/** Normalize `emails` when it is an array of strings or one delimiter-separated string. */
export function emailsFromUnknown(val: unknown): string[] {
  if (val == null) return [];
  if (Array.isArray(val)) {
    const out: string[] = [];
    for (const x of val) {
      const s = String(x).trim();
      if (!s) continue;
      if (s.includes("@")) out.push(s);
    }
    return out;
  }
  if (typeof val === "string") return splitEmailsFromDelimitedRaw(val);
  return [];
}

/**
 * Merge Lead Scanner `email`, `emails` (array or delimited string), optional `emailsRaw`
 * (also split). Primary = `email` if valid (`@`), else first usable merged address.
 */
export function normalizeLeadBusinessEmailsFromPayload(o: Record<string, unknown>): {
  primary: string;
  allOrdered: string[];
  emailsRaw: string | null;
} {
  const emailsRawRaw = o.emailsRaw;
  const emailsRaw =
    emailsRawRaw != null && String(emailsRawRaw).trim()
      ? String(emailsRawRaw).trim()
      : null;

  const primaryInput = String(o.email ?? "").trim();

  const fromEmails = emailsFromUnknown(o.emails);
  const fromRawSplit = emailsRaw ? splitEmailsFromDelimitedRaw(emailsRaw) : [];

  const orderedCandidates: string[] = [];
  if (primaryInput.includes("@")) orderedCandidates.push(primaryInput);
  orderedCandidates.push(...fromEmails, ...fromRawSplit);

  const mergedFirstPass = dedupeEmailsCaseInsensitiveOrdered(orderedCandidates);

  const primary =
    primaryInput.includes("@") ? primaryInput : mergedFirstPass[0] ?? "";

  let allOrdered: string[];
  if (primary) {
    const pk = primary.toLowerCase();
    const rest = mergedFirstPass.filter((x) => x.toLowerCase() !== pk);
    allOrdered = [primary, ...rest];
  } else {
    allOrdered = mergedFirstPass;
  }

  return { primary, allOrdered, emailsRaw };
}

export type ScannerDatasetStatus = {
  sourceRecordsTotal: number;
  caScoCount: number;
  lastCaScoImportedAt: string | null;
  caScoDataPath: string | null;
  healthMinRows: number;
  caScoDatasetHealthy: boolean;
};

export async function getScannerDatasetStatus(): Promise<ScannerDatasetStatus> {
  const healthMinRows = Number.parseInt(
    process.env.CA_SCO_HEALTH_MIN_ROWS || "500000",
    10,
  );
  const minRows = Number.isFinite(healthMinRows) && healthMinRows > 0 ? healthMinRows : 500_000;
  const cachedCaScoRows = Number.parseInt(
    process.env.CA_SCO_IMPORTED_ROW_COUNT || "",
    10,
  );

  if (Number.isFinite(cachedCaScoRows) && cachedCaScoRows > 0) {
    return {
      sourceRecordsTotal: cachedCaScoRows,
      caScoCount: cachedCaScoRows,
      lastCaScoImportedAt: null,
      caScoDataPath: process.env.CA_SCO_DATA_PATH?.trim() || null,
      healthMinRows: minRows,
      caScoDatasetHealthy: cachedCaScoRows >= minRows,
    };
  }

  const [sourceRecordsTotal, caScoCount, agg] = await Promise.all([
    prisma.sourceRecord.count(),
    prisma.sourceRecord.count({ where: { source: CA_SCO_SOURCE_KEY } }),
    prisma.sourceRecord.aggregate({
      where: { source: CA_SCO_SOURCE_KEY },
      _max: { importedAt: true },
    }),
  ]);

  return {
    sourceRecordsTotal,
    caScoCount,
    lastCaScoImportedAt: agg._max.importedAt?.toISOString() ?? null,
    caScoDataPath: process.env.CA_SCO_DATA_PATH?.trim() || null,
    healthMinRows: minRows,
    caScoDatasetHealthy: caScoCount >= minRows,
  };
}

function parseImportRows(raw: unknown): LeadImportRow[] {
  if (!Array.isArray(raw)) {
    throw new Error("JSON must be an array of business objects.");
  }
  const out: LeadImportRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const businessName = String(o.businessName ?? "").trim();
    const norm = normalizeLeadBusinessEmailsFromPayload(o);
    if (!businessName) continue;
    if (!norm.primary && norm.allOrdered.length === 0) {
      throw new Error(`Invalid or missing email for business "${businessName}".`);
    }
    const primaryEmail = norm.primary || norm.allOrdered[0]!;
    const emailsJson =
      norm.allOrdered.length > 0
        ? JSON.stringify(norm.allOrdered)
        : JSON.stringify(primaryEmail ? [primaryEmail] : []);
    out.push({
      businessName,
      email: primaryEmail.trim(),
      emailsJson,
      emailsRaw: norm.emailsRaw,
      website: o.website != null ? String(o.website) : undefined,
      phone: o.phone != null ? String(o.phone) : undefined,
      address: o.address != null ? String(o.address) : undefined,
      city: o.city != null ? String(o.city) : undefined,
      state: o.state != null ? String(o.state) : undefined,
      externalLeadId: o.externalLeadId != null ? String(o.externalLeadId) : undefined,
      emailQuality: o.emailQuality != null ? String(o.emailQuality) : undefined,
      websiteFound:
        typeof o.websiteFound === "boolean" ? o.websiteFound : undefined,
    });
  }
  if (out.length === 0) {
    throw new Error("No valid rows (need businessName + email per row).");
  }
  return out;
}

/**
 * Lead Scanner API / loose import: require `businessName`; email and website optional.
 */
export function parseApiLeadImportBusinesses(businesses: unknown): LeadImportRow[] {
  if (!Array.isArray(businesses)) {
    throw new Error("businesses must be an array.");
  }
  if (businesses.length === 0) {
    throw new Error("businesses must be a non-empty array.");
  }
  const out: LeadImportRow[] = [];
  for (const item of businesses) {
    if (!item || typeof item !== "object") {
      throw new Error("Each business must be an object.");
    }
    const o = item as Record<string, unknown>;
    const businessName = String(o.businessName ?? "").trim();
    if (!businessName) {
      throw new Error("Each business must include a non-empty businessName.");
    }
    const norm = normalizeLeadBusinessEmailsFromPayload(o);
    const primaryEmail = norm.primary || norm.allOrdered[0] || "";
    const emailsJson =
      norm.allOrdered.length > 0
        ? JSON.stringify(norm.allOrdered)
        : JSON.stringify(primaryEmail ? [primaryEmail] : []);

    out.push({
      businessName,
      email: primaryEmail.trim(),
      emailsJson,
      emailsRaw: norm.emailsRaw,
      website: o.website != null ? String(o.website) : undefined,
      phone: o.phone != null ? String(o.phone) : undefined,
      address: o.address != null ? String(o.address) : undefined,
      city: o.city != null ? String(o.city) : undefined,
      state: o.state != null ? String(o.state) : undefined,
      externalLeadId: o.externalLeadId != null ? String(o.externalLeadId) : undefined,
      emailQuality: o.emailQuality != null ? String(o.emailQuality) : undefined,
      websiteFound:
        typeof o.websiteFound === "boolean" ? o.websiteFound : undefined,
    });
  }
  return out;
}

export async function importLeadBatchRows(input: {
  batchName: string;
  rows: LeadImportRow[];
}): Promise<{ batchId: number }> {
  if (input.rows.length === 0) {
    throw new Error("No businesses to import.");
  }

  const batch = await prisma.leadScanBatch.create({
    data: {
      name: input.batchName.trim() || `Lead import ${new Date().toISOString()}`,
      status: "imported",
      totalBusinesses: input.rows.length,
    },
  });

  await prisma.leadBusiness.createMany({
    data: input.rows.map((r) => ({
      batchId: batch.id,
      externalLeadId: r.externalLeadId?.trim() || null,
      businessName: r.businessName,
      email: r.email.trim(),
      website: r.website?.trim() || "",
      phone: r.phone?.trim() || null,
      address: r.address?.trim() || null,
      city: r.city?.trim() || null,
      state: r.state?.trim() || null,
      source: "lead_scanner",
      emailQuality: r.emailQuality?.trim() || null,
      websiteFound: r.websiteFound ?? null,
      outreachStatus: "not_scanned",
      emailsJson: r.emailsJson ?? null,
      emailsRaw: r.emailsRaw ?? null,
    })),
  });

  return { batchId: batch.id };
}

export async function importLeadBatchFromJson(input: {
  batchName: string;
  jsonText: string;
}): Promise<{ batchId: number }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.jsonText);
  } catch {
    throw new Error("Invalid JSON.");
  }
  const rows = parseImportRows(parsed);
  return importLeadBatchRows({ batchName: input.batchName, rows });
}

async function refreshBatchRollups(batchId: number): Promise<void> {
  const [approvedEmailCount, sentEmailCount, matchesFoundCount] =
    await Promise.all([
      prisma.leadBusiness.count({
        where: { batchId, outreachStatus: "approved_for_email" },
      }),
      prisma.leadBusiness.count({
        where: { batchId, outreachStatus: { in: ["email_sent", "responded"] } },
      }),
      prisma.leadBusiness.count({
        where: { batchId, matches: { some: {} } },
      }),
    ]);

  await prisma.leadScanBatch.update({
    where: { id: batchId },
    data: { approvedEmailCount, sentEmailCount, matchesFoundCount },
  });
}

export async function runLeadBatchScan(batchId: number): Promise<void> {
  const batch = await prisma.leadScanBatch.findUnique({
    where: { id: batchId },
    include: { businesses: true },
  });
  if (!batch) throw new Error("Batch not found.");
  if (batch.businesses.length === 0) {
    throw new Error("Batch has no businesses to scan.");
  }

  await prisma.leadScanBatch.update({
    where: { id: batchId },
    data: { status: "scanning" },
  });

  await prisma.leadBusinessMatch.deleteMany({ where: { batchId } });

  for (const b of batch.businesses) {
    try {
      const addressHint = [b.address, b.city, b.state]
        .filter(Boolean)
        .join(", ")
        .trim();

      const matches = await runScannerForLeadBusiness({
        businessName: b.businessName,
        city: b.city,
        state: b.state,
        addressHint: addressHint || undefined,
      });

      if (matches.length > 0) {
        await prisma.leadBusinessMatch.createMany({
          data: matches.map((m) => ({
            leadBusinessId: b.id,
            batchId,
            sourceRecordId: m.sourceRecordId ?? null,
            sourceName: m.sourceName,
            reportedOwnerName: m.reportedOwnerName,
            holderName: m.holderName,
            propertyId: m.propertyId,
            amount: m.amount || null,
            reportedAddress: m.reportedAddress,
            accountType: m.propertyType ?? null,
            confidence: String(m.confidence),
            matchScore: m.nameMatchScore ?? null,
            notes: m.notes,
          })),
        });
      }

      await prisma.leadBusiness.update({
        where: { id: b.id },
        data: {
          lastScannedAt: new Date(),
          outreachStatus: matches.length > 0 ? "matches_found" : "no_matches",
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await prisma.leadBusiness.update({
        where: { id: b.id },
        data: {
          lastScannedAt: new Date(),
          outreachStatus: "no_matches",
          notes: `${b.notes ? `${b.notes}\n` : ""}[scan error] ${msg}`.slice(0, 8000),
        },
      });
    }
  }

  const scannedCount = batch.businesses.length;
  const matchesFoundCount = await prisma.leadBusiness.count({
    where: { batchId, matches: { some: {} } },
  });

  await prisma.leadScanBatch.update({
    where: { id: batchId },
    data: {
      status: "review_needed",
      scannedCount,
      matchesFoundCount,
    },
  });

  await refreshBatchRollups(batchId);
}

export async function runLeadBatchScanForBusinesses(input: {
  batchId: number;
  leadBusinessIds: number[];
}): Promise<void> {
  const ids = [...new Set(input.leadBusinessIds)]
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (ids.length === 0) {
    throw new Error("Select at least one business to scan.");
  }

  const batch = await prisma.leadScanBatch.findUnique({
    where: { id: input.batchId },
    select: { id: true },
  });
  if (!batch) throw new Error("Batch not found.");

  const businesses = await prisma.leadBusiness.findMany({
    where: {
      batchId: input.batchId,
      id: { in: ids },
    },
    orderBy: { id: "asc" },
  });
  if (businesses.length === 0) {
    throw new Error("No selected businesses were found in this batch.");
  }

  await prisma.leadScanBatch.update({
    where: { id: input.batchId },
    data: { status: "scanning" },
  });

  await prisma.leadBusinessMatch.deleteMany({
    where: {
      batchId: input.batchId,
      leadBusinessId: { in: businesses.map((b) => b.id) },
    },
  });

  for (const b of businesses) {
    try {
      const addressHint = [b.address, b.city, b.state]
        .filter(Boolean)
        .join(", ")
        .trim();

      const matches = await runScannerForLeadBusiness({
        businessName: b.businessName,
        city: b.city,
        state: b.state,
        addressHint: addressHint || undefined,
      });

      if (matches.length > 0) {
        await prisma.leadBusinessMatch.createMany({
          data: matches.map((m) => ({
            leadBusinessId: b.id,
            batchId: input.batchId,
            sourceRecordId: m.sourceRecordId ?? null,
            sourceName: m.sourceName,
            reportedOwnerName: m.reportedOwnerName,
            holderName: m.holderName,
            propertyId: m.propertyId,
            amount: m.amount || null,
            reportedAddress: m.reportedAddress,
            accountType: m.propertyType ?? null,
            confidence: String(m.confidence),
            matchScore: m.nameMatchScore ?? null,
            notes: m.notes,
          })),
        });
      }

      await prisma.leadBusiness.update({
        where: { id: b.id },
        data: {
          lastScannedAt: new Date(),
          outreachStatus: matches.length > 0 ? "matches_found" : "no_matches",
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await prisma.leadBusiness.update({
        where: { id: b.id },
        data: {
          lastScannedAt: new Date(),
          outreachStatus: "no_matches",
          notes: `${b.notes ? `${b.notes}\n` : ""}[scan error] ${msg}`.slice(0, 8000),
        },
      });
    }
  }

  const [scannedCount, matchesFoundCount] = await Promise.all([
    prisma.leadBusiness.count({
      where: { batchId: input.batchId, lastScannedAt: { not: null } },
    }),
    prisma.leadBusiness.count({
      where: { batchId: input.batchId, matches: { some: {} } },
    }),
  ]);

  await prisma.leadScanBatch.update({
    where: { id: input.batchId },
    data: {
      status: "review_needed",
      scannedCount,
      matchesFoundCount,
    },
  });

  await refreshBatchRollups(input.batchId);
}

export async function setLeadBusinessOutreachStatus(input: {
  batchId: number;
  leadBusinessIds: number[];
  outreachStatus:
    | "approved_for_email"
    | "rejected"
    | "do_not_contact"
    | "not_scanned"
    | "matches_found"
    | "no_matches"
    | "email_sent"
    | "responded";
}): Promise<void> {
  if (input.leadBusinessIds.length === 0) return;

  for (const id of input.leadBusinessIds) {
    const lead = await prisma.leadBusiness.findFirst({
      where: { id, batchId: input.batchId },
      include: { matches: { take: 1 } },
    });
    if (!lead) continue;

    if (input.outreachStatus === "approved_for_email" && lead.matches.length === 0) continue;

    await prisma.leadBusiness.update({
      where: { id },
      data: { outreachStatus: input.outreachStatus },
    });
  }

  await refreshBatchRollups(input.batchId);
}

export async function markLeadOutreachEmailsSent(input: {
  batchId: number;
  leadBusinessIds: number[];
}): Promise<{ updatedCount: number }> {
  if (input.leadBusinessIds.length === 0) return { updatedCount: 0 };
  let updatedCount = 0;

  for (const id of input.leadBusinessIds) {
    const lead = await prisma.leadBusiness.findFirst({
      where: {
        id,
        batchId: input.batchId,
      },
    });
    if (!lead) continue;

    await prisma.leadBusiness.update({
      where: { id },
      data: {
        outreachStatus: "email_sent",
        notes: `${lead.notes ? `${lead.notes}\n` : ""}[outreach] Marked email_sent ${new Date().toISOString()} (sent outside this app by staff).`.slice(
          0,
          8000,
        ),
      },
    });
    updatedCount += 1;
  }

  await refreshBatchRollups(input.batchId);
  return { updatedCount };
}

export async function markLeadBusinessesResponded(input: {
  batchId: number;
  leadBusinessIds: number[];
}): Promise<{ updatedCount: number }> {
  if (input.leadBusinessIds.length === 0) return { updatedCount: 0 };
  let updatedCount = 0;

  for (const id of input.leadBusinessIds) {
    const lead = await prisma.leadBusiness.findFirst({
      where: {
        id,
        batchId: input.batchId,
      },
    });
    if (!lead) continue;

    await prisma.leadBusiness.update({
      where: { id },
      data: {
        outreachStatus: "responded",
        notes: `${lead.notes ? `${lead.notes}\n` : ""}[outreach] Marked responded ${new Date().toISOString()}.`.slice(
          0,
          8000,
        ),
      },
    });
    updatedCount += 1;
  }

  await refreshBatchRollups(input.batchId);
  return { updatedCount };
}

export async function deleteLeadBusinessesFromBatch(input: {
  batchId: number;
  leadBusinessIds: number[];
}): Promise<{ deletedCount: number }> {
  const ids = [...new Set(input.leadBusinessIds)]
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (ids.length === 0) return { deletedCount: 0 };

  const result = await prisma.leadBusiness.deleteMany({
    where: {
      batchId: input.batchId,
      id: { in: ids },
    },
  });

  const [totalBusinesses, scannedCount, matchesFoundCount] = await Promise.all([
    prisma.leadBusiness.count({ where: { batchId: input.batchId } }),
    prisma.leadBusiness.count({
      where: { batchId: input.batchId, lastScannedAt: { not: null } },
    }),
    prisma.leadBusiness.count({
      where: { batchId: input.batchId, matches: { some: {} } },
    }),
  ]);

  await prisma.leadScanBatch.update({
    where: { id: input.batchId },
    data: {
      totalBusinesses,
      scannedCount,
      matchesFoundCount,
    },
  });
  await refreshBatchRollups(input.batchId);
  return { deletedCount: result.count };
}

export async function removeLeadBusinessesFromDashboard(input: {
  leadBusinessIds: number[];
}): Promise<{ updatedCount: number }> {
  const ids = [...new Set(input.leadBusinessIds)]
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (ids.length === 0) return { updatedCount: 0 };

  const leads = await prisma.leadBusiness.findMany({
    where: { id: { in: ids } },
    include: { matches: { select: { id: true }, take: 1 } },
  });
  const touchedBatchIds = new Set<number>();
  let updatedCount = 0;

  for (const lead of leads) {
    const resetStatus = lead.matches.length > 0
      ? "matches_found"
      : lead.lastScannedAt
        ? "no_matches"
        : "not_scanned";
    touchedBatchIds.add(lead.batchId);
    await prisma.leadBusiness.update({
      where: { id: lead.id },
      data: {
        outreachStatus: resetStatus,
        outreachEmailTo: null,
        outreachEmailSubject: null,
        outreachEmailText: null,
        outreachPortalUrl: null,
        outreachIntakeId: null,
        outreachSentAt: null,
        notes:
          `${lead.notes ? `${lead.notes}\n` : ""}[dashboard] Removed from lead dashboard ${new Date().toISOString()}.`.slice(
            0,
            8000,
          ),
      },
    });
    updatedCount += 1;
  }

  for (const batchId of touchedBatchIds) {
    await refreshBatchRollups(batchId);
  }
  return { updatedCount };
}

export async function buildLeadOutreachDraftsText(
  batchId: number,
): Promise<string> {
  const leads = await prisma.leadBusiness.findMany({
    where: {
      batchId,
      outreachStatus: "approved_for_email",
      matches: { some: {} },
    },
    include: {
      matches: {
        orderBy: [{ matchScore: "desc" }, { id: "asc" }],
        take: 5,
      },
    },
    orderBy: { id: "asc" },
  });

  if (leads.length === 0) {
    return "No businesses are in approved_for_email state with at least one saved match.";
  }

  const blocks: string[] = [];
  for (const lead of leads) {
    const allAddrs = listEmailsForLeadBusiness(lead);
    const to = hasUsableOutreachEmail(lead.email)
      ? lead.email.trim()
      : outreachRecipientEmailForLead(lead);
    if (!hasUsableOutreachEmail(to)) continue;
    const summary = lead.matches.map(
      (m) =>
        `${m.sourceName} — ${m.reportedOwnerName} — ${m.amount ?? "—"} — ${m.propertyId}`,
    );
    const emailsReview =
      allAddrs.length > 0
        ? `\nAvailable emails (${allAddrs.length}):\n${allAddrs.map((a) => `  ${a}`).join("\n")}`
        : "";
    blocks.push(
      `---\nTo: ${to}${emailsReview}\nSubject: ${leadOutreachEmailSubject(lead.businessName)}\n\n${leadOutreachEmailBody({
        businessName: lead.businessName,
        matchSummaryLines: summary,
      })}\n`,
    );
  }
  if (blocks.length === 0) {
    return "No approved rows have a usable email. Add or enrich an email before generating drafts.";
  }
  return blocks.join("\n");
}

export async function listLeadScanBatches() {
  return prisma.leadScanBatch.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function listLeadOutreachLedger() {
  return prisma.leadBusiness.findMany({
    where: {
      outreachStatus: {
        in: ["approved_for_email", "email_sent", "responded", "do_not_contact"],
      },
    },
    include: {
      batch: { select: { id: true, name: true } },
      matches: { select: { id: true } },
    },
    orderBy: [{ importedAt: "desc" }, { id: "desc" }],
    take: 200,
  });
}

/**
 * Deletes one imported lead batch. Cascades to `lead_businesses` and `lead_business_matches` only.
 * Does not touch `source_records` or saved opportunity reports (JSON store).
 */
export async function deleteLeadScanBatch(batchId: number): Promise<void> {
  if (!Number.isFinite(batchId) || batchId <= 0) {
    throw new Error("Invalid batch id.");
  }
  const existing = await prisma.leadScanBatch.findUnique({
    where: { id: batchId },
    select: { id: true },
  });
  if (!existing) {
    throw new Error("Lead batch not found.");
  }
  await prisma.leadScanBatch.delete({ where: { id: batchId } });
}

export async function getLeadScanBatchDetail(batchId: number) {
  const batch = await prisma.leadScanBatch.findUnique({
    where: { id: batchId },
    include: {
      businesses: {
        orderBy: { id: "asc" },
        include: {
          matches: {
            select: {
              id: true,
              confidence: true,
              matchScore: true,
              amount: true,
            },
          },
        },
      },
    },
  });
  return batch;
}

/** True when email looks suitable for outreach (non-empty, contains @, minimal shape). */
export function hasUsableOutreachEmail(email: string): boolean {
  const e = email.trim();
  if (e.length < 5 || !e.includes("@")) return false;
  const [local, domain] = e.split("@", 2);
  return Boolean(local?.length && domain && domain.length >= 1 && !domain.startsWith("."));
}

/** Parsed email list for UI/drafts; prefers `emailsJson`, falls back to `email`. */
export function listEmailsForLeadBusiness(lead: {
  email: string;
  emailsJson?: string | null;
}): string[] {
  const raw = lead.emailsJson?.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const arr = parsed
          .map((x) => String(x).trim())
          .filter((s) => s.includes("@"));
        const d = dedupeEmailsCaseInsensitiveOrdered(arr);
        if (d.length > 0) return d;
      }
    } catch {
      /* ignore bad JSON */
    }
  }
  const e = lead.email.trim();
  return e.includes("@") ? [e] : [];
}

export function leadBusinessHasAnyUsableEmail(lead: {
  email: string;
  emailsJson?: string | null;
}): boolean {
  return listEmailsForLeadBusiness(lead).some((addr) =>
    hasUsableOutreachEmail(addr),
  );
}

/** First usable address when primary field is blank or not usable. */
export function outreachRecipientEmailForLead(lead: {
  email: string;
  emailsJson?: string | null;
}): string {
  const all = listEmailsForLeadBusiness(lead);
  const hit = all.find((a) => hasUsableOutreachEmail(a));
  return hit ?? lead.email.trim();
}

function firstEmailFromEnrichment(emails: unknown): string | null {
  if (Array.isArray(emails)) {
    for (const x of emails) {
      const s = String(x).trim();
      if (s.includes("@")) return s.split(/[;,]/)[0]!.trim();
    }
    return null;
  }
  if (typeof emails === "string" && emails.trim()) {
    const s = emails.split(/[;,]/)[0]!.trim();
    return s.includes("@") ? s : null;
  }
  return null;
}

async function applyEnrichmentToDb(
  leadId: number,
  lead: LeadBusiness,
  data: LeadEnrichmentSuccess,
): Promise<void> {
  const now = new Date();

  if (!data.found) {
    await prisma.leadBusiness.update({
      where: { id: leadId },
      data: {
        enrichedAt: now,
        enrichmentSource: data.source ?? "local_database",
        enrichmentStatus: "not_found",
        enrichmentMessage: (data.message ?? "No contact found").slice(0, 4000),
      },
    });
    return;
  }

  const src = (data.source ?? "").toLowerCase();
  const enrichmentStatus =
    src === "google_places" ? "found_google" : "found_local";

  const emailFromApi = firstEmailFromEnrichment(data.emails);
  let nextEmail = lead.email.trim();
  if (data.has_email !== false && emailFromApi) {
    nextEmail = emailFromApi;
  } else if (!nextEmail && emailFromApi) {
    nextEmail = emailFromApi;
  }

  const mergedEmails = dedupeEmailsCaseInsensitiveOrdered([
    ...(nextEmail ? [nextEmail] : []),
    ...listEmailsForLeadBusiness(lead),
    ...(emailFromApi ? [emailFromApi] : []),
  ]);
  const nextEmailsJson =
    mergedEmails.length > 0
      ? JSON.stringify(mergedEmails)
      : lead.emailsJson;

  const incomingWebsite =
    typeof data.website === "string" ? data.website.trim() : "";
  const nextWebsite = incomingWebsite || lead.website.trim();

  const incomingPhone = typeof data.phone === "string" ? data.phone.trim() : "";
  const nextPhone = incomingPhone || lead.phone?.trim() || null;

  const incomingAddr = typeof data.address === "string" ? data.address.trim() : "";
  const nextAddress = incomingAddr || lead.address?.trim() || null;

  const maps =
    typeof data.google_maps_url === "string" ? data.google_maps_url.trim() : "";
  const nextMaps = maps || lead.googleMapsUrl?.trim() || null;

  await prisma.leadBusiness.update({
    where: { id: leadId },
    data: {
      email: nextEmail,
      emailsJson: nextEmailsJson ?? null,
      website: nextWebsite,
      phone: nextPhone,
      address: nextAddress,
      googleMapsUrl: nextMaps,
      websiteFound:
        typeof data.has_website === "boolean"
          ? data.has_website
          : lead.websiteFound,
      enrichedAt: now,
      enrichmentSource: data.source ?? null,
      enrichmentStatus,
      enrichmentMessage: "",
    },
  });
}

export async function enrichLeadBusinesses(input: {
  batchId: number;
  leadBusinessIds: number[];
  forceGoogleSearch: boolean;
}): Promise<void> {
  for (const id of input.leadBusinessIds) {
    const lead = await prisma.leadBusiness.findFirst({
      where: { id, batchId: input.batchId },
    });
    if (!lead) continue;

    const cityLine = [lead.city?.trim(), lead.state?.trim()]
      .filter(Boolean)
      .join(" ")
      .trim();

    try {
      const data = await postEnrichBusinessContact({
        business_name: lead.businessName.trim(),
        address: (lead.address ?? "").trim(),
        city: cityLine,
        force_google_search: input.forceGoogleSearch,
      });
      await applyEnrichmentToDb(lead.id, lead, data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await prisma.leadBusiness.update({
        where: { id: lead.id },
        data: {
          enrichedAt: new Date(),
          enrichmentStatus: "error",
          enrichmentMessage: msg.slice(0, 4000),
        },
      });
    }
  }
}
