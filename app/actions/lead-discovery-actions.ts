"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  buildLeadOutreachEmailPayload,
} from "@/lib/scanner/lead-outreach-email";
import { recordLeadEmailSend } from "@/lib/scanner/lead-email-send-log";
import {
  createPendingOutreachLead,
  markPendingOutreachEmailSent,
} from "@/lib/scanner/pending-outreach-store";
import {
  createLeadDiscovery,
  getLeadDiscovery,
  updateLeadDiscovery as persistLeadDiscovery,
} from "@/lib/scanner/lead-discovery-store";
import {
  isLeadDiscoveryStatus,
  isLeadTargetType,
  type LeadDiscoveryStatus,
  type LeadTargetType,
} from "@/lib/scanner/lead-discovery-types";
import type { NormalizedMatch, ScannerQuery } from "@/lib/scanner/types";
import { sendPlainTextMail } from "@/lib/scanner/mail/send-mail";

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

export type CreateLeadDiscoveryResult = { ok: false; error: string };

export async function createLeadDiscoveryAction(input: {
  scannerQuery: ScannerQuery;
  matches: NormalizedMatch[];
}): Promise<CreateLeadDiscoveryResult | void> {
  const { scannerQuery, matches } = input;
  if (!Array.isArray(matches) || matches.length === 0) {
    return { ok: false, error: "Could not save lead discovery." };
  }

  let id: string;
  try {
    id = await createLeadDiscovery({ scannerQuery, matches });
  } catch (e) {
    console.error("[lead-discovery] create failed", e);
    return { ok: false, error: "Could not save lead discovery." };
  }

  redirect(`/scanner/leads/${encodeURIComponent(id)}`);
}

export type UpdateLeadDiscoveryResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updateLeadDiscoveryAction(input: {
  id: string;
  status: string;
  notes: string;
  targetName: string;
  targetType: string;
}): Promise<UpdateLeadDiscoveryResult> {
  const status = input.status.trim();
  if (!isLeadDiscoveryStatus(status)) {
    return { ok: false, error: "Invalid status." };
  }

  const rawType = input.targetType.trim();
  const targetType: LeadTargetType | null =
    rawType === "" ? null : isLeadTargetType(rawType) ? rawType : null;
  if (rawType !== "" && targetType === null) {
    return { ok: false, error: "Invalid target type." };
  }

  try {
    await persistLeadDiscovery(input.id, {
      status: status as LeadDiscoveryStatus,
      notes: input.notes,
      targetName: input.targetName,
      targetType,
    });
  } catch (e) {
    console.error("[lead-discovery] update failed", e);
    return { ok: false, error: "Could not update lead discovery." };
  }

  return { ok: true };
}

export async function saveLeadDiscoveryEmailAction(input: {
  id: string;
  email: string;
}): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const id = input.id.trim();
  const emails = parseEmailList(input.email);
  const email = emails.join("\n");
  if (!id) return { ok: false, error: "Lead ID is required." };
  const invalidEmail = emails.find((candidate) => !simpleEmailOk(candidate));
  if (invalidEmail) {
    return { ok: false, error: `Enter a valid email address: ${invalidEmail}` };
  }

  try {
    await persistLeadDiscovery(id, { outreachEmailTo: email || null });
    revalidatePath("/scanner/leads");
    revalidatePath(`/scanner/leads/${encodeURIComponent(id)}`);
    return { ok: true, message: email ? "Email saved." : "Email cleared." };
  } catch (e) {
    console.error("[lead-discovery] save email failed", e);
    return { ok: false, error: "Could not save email." };
  }
}

export async function updateLeadDiscoveryContactAction(input: {
  id: string;
  targetName: string;
  email: string;
}): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const id = input.id.trim();
  const targetName = input.targetName.trim();
  const emails = parseEmailList(input.email);
  const email = emails.join("\n");
  if (!id) return { ok: false, error: "Lead ID is required." };
  if (!targetName) return { ok: false, error: "Lead name is required." };
  const invalidEmail = emails.find((candidate) => !simpleEmailOk(candidate));
  if (invalidEmail) {
    return { ok: false, error: `Enter a valid email address: ${invalidEmail}` };
  }

  try {
    await persistLeadDiscovery(id, {
      targetName,
      outreachEmailTo: email || null,
    });
    revalidatePath("/scanner/leads");
    revalidatePath(`/scanner/leads/${encodeURIComponent(id)}`);
    return { ok: true, message: "Lead info saved." };
  } catch (e) {
    console.error("[lead-discovery] save contact failed", e);
    return { ok: false, error: "Could not save lead info." };
  }
}

export async function sendLeadDiscoveryTestEmailAction(input: {
  leadDiscoveryId: string;
  matchIds: string[];
  recipientEmail: string;
}): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const leadDiscoveryId = input.leadDiscoveryId.trim();
  const recipientEmails = parseEmailList(input.recipientEmail);
  const recipientLabel = recipientEmails.join(", ");
  const matchIds = new Set(input.matchIds.map((id) => String(id).trim()).filter(Boolean));

  if (!leadDiscoveryId) return { ok: false, error: "Lead ID is required." };
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
    const lead = await getLeadDiscovery(leadDiscoveryId);
    if (!lead) return { ok: false, error: "Saved lead not found." };

    const selectedMatches = lead.matches.filter((match) => matchIds.has(match.id));
    if (selectedMatches.length !== matchIds.size) {
      return { ok: false, error: "One or more selected matches were not found." };
    }

    const outreach = await createPendingOutreachLead({
      leadSource: "saved_lead",
      leadId: leadDiscoveryId,
      businessName: lead.targetName,
      recipientEmails,
      importedEmail: lead.outreachEmailTo ?? "",
      phone: null,
      website: "",
      externalLeadId: lead.leadDiscoveryId,
      scannerBatchId: null,
      scannerLeadBusinessId: null,
      selectedMatches,
    });

    const payload = buildLeadOutreachEmailPayload({
      businessName: lead.targetName,
      recipientEmail: recipientLabel,
      matches: selectedMatches,
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
    const sentAtIso = sentAt.toISOString();
    await persistLeadDiscovery(leadDiscoveryId, {
      status: "outreach_sent",
      outreachEmailTo: recipientEmails.join("\n"),
      outreachEmailSubject: payload.subject,
      outreachEmailText: payload.text,
      outreachPortalUrl: outreach.confirmationUrl,
      outreachIntakeId: null,
      outreachSentAt: sentAtIso,
      notes: `${lead.notes ? `${lead.notes}\n` : ""}[recovery email] Sent ${selectedMatches.length} selected matches to ${recipientLabel} on ${sentAtIso}\n[outreach] Pending scanner confirmation: ${outreach.confirmationUrl}`.slice(
        0,
        8000,
      ),
    });

    await recordLeadEmailSend({
      emailKind: "recovery",
      leadSource: "saved_lead",
      leadId: leadDiscoveryId,
      businessName: lead.targetName,
      recipientEmails,
      selectedMatches,
      subject: payload.subject,
      portalUrl: outreach.confirmationUrl,
      intakeId: null,
      messageId: mailResult.messageId,
      sentAt,
    });

    revalidatePath("/scanner/leads");
    revalidatePath(`/scanner/leads/${encodeURIComponent(leadDiscoveryId)}`);
    return {
      ok: true,
      message: `Sent recovery email to ${recipientLabel}; scanner confirmation is pending.`,
    };
  } catch (e) {
    console.error("[lead-discovery] send email failed", e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
