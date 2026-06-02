import "server-only";

import type { PendingOutreachLead } from "@/lib/scanner/pending-outreach-store";

type CmsLeadConversionResponse = {
  ok?: unknown;
  intakeId?: unknown;
  claimId?: unknown;
  dashboardUrl?: unknown;
  portalUrl?: unknown;
  error?: unknown;
};

function claimsIntakeBaseUrl(): string {
  return process.env.CLAIMS_INTAKE_BASE_URL?.trim() || "http://localhost:3000";
}

function matchPayload(
  match: PendingOutreachLead["selectedMatches"][number],
  status: "confirmed" | "rejected",
) {
  return {
    source: match.sourceName || "California SCO",
    sourceName: match.sourceName || "California SCO",
    reportedOwner: match.reportedOwnerName,
    reportedOwnerName: match.reportedOwnerName,
    holderName: match.holderName,
    propertyId: match.propertyId,
    reportedAddress: match.reportedAddress,
    amount: match.amount ?? "",
    accountType: match.accountType ?? "",
    confidence: match.confidence,
    clientConfirmationStatus: status,
    pursuitStatus:
      status === "confirmed" ? "confirmed_by_client" : "excluded_from_filing",
  };
}

export async function convertPendingOutreachLeadToCms(
  lead: PendingOutreachLead,
): Promise<{ intakeId: string; claimId: string; dashboardUrl: string; raw: unknown }> {
  const base = claimsIntakeBaseUrl().replace(/\/$/, "");
  const response = await fetch(`${base}/api/scanner/lead-conversions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source: "scanner_lead_conversion",
      conversionId: lead.token,
      businessName: lead.businessName,
      claimantType: "Business",
      email: lead.recipientEmails[0] ?? "",
      phone: lead.phone,
      website: lead.website,
      importedEmail: lead.importedEmail,
      externalLeadId: lead.externalLeadId || lead.leadId,
      scannerBatchId: lead.scannerBatchId,
      scannerLeadBusinessId: lead.scannerLeadBusinessId,
      scannerLeadSource: lead.leadSource,
      originalLeadId: lead.leadId,
      confirmedAt: lead.confirmedAt,
      originalLeadEmailMetadata: {
        subject: lead.subject,
        messageId: lead.messageId,
        sentAt: lead.sentAt,
        recipientEmails: lead.recipientEmails,
        confirmationToken: lead.token,
      },
      matches: lead.confirmedMatches.map((match) =>
        matchPayload(match, "confirmed"),
      ),
      rejectedMatches: lead.rejectedMatches.map((match) =>
        matchPayload(match, "rejected"),
      ),
    }),
  });

  const parsed = (await response
    .json()
    .catch(async () => ({ error: await response.text().catch(() => "") }))) as
    CmsLeadConversionResponse;

  if (!response.ok) {
    const detail =
      typeof parsed.error === "string" && parsed.error.trim()
        ? parsed.error.trim()
        : `HTTP ${response.status}`;
    throw new Error(`CMS lead conversion failed: ${detail}`);
  }

  const intakeId = typeof parsed.intakeId === "string" ? parsed.intakeId.trim() : "";
  const claimId = typeof parsed.claimId === "string" ? parsed.claimId.trim() : "";
  const dashboardUrl =
    typeof parsed.dashboardUrl === "string"
      ? parsed.dashboardUrl.trim()
      : typeof parsed.portalUrl === "string"
        ? parsed.portalUrl.trim()
        : "";

  if (!intakeId || !claimId || !dashboardUrl) {
    throw new Error("CMS conversion response did not include intakeId, claimId, and dashboardUrl.");
  }

  return { intakeId, claimId, dashboardUrl, raw: parsed };
}
