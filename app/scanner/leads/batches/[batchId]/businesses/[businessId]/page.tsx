import Link from "next/link";
import { notFound } from "next/navigation";

import {
  MatchEmailDraftPanel,
  type LeadBusinessMatchVm,
} from "@/app/scanner/leads/batches/[batchId]/businesses/[businessId]/MatchEmailDraftPanel";
import { OutreachRecordPanel } from "@/app/scanner/leads/batches/[batchId]/businesses/[businessId]/OutreachRecordPanel";
import { SaveLeadButton } from "@/app/scanner/leads/batches/[batchId]/businesses/[businessId]/SaveLeadButton";
import { EmailEnrichmentPanel } from "@/app/scanner/leads/EmailEnrichmentPanel";
import { LeadContactEditor } from "@/app/scanner/leads/LeadContactEditor";
import { formatUsdTotal, sumAmountFields } from "@/lib/scanner/amounts";
import { prisma } from "@/lib/scanner/db/client";
import { listEmailsForLeadBusiness } from "@/lib/scanner/lead-batch-service";

export const dynamic = "force-dynamic";

export default async function LeadBusinessMatchesPage(props: {
  params: Promise<{ batchId: string; businessId: string }>;
}) {
  const { batchId: rawBatchId, businessId: rawBusinessId } = await props.params;
  const batchId = Number.parseInt(rawBatchId, 10);
  const businessId = Number.parseInt(rawBusinessId, 10);
  if (!Number.isFinite(batchId) || !Number.isFinite(businessId)) notFound();

  const lead = await prisma.leadBusiness.findFirst({
    where: { id: businessId, batchId },
    include: {
      batch: { select: { id: true, name: true } },
      matches: {
        orderBy: [
          { matchScore: "desc" },
          { confidence: "asc" },
          { id: "asc" },
        ],
      },
    },
  });

  if (!lead) notFound();

  const matches: LeadBusinessMatchVm[] = lead.matches.map((m) => ({
    id: m.id,
    sourceName: m.sourceName,
    reportedOwnerName: m.reportedOwnerName,
    holderName: m.holderName,
    propertyId: m.propertyId,
    amount: m.amount,
    reportedAddress: m.reportedAddress,
    accountType: m.accountType,
    confidence: m.confidence,
    matchScore: m.matchScore,
    notes: m.notes,
  }));
  const isOutreachRecord = [
    "email_sent",
    "responded",
    "do_not_contact",
  ].includes(lead.outreachStatus);
  const canSaveLead = [
    "not_scanned",
    "scan_pending",
    "matches_found",
    "no_matches",
    "rejected",
  ].includes(lead.outreachStatus);
  const totalAmount = sumAmountFields(matches.map((m) => m.amount));
  const leadEmails = listEmailsForLeadBusiness(lead);

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-3 text-sm text-neutral-700">
          <Link
            href={isOutreachRecord ? "/scanner/leads" : `/scanner/leads/batches/${batchId}`}
            className="underline-offset-2 hover:underline"
          >
            {isOutreachRecord ? "Back to Lead Dashboard" : `Back to batch #${batchId}`}
          </Link>
        </p>
        <h1 className="text-xl font-semibold tracking-tight">
          {lead.businessName}
        </h1>
        <p className="mt-1 text-sm text-neutral-700">
          {matches.length.toLocaleString("en-US")} saved matches | Total listed:{" "}
          {formatUsdTotal(totalAmount)} | Batch #{lead.batch.id}
        </p>
      </div>

      {isOutreachRecord ? (
        <OutreachRecordPanel
          batchId={batchId}
          businessId={businessId}
          outreachStatus={lead.outreachStatus}
          emailTo={lead.outreachEmailTo}
          subject={lead.outreachEmailSubject}
          emailText={lead.outreachEmailText}
          portalUrl={lead.outreachPortalUrl}
          intakeId={lead.outreachIntakeId}
          sentAt={lead.outreachSentAt?.toISOString() ?? null}
        />
      ) : matches.length > 0 ? (
        <>
          {canSaveLead ? (
            <SaveLeadButton batchId={batchId} businessId={businessId} />
          ) : null}
          <EmailEnrichmentPanel
            targetType="lead_business"
            targetId={String(lead.id)}
            hasEmail={leadEmails.length > 0}
            revalidatePaths={[
              "/scanner/leads",
              `/scanner/leads/batches/${batchId}/businesses/${businessId}`,
            ]}
          />
          <LeadContactEditor
            lead={{
              kind: "batch",
              batchId,
              businessId,
              name: lead.businessName,
              emails: leadEmails,
              phone: lead.phone ?? "",
              website: lead.website,
              mailingAddress: lead.address ?? "",
            }}
          />
          <MatchEmailDraftPanel
            batchId={batchId}
            businessId={businessId}
            businessName={lead.businessName}
            emails={leadEmails}
            matches={matches}
            letterUrl={`/scanner/leads/batches/${batchId}/businesses/${businessId}/letter`}
          />
        </>
      ) : (
        <div className="border border-[#b8b8b4] bg-white p-4 text-sm">
          No saved matches for this business yet.
        </div>
      )}
    </div>
  );
}
