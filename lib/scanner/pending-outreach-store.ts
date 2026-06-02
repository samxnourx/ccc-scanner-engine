import "server-only";

import { randomBytes } from "crypto";

import { displayLeadOutreachSourceName } from "@/lib/scanner/lead-source-display";
import type { LeadOutreachEmailMatch } from "@/lib/scanner/lead-outreach-email";
import { prisma } from "@/lib/scanner/db/client";

export type PendingOutreachLeadSource = "batch" | "saved_lead" | "prospect";
export type PendingOutreachStatus =
  | "pending"
  | "email_sent"
  | "email_failed"
  | "submitted_no_confirmed"
  | "converted"
  | "conversion_failed";

export type PendingOutreachMatch = LeadOutreachEmailMatch & {
  matchKey: string;
};

export type PendingOutreachLead = {
  id: number;
  token: string;
  status: PendingOutreachStatus;
  leadSource: PendingOutreachLeadSource;
  leadId: string;
  businessName: string;
  recipientEmails: string[];
  importedEmail: string;
  phone: string;
  website: string;
  externalLeadId: string;
  scannerBatchId: string;
  scannerLeadBusinessId: string;
  selectedMatches: PendingOutreachMatch[];
  subject: string;
  messageId: string;
  sentAt: string;
  confirmedMatches: PendingOutreachMatch[];
  rejectedMatches: PendingOutreachMatch[];
  confirmedAt: string;
  cmsClaimId: string;
  cmsIntakeId: string;
  cmsDashboardUrl: string;
  cmsResponseJson: string;
  conversionError: string;
  createdAt: string;
  updatedAt: string;
};

type CreatePendingOutreachLeadInput = {
  leadSource: PendingOutreachLeadSource;
  leadId: string;
  businessName: string;
  recipientEmails: string[];
  importedEmail?: string | null;
  phone?: string | null;
  website?: string | null;
  externalLeadId?: string | null;
  scannerBatchId?: number | string | null;
  scannerLeadBusinessId?: number | string | null;
  selectedMatches: LeadOutreachEmailMatch[];
};

type MarkEmailSentInput = {
  token: string;
  subject: string;
  messageId?: string | null;
  sentAt?: Date;
};

export type PendingOutreachResponse = {
  matchKey: string;
  response: "confirmed" | "rejected";
};

let ensured = false;

