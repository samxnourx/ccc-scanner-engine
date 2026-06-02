"use server";

import { redirect } from "next/navigation";

import { convertPendingOutreachLeadToCms } from "@/lib/scanner/cms-lead-conversion";
import {
  getPendingOutreachLeadByToken,
  markPendingOutreachConversionFailed,
  markPendingOutreachConverted,
  savePendingOutreachSubmission,
  type PendingOutreachResponse,
} from "@/lib/scanner/pending-outreach-store";

function isResponse(value: string): value is "confirmed" | "rejected" {
  return value === "confirmed" || value === "rejected";
}

export async function submitScannerOutreachConfirmationAction(
  formData: FormData,
) {
  const token = String(formData.get("token") ?? "").trim();
  if (!token) throw new Error("Missing confirmation token.");

  const lead = await getPendingOutreachLeadByToken(token);
  if (!lead) throw new Error("Invalid or expired confirmation link.");

  const responses: PendingOutreachResponse[] = [];
  for (const match of lead.selectedMatches) {
    const raw = String(formData.get(`response_${match.matchKey}`) ?? "").trim();
    if (!isResponse(raw)) {
      redirect(`/outreach/confirm/${encodeURIComponent(token)}?err=incomplete`);
    }
    responses.push({ matchKey: match.matchKey, response: raw });
  }

  const submitted = await savePendingOutreachSubmission({ token, responses });
  if (submitted.confirmedMatches.length === 0) {
    redirect(`/outreach/confirm/${encodeURIComponent(token)}?result=no_confirmed`);
  }

  try {
    const converted = await convertPendingOutreachLeadToCms(submitted);
    await markPendingOutreachConverted({
      token,
      cmsClaimId: converted.claimId,
      cmsIntakeId: converted.intakeId,
      cmsDashboardUrl: converted.dashboardUrl,
      cmsResponse: converted.raw,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await markPendingOutreachConversionFailed(token, msg);
    redirect(`/outreach/confirm/${encodeURIComponent(token)}?err=conversion`);
  }

  redirect(`/outreach/confirm/${encodeURIComponent(token)}?result=converted`);
}
