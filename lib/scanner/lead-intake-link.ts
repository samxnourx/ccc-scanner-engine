import "server-only";

import type { LeadOutreachEmailMatch } from "@/lib/scanner/lead-outreach-email";
import { displayLeadOutreachSourceName } from "@/lib/scanner/lead-source-display";

type CreateLeadIntakeLinkInput = {
  businessName: string;
  recipientEmail: string;
  importedEmail: string;
  phone: string | null;
  website: string;
  externalLeadId: string | null;
  batchId?: number | null;
  leadBusinessId?: number | null;
  matches: LeadOutreachEmailMatch[];
};

function claimsIntakeBaseUrl(): string {
  return process.env.CLAIMS_INTAKE_BASE_URL?.trim() || "http://localhost:3000";
}

export async function createLeadIntakeConfirmationLink(
  input: CreateLeadIntakeLinkInput,
): Promise<{ intakeId: string; portalUrl: string }> {
  const base = claimsIntakeBaseUrl().replace(/\/$/, "");
  const url = `${base}/api/scanner/lead-intakes`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      businessName: input.businessName,
      email: input.recipientEmail,
      importedEmail: input.importedEmail,
      phone: input.phone ?? "",
      website: input.website,
      externalLeadId: input.externalLeadId ?? "",
      scannerBatchId: input.batchId ?? null,
      scannerLeadBusinessId: input.leadBusinessId ?? null,
      matches: input.matches.map((match) => ({
        ...match,
        sourceName: displayLeadOutreachSourceName(match.sourceName),
      })),
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Could not create intake confirmation link (${response.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`,
    );
  }

  const parsed = (await response.json()) as {
    intakeId?: unknown;
    portalUrl?: unknown;
  };
  const intakeId = typeof parsed.intakeId === "string" ? parsed.intakeId.trim() : "";
  const portalUrl = typeof parsed.portalUrl === "string" ? parsed.portalUrl.trim() : "";
  if (!intakeId || !portalUrl) {
    throw new Error("Claims intake system did not return a usable portal link.");
  }

  return { intakeId, portalUrl };
}