async function ensurePendingOutreachTable(): Promise<void> {
  if (ensured) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS pending_outreach_leads (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      lead_source TEXT NOT NULL,
      lead_id TEXT NOT NULL,
      business_name TEXT NOT NULL,
      recipient_emails TEXT NOT NULL,
      imported_email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      website TEXT NOT NULL DEFAULT '',
      external_lead_id TEXT NOT NULL DEFAULT '',
      scanner_batch_id TEXT NOT NULL DEFAULT '',
      scanner_lead_business_id TEXT NOT NULL DEFAULT '',
      selected_matches_json TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT '',
      message_id TEXT NOT NULL DEFAULT '',
      sent_at TEXT NOT NULL DEFAULT '',
      confirmed_matches_json TEXT NOT NULL DEFAULT '[]',
      rejected_matches_json TEXT NOT NULL DEFAULT '[]',
      confirmed_at TEXT NOT NULL DEFAULT '',
      cms_claim_id TEXT NOT NULL DEFAULT '',
      cms_intake_id TEXT NOT NULL DEFAULT '',
      cms_dashboard_url TEXT NOT NULL DEFAULT '',
      cms_response_json TEXT NOT NULL DEFAULT '',
      conversion_error TEXT NOT NULL DEFAULT '',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS pending_outreach_leads_lead_idx
    ON pending_outreach_leads(lead_source, lead_id)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS pending_outreach_leads_status_idx
    ON pending_outreach_leads(status)
  `);
  ensured = true;
}

function scannerBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SCANNER_BASE_URL?.trim() ||
    process.env.CCC_SCANNER_BASE_URL?.trim() ||
    "http://localhost:3020"
  ).replace(/\/$/, "");
}

export function pendingOutreachConfirmationUrl(token: string): string {
  return `${scannerBaseUrl()}/outreach/confirm/${encodeURIComponent(token)}`;
}

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeMatches(
  matches: LeadOutreachEmailMatch[],
): PendingOutreachMatch[] {
  return matches.map((match, index) => ({
    sourceName: displayLeadOutreachSourceName(match.sourceName),
    reportedOwnerName: text(match.reportedOwnerName),
    holderName: text(match.holderName),
    propertyId: text(match.propertyId),
    amount: match.amount === null ? null : text(match.amount),
    reportedAddress: text(match.reportedAddress),
    accountType: text(match.accountType),
    confidence: text(match.confidence),
    matchKey: `${index + 1}-${text(match.propertyId) || randomBytes(5).toString("hex")}`,
  }));
}

function parseJsonArray<T>(raw: string, fallback: T[] = []): T[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeStatus(value: string): PendingOutreachStatus {
  if (
    value === "pending" ||
    value === "email_sent" ||
    value === "email_failed" ||
    value === "submitted_no_confirmed" ||
    value === "converted" ||
    value === "conversion_failed"
  ) {
    return value;
  }
  return "pending";
}

function rowToPending(row: Record<string, unknown>): PendingOutreachLead {
  return {
    id: Number(row.id ?? 0),
    token: text(row.token),
    status: normalizeStatus(text(row.status)),
    leadSource: text(row.lead_source) as PendingOutreachLeadSource,
    leadId: text(row.lead_id),
    businessName: text(row.business_name),
    recipientEmails: text(row.recipient_emails).split("\n").filter(Boolean),
    importedEmail: text(row.imported_email),
    phone: text(row.phone),
    website: text(row.website),
    externalLeadId: text(row.external_lead_id),
    scannerBatchId: text(row.scanner_batch_id),
    scannerLeadBusinessId: text(row.scanner_lead_business_id),
    selectedMatches: parseJsonArray<PendingOutreachMatch>(
      text(row.selected_matches_json),
    ),
    subject: text(row.subject),
    messageId: text(row.message_id),
    sentAt: text(row.sent_at),
    confirmedMatches: parseJsonArray<PendingOutreachMatch>(
      text(row.confirmed_matches_json),
    ),
    rejectedMatches: parseJsonArray<PendingOutreachMatch>(
      text(row.rejected_matches_json),
    ),
    confirmedAt: text(row.confirmed_at),
    cmsClaimId: text(row.cms_claim_id),
    cmsIntakeId: text(row.cms_intake_id),
    cmsDashboardUrl: text(row.cms_dashboard_url),
    cmsResponseJson: text(row.cms_response_json),
    conversionError: text(row.conversion_error),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

export async function createPendingOutreachLead(
  input: CreatePendingOutreachLeadInput,
): Promise<{ token: string; confirmationUrl: string }> {
  await ensurePendingOutreachTable();
  const token = randomBytes(24).toString("hex");
  const matches = normalizeMatches(input.selectedMatches);

  await prisma.$executeRawUnsafe(
    `INSERT INTO pending_outreach_leads (
       token,
       status,
       lead_source,
       lead_id,
       business_name,
       recipient_emails,
       imported_email,
       phone,
       website,
       external_lead_id,
       scanner_batch_id,
       scanner_lead_business_id,
       selected_matches_json,
       updated_at
     ) VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    token,
    input.leadSource,
    input.leadId,
    input.businessName,
    input.recipientEmails.join("\n"),
    input.importedEmail ?? "",
    input.phone ?? "",
    input.website ?? "",
    input.externalLeadId ?? "",
    input.scannerBatchId === null || input.scannerBatchId === undefined
      ? ""
      : String(input.scannerBatchId),
    input.scannerLeadBusinessId === null ||
      input.scannerLeadBusinessId === undefined
      ? ""
      : String(input.scannerLeadBusinessId),
    JSON.stringify(matches),
  );

  return { token, confirmationUrl: pendingOutreachConfirmationUrl(token) };
}

