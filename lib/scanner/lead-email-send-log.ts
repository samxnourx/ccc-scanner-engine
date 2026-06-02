import "server-only";

import { formatUsdTotal, sumAmountFields } from "@/lib/scanner/amounts";
import { prisma } from "@/lib/scanner/db/client";
import type { LeadOutreachEmailMatch } from "@/lib/scanner/lead-outreach-email";

type LeadEmailKind = "recovery";

type RecordLeadEmailSendInput = {
  emailKind: LeadEmailKind;
  leadSource: "batch" | "saved_lead" | "prospect";
  leadId: string;
  businessName: string;
  recipientEmails: string[];
  selectedMatches: LeadOutreachEmailMatch[];
  subject: string;
  portalUrl?: string | null;
  intakeId?: string | null;
  messageId?: string | null;
  sentAt?: Date;
};

let ensured = false;

async function ensureLeadEmailSendLogTable(): Promise<void> {
  if (ensured) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS lead_email_send_logs (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      sent_at DATETIME NOT NULL,
      email_kind TEXT NOT NULL,
      lead_source TEXT NOT NULL,
      lead_id TEXT NOT NULL,
      business_name TEXT NOT NULL,
      recipient_emails TEXT NOT NULL,
      selected_property_count INTEGER NOT NULL,
      selected_property_total_num REAL NOT NULL,
      selected_property_total TEXT NOT NULL,
      subject TEXT NOT NULL,
      portal_url TEXT,
      intake_id TEXT,
      message_id TEXT
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS lead_email_send_logs_sent_at_idx
    ON lead_email_send_logs(sent_at)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS lead_email_send_logs_lead_idx
    ON lead_email_send_logs(lead_source, lead_id)
  `);
  ensured = true;
}

export async function recordLeadEmailSend(
  input: RecordLeadEmailSendInput,
): Promise<void> {
  await ensureLeadEmailSendLogTable();

  const selectedTotal = sumAmountFields(
    input.selectedMatches.map((match) => match.amount),
  );
  const sentAt = input.sentAt ?? new Date();

  await prisma.$executeRawUnsafe(
    `INSERT INTO lead_email_send_logs (
       sent_at,
       email_kind,
       lead_source,
       lead_id,
       business_name,
       recipient_emails,
       selected_property_count,
       selected_property_total_num,
       selected_property_total,
       subject,
       portal_url,
       intake_id,
       message_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    sentAt.toISOString(),
    input.emailKind,
    input.leadSource,
    input.leadId,
    input.businessName,
    input.recipientEmails.join("\n"),
    input.selectedMatches.length,
    selectedTotal,
    formatUsdTotal(selectedTotal),
    input.subject,
    input.portalUrl ?? null,
    input.intakeId ?? null,
    input.messageId ?? null,
  );
}
