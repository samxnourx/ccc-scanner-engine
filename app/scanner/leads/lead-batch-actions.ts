"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  buildLeadOutreachDraftsText,
  deleteLeadScanBatch,
  deleteLeadBusinessesFromBatch,
  enrichLeadBusinesses,
  importLeadBatchFromJson,
  markLeadOutreachEmailsSent,
  markLeadBusinessesResponded,
  removeLeadBusinessesFromDashboard,
  runLeadBatchScan,
  runLeadBatchScanForBusinesses,
  setLeadBusinessOutreachStatus,
} from "@/lib/scanner/lead-batch-service";
import { deleteLeadDiscoveries } from "@/lib/scanner/lead-discovery-store";
import { removeScannerProspectsFromDashboard } from "@/lib/scanner/prospect-discovery";
import { prisma } from "@/lib/scanner/db/client";
import {
  buildLeadOutreachEmailPayload,
} from "@/lib/scanner/lead-outreach-email";
import { recordLeadEmailSend } from "@/lib/scanner/lead-email-send-log";
import { sendPlainTextMail } from "@/lib/scanner/mail/send-mail";
import {
  createPendingOutreachLead,
  markPendingOutreachEmailSent,
} from "@/lib/scanner/pending-outreach-store";

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

export async function importLeadBatchAction(formData: FormData): Promise<void> {
  const batchName = String(formData.get("batchName") ?? "").trim();
  const json = String(formData.get("json") ?? "");
  const { batchId } = await importLeadBatchFromJson({
    batchName: batchName || `Lead import ${new Date().toISOString()}`,
    jsonText: json,
  });
  revalidatePath("/scanner/leads");
  redirect(`/scanner/leads/batches/${batchId}`);
}

export async function runLeadBatchScanAction(formData: FormData): Promise<void> {
  const batchId = Number(formData.get("batchId"));
  if (!Number.isFinite(batchId) || batchId <= 0) {
    throw new Error("Invalid batch id.");
  }
  await runLeadBatchScan(batchId);
  revalidatePath("/scanner/leads");
  revalidatePath(`/scanner/leads/batches/${batchId}`);
}

export async function runSelectedLeadScansAction(
  batchId: number,
  leadBusinessIds: number[],
): Promise<void> {
  if (!Number.isFinite(batchId) || batchId <= 0) {
    throw new Error("Invalid batch id.");
  }
  await runLeadBatchScanForBusinesses({ batchId, leadBusinessIds });
  revalidatePath("/scanner/leads");
  revalidatePath(`/scanner/leads/batches/${batchId}`);
}

export async function approveLeadsAction(
  batchId: number,
  leadBusinessIds: number[],
): Promise<void> {
  if (!Number.isFinite(batchId) || batchId <= 0) throw new Error("Invalid batch.");
  await setLeadBusinessOutreachStatus({
    batchId,
    leadBusinessIds,
    outreachStatus: "approved_for_email",
  });
  revalidatePath("/scanner/leads");
  revalidatePath(`/scanner/leads/batches/${batchId}`);
}

export async function rejectLeadsAction(
  batchId: number,
  leadBusinessIds: number[],
): Promise<void> {
  if (!Number.isFinite(batchId) || batchId <= 0) throw new Error("Invalid batch.");
  await setLeadBusinessOutreachStatus({
    batchId,
    leadBusinessIds,
    outreachStatus: "rejected",
  });
  revalidatePath("/scanner/leads");
  revalidatePath(`/scanner/leads/batches/${batchId}`);
}