export async function markPendingOutreachEmailSent(
  input: MarkEmailSentInput,
): Promise<void> {
  await ensurePendingOutreachTable();
  await prisma.$executeRawUnsafe(
    `UPDATE pending_outreach_leads
     SET status = 'email_sent',
         subject = ?,
         message_id = ?,
         sent_at = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE token = ?`,
    input.subject,
    input.messageId ?? "",
    (input.sentAt ?? new Date()).toISOString(),
    input.token,
  );
}

export async function markPendingOutreachEmailFailed(
  token: string,
  error: string,
): Promise<void> {
  await ensurePendingOutreachTable();
  await prisma.$executeRawUnsafe(
    `UPDATE pending_outreach_leads
     SET status = 'email_failed',
         conversion_error = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE token = ?`,
    error.slice(0, 1000),
    token,
  );
}

export async function getPendingOutreachLeadByToken(
  token: string,
): Promise<PendingOutreachLead | null> {
  await ensurePendingOutreachTable();
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT * FROM pending_outreach_leads WHERE token = ? LIMIT 1`,
    token.trim(),
  )) as Record<string, unknown>[];
  const row = rows[0];
  return row ? rowToPending(row) : null;
}

export async function savePendingOutreachSubmission(args: {
  token: string;
  responses: PendingOutreachResponse[];
}): Promise<PendingOutreachLead> {
  await ensurePendingOutreachTable();
  const existing = await getPendingOutreachLeadByToken(args.token);
  if (!existing) throw new Error("Invalid or expired confirmation link.");
  if (existing.status === "converted") return existing;

  const responseByKey = new Map(
    args.responses.map((response) => [response.matchKey, response.response]),
  );
  const missing = existing.selectedMatches.find(
    (match) => !responseByKey.has(match.matchKey),
  );
  if (missing) throw new Error("Please respond to every property listed.");

  const confirmedMatches = existing.selectedMatches.filter(
    (match) => responseByKey.get(match.matchKey) === "confirmed",
  );
  const rejectedMatches = existing.selectedMatches.filter(
    (match) => responseByKey.get(match.matchKey) === "rejected",
  );
  const now = new Date().toISOString();
  const status =
    confirmedMatches.length > 0 ? "conversion_failed" : "submitted_no_confirmed";

  await prisma.$executeRawUnsafe(
    `UPDATE pending_outreach_leads
     SET status = ?,
         confirmed_matches_json = ?,
         rejected_matches_json = ?,
         confirmed_at = ?,
         conversion_error = '',
         updated_at = CURRENT_TIMESTAMP
     WHERE token = ?`,
    status,
    JSON.stringify(confirmedMatches),
    JSON.stringify(rejectedMatches),
    now,
    args.token,
  );

  return (await getPendingOutreachLeadByToken(args.token))!;
}

export async function markPendingOutreachConverted(args: {
  token: string;
  cmsClaimId: string;
  cmsIntakeId: string;
  cmsDashboardUrl: string;
  cmsResponse: unknown;
}): Promise<PendingOutreachLead> {
  await ensurePendingOutreachTable();
  await prisma.$executeRawUnsafe(
    `UPDATE pending_outreach_leads
     SET status = 'converted',
         cms_claim_id = ?,
         cms_intake_id = ?,
         cms_dashboard_url = ?,
         cms_response_json = ?,
         conversion_error = '',
         updated_at = CURRENT_TIMESTAMP
     WHERE token = ?`,
    args.cmsClaimId,
    args.cmsIntakeId,
    args.cmsDashboardUrl,
    JSON.stringify(args.cmsResponse),
    args.token,
  );
  return (await getPendingOutreachLeadByToken(args.token))!;
}

export async function markPendingOutreachConversionFailed(
  token: string,
  error: string,
): Promise<void> {
  await ensurePendingOutreachTable();
  await prisma.$executeRawUnsafe(
    `UPDATE pending_outreach_leads
     SET status = 'conversion_failed',
         conversion_error = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE token = ?`,
    error.slice(0, 2000),
    token,
  );
}
