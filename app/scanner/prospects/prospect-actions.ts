"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  buildLeadOutreachEmailPayload,
  type LeadOutreachEmailMatch,
} from "@/lib/scanner/lead-outreach-email";
import { recordLeadEmailSend } from "@/lib/scanner/lead-email-send-log";
import { sendPlainTextMail } from "@/lib/scanner/mail/send-mail";
import { createLeadDiscovery } from "@/lib/scanner/lead-discovery-store";
import {
  createPendingOutreachLead,
  markPendingOutreachEmailSent,
} from "@/lib/scanner/pending-outreach-store";
import type { NormalizedMatch, ScannerQuery } from "@/lib/scanner/types";
import {
  getScannerProspect,
  listProspectProperties,
  markScannerProspectEmailSent,
  parseProspectContactEmails,
  parseProspectSampleMatches,
  updateScannerProspectContact,
  updateScannerProspectStatus,
} from "@/lib/scanner/prospect-discovery";

function simpleEmailOk(email: string): boolean {
  const e = email.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function parseEmailList(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[\n,;]+/)
        .map((email) => email.trim())
        .filter(Boolean),
    ),
  ];
}

export async function saveProspectAsLeadAction(prospectId: number): Promise<void> {
  const id = Number(prospectId);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error("Invalid prospect id.");
  }

  const prospect = await getScannerProspect(id);
  if (!prospect) throw new Error("Prospect not found.");

  const samples = parseProspectSampleMatches(prospect.sampleMatchesJson);
  if (samples.length === 0) {
    throw new Error("Prospect does not have sample matches to save.");
  }

  const matches: NormalizedMatch[] = samples.map((match, index) => ({
    id: `prospect-${prospect.id}-${match.propertyId || index}`,
    sourceName: match.sourceName,
    reportedOwnerName: match.reportedOwnerName,
    holderName: match.holderName,
    propertyId: match.propertyId,
    amount: match.amount ?? "",
    reportedAddress: match.reportedAddress,
    confidence: match.confidence,
    notes: "Database-discovered prospect",
    propertyType: match.accountType,
  }));

  const scannerQuery: ScannerQuery = {
    name: prospect.displayName,
  };

  const leadDiscoveryId = await createLeadDiscovery({
    scannerQuery,
    matches,
  });
  await updateScannerProspectStatus(id, "saved");

  revalidatePath("/scanner/prospects/candidates");
  revalidatePath("/scanner/leads");
  redirect(`/scanner/leads/${encodeURIComponent(leadDiscoveryId)}`);
}

export async function dismissProspectAction(prospectId: number): Promise<void> {
  const id = Number(prospectId);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error("Invalid prospect id.");
  }
  await updateScannerProspectStatus(id, "dismissed");
  revalidatePath("/scanner/prospects/candidates");
}

export async function updateProspectContactAction(input: {
  prospectId: number;
  businessName: string;
  emails: string;
  phone: string;
  website: string;
}): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const id = Number(input.prospectId);
  const businessName = input.businessName.trim();
  const emails = parseEmailList(input.emails);
  const invalidEmail = emails.find((email) => !simpleEmailOk(email));

  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, error: "Invalid prospect id." };
  }
  if (!businessName) return { ok: false, error: "Lead name is required." };
  if (invalidEmail) {
    return { ok: false, error: `Enter a valid email address: ${invalidEmail}` };
  }

  try {
    await updateScannerProspectContact({
      id,
      displayName: businessName,
      emails,
      phone: input.phone.trim(),
      website: input.website.trim(),
    });
    revalidatePath("/scanner/prospects/candidates");
    revalidatePath(`/scanner/prospects/${id}`);
    return { ok: true, message: "Lead info saved." };
  } catch (e) {
    console.error("[prospects] save contact failed", e);
    return { ok: false, error: "Could not save lead info." };
  }
}

export async function sendProspectEmailAction(input: {
  prospectId: number;
  matchIds: string[];
  recipientEmail: string;
}): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const id = Number(input.prospectId);
  const recipientEmails = parseEmailList(input.recipientEmail);
  const recipientLabel = recipientEmails.join(", ");
  const matchIds = new Set(input.matchIds.map((matchId) => String(matchId).trim()).filter(Boolean));

  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, error: "Invalid prospect id." };
  }
  if (recipientEmails.length === 0) {
    return { ok: false, error: "Enter at least one recipient email." };
  }
  const invalidEmail = recipientEmails.find((candidate) => !simpleEmailOk(candidate));
  if (invalidEmail) {
    return { ok: false, error: `Enter a valid recipient email: ${invalidEmail}` };
  }
  if (matchIds.size === 0) {
    return { ok: false, error: "Select at least one match before sending." };
  }

  try {
    const prospect = await getScannerProspect(id);
    if (!prospect) return { ok: false, error: "Prospect not found." };

    const rows = await listProspectProperties(prospect);
    const selectedRows = rows.filter((row) => matchIds.has(String(row.sourceRecordId)));
    if (selectedRows.length !== matchIds.size) {
      return { ok: false, error: "One or more selected matches were not found." };
    }

    const matches: LeadOutreachEmailMatch[] = selectedRows.map((row) => ({
      sourceName: row.sourceName,
      reportedOwnerName: row.reportedOwnerName,
      holderName: row.holderName,
      propertyId: row.propertyId,
      amount: row.amount,
      reportedAddress: row.reportedAddress,
      accountType: row.accountType,
      confidence: row.confidence,
    }));

    const importedEmails = parseProspectContactEmails(prospect.contactEmailsJson);
    const outreach = await createPendingOutreachLead({
      leadSource: "prospect",
      leadId: String(id),
      businessName: prospect.displayName,
      recipientEmails,
      importedEmail: importedEmails[0] ?? "",
      phone: prospect.contactPhone ?? null,
      website: prospect.contactWebsite ?? "",
      externalLeadId: `prospect:${prospect.id}`,
      scannerBatchId: null,
      scannerLeadBusinessId: null,
      selectedMatches: matches,
    });

    const payload = buildLeadOutreachEmailPayload({
      businessName: prospect.displayName,
      recipientEmail: recipientLabel,
      matches,
      confirmUrl: outreach.confirmationUrl,
    });

    const mailResult = await sendPlainTextMail({
      to: recipientEmails,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
      profile: "outreach",
    });

    const sentAt = new Date();
    await markPendingOutreachEmailSent({
      token: outreach.token,
      subject: payload.subject,
      messageId: mailResult.messageId,
      sentAt,
    });
    await markScannerProspectEmailSent({
      id,
      recipientEmail: recipientEmails.join("\n"),
      subject: payload.subject,
      text: payload.text,
      portalUrl: outreach.confirmationUrl,
      intakeId: null,
      sentAt: sentAt.toISOString(),
    });

    await recordLeadEmailSend({
      emailKind: "recovery",
      leadSource: "prospect",
      leadId: String(id),
      businessName: prospect.displayName,
      recipientEmails,
      selectedMatches: matches,
      subject: payload.subject,
      portalUrl: outreach.confirmationUrl,
      intakeId: null,
      messageId: mailResult.messageId,
      sentAt,
    });

    revalidatePath("/scanner/prospects/candidates");
    revalidatePath(`/scanner/prospects/${id}`);
    return {
      ok: true,
      message: `Sent recovery email to ${recipientLabel}; scanner confirmation is pending.`,
    };
  } catch (e) {
    console.error("[prospects] send email failed", e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
