import Link from "next/link";
import { notFound } from "next/navigation";

import {
  MatchEmailDraftPanel,
  type LeadBusinessMatchVm,
} from "@/app/scanner/leads/batches/[batchId]/businesses/[businessId]/MatchEmailDraftPanel";
import { EmailEnrichmentPanel } from "@/app/scanner/leads/EmailEnrichmentPanel";
import { LeadContactEditor } from "@/app/scanner/leads/LeadContactEditor";
import { formatUsdTotal, sumAmountFields } from "@/lib/scanner/amounts";
import { getLeadDiscovery } from "@/lib/scanner/lead-discovery-store";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ leadDiscoveryId: string }>;
};

function formatStamp(iso: string | null): string {
  if (!iso?.trim()) return "-";
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function parseEmailList(raw: string | null): string[] {
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(/[\n,;]+/)
        .map((email) => email.trim())
        .filter(Boolean),
    ),
  ];
}

export default async function LeadDiscoveryDetailPage({ params }: Props) {
  const { leadDiscoveryId } = await params;
  const id = decodeURIComponent(leadDiscoveryId).trim();
  if (!id) notFound();

  const lead = await getLeadDiscovery(id);
  if (!lead) notFound();

  const matches: LeadBusinessMatchVm[] = lead.matches.map((m) => ({
    id: m.id,
    sourceName: m.sourceName,
    reportedOwnerName: m.reportedOwnerName,
    holderName: m.holderName,
    propertyId: m.propertyId,
    amount: m.amount,
    reportedAddress: m.reportedAddress,
    accountType: m.propertyType ?? null,
    confidence: m.confidence,
    matchScore: m.nameMatchScore ?? null,
    notes: m.notes,
  }));
  const totalAmount = sumAmountFields(matches.map((m) => m.amount));
  const isOutreachRecord = ["outreach_sent", "responded", "converted", "declined"].includes(
    lead.status,
  );
  const leadEmails = parseEmailList(lead.outreachEmailTo);

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-3 text-sm text-neutral-700">
          <Link href="/scanner/leads" className="underline-offset-2 hover:underline">
            Back to Lead Dashboard
          </Link>
        </p>
        <h1 className="text-xl font-semibold tracking-tight">
          {lead.targetName}
        </h1>
        <p className="mt-1 text-sm text-neutral-700">
          {matches.length.toLocaleString("en-US")} saved matches | Total listed:{" "}
          {formatUsdTotal(totalAmount)} | Individual saved lead
        </p>
      </div>

      {isOutreachRecord && lead.outreachEmailText ? (
        <div className="space-y-4">
          <div className="border border-[#b8b8b4] bg-white p-4 text-sm">
            <p>
              Status: <strong>{lead.status.replace(/_/g, " ")}</strong>
            </p>
            <p className="mt-1">
              Sent to:{" "}
              <span className="font-mono text-xs">
                {lead.outreachEmailTo || "-"}
              </span>
            </p>
            <p className="mt-1">Sent: {formatStamp(lead.outreachSentAt)}</p>
            {lead.outreachIntakeId ? (
              <p className="mt-1">Intake: {lead.outreachIntakeId}</p>
            ) : null}
            {lead.outreachPortalUrl ? (
              <p className="mt-1 break-all">
                Portal:{" "}
                <a
                  href={lead.outreachPortalUrl}
                  className="underline-offset-2 hover:underline"
                >
                  {lead.outreachPortalUrl}
                </a>
              </p>
            ) : null}
          </div>
          <div className="border border-[#b8b8b4] bg-white p-4">
            <p className="mb-2 text-sm font-semibold">
              Subject: {lead.outreachEmailSubject || "-"}
            </p>
            <textarea
              readOnly
              value={lead.outreachEmailText}
              className="h-96 w-full resize-y border border-[#b8b8b4] bg-[#fbfbfa] p-3 font-mono text-xs leading-5 text-neutral-900"
            />
          </div>
        </div>
      ) : matches.length > 0 ? (
        <>
          <EmailEnrichmentPanel
            targetType="lead_discovery"
            targetId={lead.leadDiscoveryId}
            hasEmail={Boolean(lead.outreachEmailTo)}
            revalidatePaths={[
              "/scanner/leads",
              `/scanner/leads/${encodeURIComponent(lead.leadDiscoveryId)}`,
            ]}
          />
          <LeadContactEditor
            lead={{
              kind: "discovery",
              leadDiscoveryId: lead.leadDiscoveryId,
              name: lead.targetName,
              emails: leadEmails,
            }}
          />
          <MatchEmailDraftPanel
            leadDiscoveryId={lead.leadDiscoveryId}
            businessName={lead.targetName}
            emails={leadEmails}
            matches={matches}
          />
        </>
      ) : (
        <div className="border border-[#b8b8b4] bg-white p-4 text-sm">
          No saved matches for this lead yet.
        </div>
      )}
    </div>
  );
}
