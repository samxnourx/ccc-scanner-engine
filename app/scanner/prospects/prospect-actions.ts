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
  listProspectPropertiesBySourceRecordIds,
  listProspectProperties,
  markScannerProspectEmailSent,
  parseProspectContactEmails,
  searchRelatedProspectProperties,
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

  const properties = await listProspectProperties(prospect);
  if (properties.length === 0) {
    throw new Error("Prospect does not have matches to save.");
  }

  const matches: NormalizedMatch[] = properties.map((property, index) => ({
    id: `prospect-${prospect.id}-${property.sourceRecordId || property.propertyId || index}`,
    sourceName: property.sourceName,
    reportedOwnerName: property.reportedOwnerName,
    holderName: property.holderName,
    propertyId: property.propertyId,
    amount: property.amount ?? "",
    reportedAddress: property.reportedAddress,
    confidence: property.confidence,
    notes: "Database-discovered prospect",
    propertyType: property.accountType,
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
  mailingAddress: string;
  notes: string;
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
      mailingAddress: input.mailingAddress.trim(),
      notes: input.notes,
    });
    revalidatePath("/scanner/prospects/candidates");
    revalidatePath(`/scanner/prospects/${id}`);
    return { ok: true, message: "Lead info saved." };
  } catch (e) {
    console.error("[prospects] save contact failed", e);
    return { ok: false, error: "Could not save lead info." };
  }
}

export async function searchProspectRelatedPropertiesAction(input: {
  prospectId: number;
  query: string;
  excludeSourceRecordIds: string[];
}): Promise<
  | {
      ok: true;
      matches: Array<{
        id: number;
        sourceName: string;
        reportedOwnerName: string;
        holderName: string;
        propertyId: string;
        amount: string | null;
        reportedAddress: string;
        accountType: string | null;
        confidence: string;
        matchScore: null;
        notes: string;
      }>;
    }
  | { ok: false; error: string }
> {
  const prospectId = Number(input.prospectId);
  const query = input.query.trim();
  const excludeSourceRecordIds = input.excludeSourceRecordIds
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);

  if (!Number.isFinite(prospectId) || prospectId <= 0) {
    return { ok: false, error: "Invalid prospect id." };
  }
  if (query.length < 2) {
    return { ok: false, error: "Enter an alternate owner name to search." };
  }

  try {
    const rows = await searchRelatedProspectProperties({
      prospectId,
      query,
      excludeSourceRecordIds,
      limit: 100,
    });
    return {
      ok: true,
      matches: rows.map((row) => ({
        id: row.sourceRecordId,
        sourceName: row.sourceName,
        reportedOwnerName: row.reportedOwnerName,
        holderName: row.holderName,
        propertyId: row.propertyId,
        amount: row.amount,
        reportedAddress: row.reportedAddress,
        accountType: row.accountType,
        confidence: row.confidence,
        matchScore: null,
        notes: "Related owner-name search",
      })),
    };
  } catch (e) {
    console.error("[prospects] related property search failed", e);
    return { ok: false, error: "Could not search related properties." };
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

    const defaultRows = await listProspectProperties(prospect);
    const defaultSelectedRows = defaultRows.filter((row) =>
      matchIds.has(String(row.sourceRecordId)),
    );
    const foundIds = new Set(defaultSelectedRows.map((row) => String(row.sourceRecordId)));
    const missingIds = [...matchIds]
      .filter((matchId) => !foundIds.has(matchId))
      .map((matchId) => Number(matchId))
      .filter((matchId) => Number.isFinite(matchId) && matchId > 0);
    const relatedSelectedRows = await listProspectPropertiesBySourceRecordIds(missingIds);
    const selectedRowsById = new Map(
      [...defaultSelectedRows, ...relatedSelectedRows].map((row) => [
        String(row.sourceRecordId),
        row,
      ]),
    );
    const selectedRows = [...matchIds]
      .map((matchId) => selectedRowsById.get(matchId))
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
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
      matches: matches.map((match) => ({
        ...match,
        accountType: match.accountType ?? null,
      })),
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