export async function updateLeadOutcomeAction(
  batchId: number,
  businessId: number,
  status: "responded" | "do_not_contact",
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  try {
    if (!Number.isFinite(batchId) || batchId <= 0) {
      return { ok: false, error: "Invalid batch id." };
    }
    if (!Number.isFinite(businessId) || businessId <= 0) {
      return { ok: false, error: "Invalid business id." };
    }
    const lead = await prisma.leadBusiness.findFirst({
      where: { id: businessId, batchId },
      select: { id: true, notes: true },
    });
    if (!lead) return { ok: false, error: "Lead business not found." };

    await prisma.leadBusiness.update({
      where: { id: businessId },
      data: {
        outreachStatus: status,
        notes: `${lead.notes ? `${lead.notes}\n` : ""}[outreach] Marked ${status} ${new Date().toISOString()}.`.slice(
          0,
          8000,
        ),
      },
    });
    revalidatePath("/scanner/leads");
    revalidatePath(`/scanner/leads/batches/${batchId}`);
    revalidatePath(`/scanner/leads/batches/${batchId}/businesses/${businessId}`);
    return {
      ok: true,
      message:
        status === "responded"
          ? "Marked as responded."
          : "Marked as do not contact.",
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function updateLeadBusinessContactAction(input: {
  batchId: number;
  businessId: number;
  businessName: string;
  emails: string;
  phone: string;
  website: string;
  mailingAddress: string;
  notes: string;
}): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  try {
    const batchId = Number(input.batchId);
    const businessId = Number(input.businessId);
    const businessName = input.businessName.trim();
    const emails = parseEmailList(input.emails);
    const invalidEmail = emails.find((email) => !simpleEmailOk(email));

    if (!Number.isFinite(batchId) || batchId <= 0) {
      return { ok: false, error: "Invalid batch id." };
    }
    if (!Number.isFinite(businessId) || businessId <= 0) {
      return { ok: false, error: "Invalid business id." };
    }
    if (!businessName) {
      return { ok: false, error: "Business name is required." };
    }
    if (invalidEmail) {
      return { ok: false, error: `Invalid email: ${invalidEmail}` };
    }

    const lead = await prisma.leadBusiness.findFirst({
      where: { id: businessId, batchId },
      select: { id: true, notes: true },
    });
    if (!lead) return { ok: false, error: "Lead business not found." };

    const primaryEmail = emails[0] ?? "";
    await prisma.leadBusiness.update({
      where: { id: businessId },
      data: {
        businessName,
        email: primaryEmail,
        emailsJson: emails.length > 0 ? JSON.stringify(emails) : null,
        phone: input.phone.trim() || null,
        website: input.website.trim(),
        address: input.mailingAddress.trim() || null,
        notes: input.notes.slice(0, 8000),
      },
    });

    revalidatePath("/scanner/leads");
    revalidatePath(`/scanner/leads/batches/${batchId}`);
    revalidatePath(`/scanner/leads/batches/${batchId}/businesses/${businessId}`);
    return { ok: true, message: "Lead info saved." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function dncLeadsAction(
  batchId: number,
  leadBusinessIds: number[],
): Promise<void> {
  if (!Number.isFinite(batchId) || batchId <= 0) throw new Error("Invalid batch.");
  await setLeadBusinessOutreachStatus({
    batchId,
    leadBusinessIds,
    outreachStatus: "do_not_contact",
  });
  revalidatePath("/scanner/leads");
  revalidatePath(`/scanner/leads/batches/${batchId}`);
}

export async function markLeadEmailsSentAction(
  batchId: number,
  leadBusinessIds: number[],
): Promise<{ updatedCount: number }> {
  if (!Number.isFinite(batchId) || batchId <= 0) throw new Error("Invalid batch.");
  const result = await markLeadOutreachEmailsSent({ batchId, leadBusinessIds });
  revalidatePath("/scanner/leads");
  revalidatePath(`/scanner/leads/batches/${batchId}`);
  return result;
}

export async function markLeadRespondedAction(
  batchId: number,
  leadBusinessIds: number[],
): Promise<{ updatedCount: number }> {
  if (!Number.isFinite(batchId) || batchId <= 0) throw new Error("Invalid batch.");
  const result = await markLeadBusinessesResponded({ batchId, leadBusinessIds });
  revalidatePath("/scanner/leads");
  revalidatePath(`/scanner/leads/batches/${batchId}`);
  return result;
}

export async function enrichLeadBusinessesAction(
  batchId: number,
  leadBusinessIds: number[],
  forceGoogleSearch: boolean,
): Promise<void> {
  if (!Number.isFinite(batchId) || batchId <= 0) throw new Error("Invalid batch.");
  await enrichLeadBusinesses({
    batchId,
    leadBusinessIds,
    forceGoogleSearch,
  });
  revalidatePath("/scanner/leads");
  revalidatePath(`/scanner/leads/batches/${batchId}`);
}

export async function deleteLeadScanBatchAction(batchId: number): Promise<void> {
  if (!Number.isFinite(batchId) || batchId <= 0) {
    throw new Error("Invalid batch id.");
  }
  try {
    await deleteLeadScanBatch(batchId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    redirect(`/scanner/leads?batchError=${encodeURIComponent(msg)}`);
  }
  revalidatePath("/scanner/leads");
  revalidatePath(`/scanner/leads/batches/${batchId}`);
  redirect("/scanner/leads?batchDeleted=1");
}

export async function deleteLeadScanBatchesAction(
  batchIds: number[],
): Promise<{ deletedCount: number }> {
  const ids = [...new Set(batchIds)]
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (ids.length === 0) return { deletedCount: 0 };

  let deletedCount = 0;
  for (const batchId of ids) {
    try {
      await deleteLeadScanBatch(batchId);
      deletedCount += 1;
    } catch {
      // Ignore rows that were already deleted or no longer exist.
    }
  }
  revalidatePath("/scanner/leads");
  for (const batchId of ids) {
    revalidatePath(`/scanner/leads/batches/${batchId}`);
  }
  return { deletedCount };
}

export async function deleteLeadBusinessesAction(
  batchId: number,
  leadBusinessIds: number[],
): Promise<{ deletedCount: number }> {
  if (!Number.isFinite(batchId) || batchId <= 0) {
    throw new Error("Invalid batch id.");
  }
  const result = await deleteLeadBusinessesFromBatch({
    batchId,
    leadBusinessIds,
  });
  revalidatePath("/scanner/leads");
  revalidatePath(`/scanner/leads/batches/${batchId}`);
  return result;
}

export async function removeLeadDashboardRowsAction(input: {
  leadBusinessIds?: number[];
  leadDiscoveryIds?: string[];
  prospectIds?: number[];
}): Promise<{ deletedCount: number }> {
  const leadBusinessIds = [...new Set(input.leadBusinessIds ?? [])]
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);
  const leadDiscoveryIds = [...new Set(input.leadDiscoveryIds ?? [])]
    .map((id) => id.trim())
    .filter(Boolean);
  const prospectIds = [...new Set(input.prospectIds ?? [])]
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);

  const [businessResult, discoveryDeletedCount, prospectResult] = await Promise.all([
    removeLeadBusinessesFromDashboard({ leadBusinessIds }),
    deleteLeadDiscoveries(leadDiscoveryIds),
    removeScannerProspectsFromDashboard(prospectIds),
  ]);
  revalidatePath("/scanner/leads");
  return {
    deletedCount:
      businessResult.updatedCount +
      discoveryDeletedCount +
      prospectResult.updatedCount,
  };
}

export async function fetchLeadOutreachDraftsAction(
  batchId: number,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  try {
    if (!Number.isFinite(batchId) || batchId <= 0) {
      return { ok: false, error: "Invalid batch id." };
    }
    const text = await buildLeadOutreachDraftsText(batchId);
    return { ok: true, text };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export async function sendLeadBusinessTestEmailAction(input: {
  batchId: number;
  businessId: number;
  matchIds: number[];
  recipientEmail: string;
}): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  try {
    const batchId = Number(input.batchId);
    const businessId = Number(input.businessId);
    const recipientEmails = parseEmailList(input.recipientEmail);
    const recipientLabel = recipientEmails.join(", ");
    const matchIds = [...new Set(input.matchIds)]
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0);

    if (!Number.isFinite(batchId) || batchId <= 0) {
      return { ok: false, error: "Invalid batch id." };
    }
    if (!Number.isFinite(businessId) || businessId <= 0) {
      return { ok: false, error: "Invalid business id." };
    }
    if (recipientEmails.length === 0) {
      return { ok: false, error: "Enter at least one recipient email." };
    }
    const invalidEmail = recipientEmails.find((candidate) => !simpleEmailOk(candidate));
    if (invalidEmail) {
      return { ok: false, error: `Enter a valid recipient email: ${invalidEmail}` };
    }
    if (matchIds.length === 0) {
      return { ok: false, error: "Select at least one match before sending." };
    }

    const lead = await prisma.leadBusiness.findFirst({
      where: { id: businessId, batchId },
      select: {
        id: true,
        businessName: true,
        email: true,
        emailsJson: true,
        phone: true,
        website: true,
        externalLeadId: true,
        notes: true,
        matches: {
          where: { id: { in: matchIds } },
          orderBy: [
            { matchScore: "desc" },
            { confidence: "asc" },
            { id: "asc" },
          ],
          select: {
            id: true,
            sourceName: true,
            reportedOwnerName: true,
            holderName: true,
            propertyId: true,
            amount: true,
            reportedAddress: true,
            accountType: true,
            confidence: true,
          },
        },
      },
    });

    if (!lead) return { ok: false, error: "Lead business not found." };
    if (lead.matches.length !== matchIds.length) {
      return { ok: false, error: "One or more selected matches were not found." };
    }

    const outreach = await createPendingOutreachLead({
      leadSource: "batch",
      leadId: String(businessId),
      businessName: lead.businessName,
      recipientEmails,
      importedEmail: lead.email,
      phone: lead.phone,
      website: lead.website,
      externalLeadId: lead.externalLeadId,
      scannerBatchId: batchId,
      scannerLeadBusinessId: businessId,
      selectedMatches: lead.matches,
    });

    const payload = buildLeadOutreachEmailPayload({
      businessName: lead.businessName,
      recipientEmail: recipientLabel,
      matches: lead.matches,
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
    const sentNote =
      `${lead.notes ? `${lead.notes}\n` : ""}[recovery email] Sent ${matchIds.length} selected matches to ${recipientLabel} on ${sentAt.toISOString()}`.slice(
        0,
        7600,
      ) +
      `\n[outreach] Pending scanner confirmation: ${outreach.confirmationUrl}`.slice(
        0,
        400,
      );

    await prisma.leadBusiness.update({
      where: { id: businessId },
      data: {
        outreachStatus: "email_sent",
        outreachEmailTo: recipientEmails.join("\n"),
        outreachEmailSubject: payload.subject,
        outreachEmailText: payload.text,
        outreachPortalUrl: outreach.confirmationUrl,
        outreachIntakeId: null,
        outreachSentAt: sentAt,
        notes: sentNote,
      },
    });

    await recordLeadEmailSend({
      emailKind: "recovery",
      leadSource: "batch",
      leadId: String(businessId),
      businessName: lead.businessName,
      recipientEmails,
      selectedMatches: lead.matches,
      subject: payload.subject,
      portalUrl: outreach.confirmationUrl,
      intakeId: null,
      messageId: mailResult.messageId,
      sentAt,
    });

    await prisma.leadScanBatch.update({
      where: { id: batchId },
      data: {
        sentEmailCount: await prisma.leadBusiness.count({
          where: { batchId, outreachStatus: { in: ["email_sent", "responded"] } },
        }),
      },
    });

    return {
      ok: true,
      message: `Sent recovery email to ${recipientLabel}; scanner confirmation is pending.`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
