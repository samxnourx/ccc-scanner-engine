import Link from "next/link";
import { notFound } from "next/navigation";

import {
  MatchEmailDraftPanel,
  type LeadBusinessMatchVm,
} from "@/app/scanner/leads/batches/[batchId]/businesses/[businessId]/MatchEmailDraftPanel";
import { EmailEnrichmentPanel } from "@/app/scanner/leads/EmailEnrichmentPanel";
import { LeadContactEditor } from "@/app/scanner/leads/LeadContactEditor";
import { ProspectActionButtons } from "@/app/scanner/prospects/ProspectActionButtons";
import { LeadDiscoverySnapshotTable } from "@/components/LeadDiscoverySnapshotTable";
import { formatUsdTotal, sumAmountFields } from "@/lib/scanner/amounts";
import {
  getOrCreateScannerProspectFromCandidate,
  listProspectProperties,
  parseProspectContactEmails,
  parseProspectSampleMatches,
} from "@/lib/scanner/prospect-discovery";
import type { NormalizedMatch } from "@/lib/scanner/types";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ ownerKey: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(
  value: string | string[] | undefined,
  fallback: string,
): string {
  if (Array.isArray(value)) return value[0] ?? fallback;
  return value ?? fallback;
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

export default async function CandidateBusinessPage({
  params,
  searchParams,
}: Props) {
  const { ownerKey } = await params;
  const sp = await searchParams;
  const ownerNameNormalized = decodeURIComponent(ownerKey).trim();
  const source = firstParam(sp.source, "ca_sco");
  if (!ownerNameNormalized) notFound();

  const prospect = await getOrCreateScannerProspectFromCandidate({
    source,
    ownerNameNormalized,
  });
  if (!prospect) notFound();

  const properties = await listProspectProperties(prospect);
  if (properties.length === 0) notFound();

  const listedTotal = sumAmountFields(properties.map((row) => row.amount));
  const contactEmails = parseProspectContactEmails(prospect.contactEmailsJson);
  const sentMatches = parseProspectSampleMatches(prospect.outreachMatchesJson ?? "");
  const sentSnapshotRows = sentMatches.length > 0 ? sentMatches : properties;
  const matches: LeadBusinessMatchVm[] = properties.map((row) => ({
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
    notes: "Database-discovered candidate",
  }));
  const snapshotMatches: NormalizedMatch[] = sentSnapshotRows.map((row, index) => ({
    id: `prospect-${prospect.id}-sent-${row.propertyId || index}`,
    sourceName: row.sourceName,
    reportedOwnerName: row.reportedOwnerName,
    holderName: row.holderName,
    propertyId: row.propertyId,
    amount: row.amount ?? "",
    reportedAddress: row.reportedAddress,
    propertyType: row.accountType,
    confidence: row.confidence,
    notes: "Database-discovered candidate",
  }));
  const hasSentEmail =
    prospect.status === "email_sent" && Boolean(prospect.outreachEmailText);

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-3 text-sm text-neutral-700">
          <Link
            href="/scanner/prospects/candidates"
            className="underline-offset-2 hover:underline"
          >
            Back to Candidate Database
          </Link>
        </p>
        <h1 className="text-xl font-semibold tracking-tight">
          {prospect.displayName}
        </h1>
        <p className="mt-1 text-sm text-neutral-700">
          {formatNumber(properties.length)} candidate properties | Total listed:{" "}
          {formatUsdTotal(listedTotal)} | Candidate Database
        </p>
      </div>

      {hasSentEmail ? (
        <>
          <section className="border border-[#b8b8b4] bg-white p-4">
            <div className="mb-3">
              <a
                href={`/scanner/prospects/${prospect.id}/letter`}
                target="_blank"
                rel="noreferrer"
                className="inline-block border border-[#6d6d68] bg-white px-4 py-2 text-sm font-medium hover:bg-[#ececea]"
              >
                Print recovery letter
              </a>
            </div>
            <div className="mb-3 text-sm text-neutral-700">
              Sent to{" "}
              <span className="font-mono text-xs">
                {prospect.outreachEmailTo || "recipient not recorded"}
              </span>
              {prospect.outreachSentAt ? ` on ${prospect.outreachSentAt}` : ""}
            </div>
            <textarea
              value={[
                `To: ${prospect.outreachEmailTo || ""}`,
                `Subject: ${prospect.outreachEmailSubject || ""}`,
                "",
                prospect.outreachEmailText || "",
              ].join("\n")}
              readOnly
              className="h-96 w-full resize-y border border-[#b8b8b4] bg-[#fbfbfa] p-3 font-mono text-xs leading-5 text-neutral-900"
            />
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-neutral-900">
              Properties sent
            </h2>
            <LeadDiscoverySnapshotTable matches={snapshotMatches} />
          </section>
        </>
      ) : (
        <>
          <section className="border border-[#b8b8b4] bg-white p-4">
            <div className="flex flex-wrap items-center gap-3">
              <ProspectActionButtons prospectId={prospect.id} />
              <span className="text-sm text-neutral-700">
                Save this candidate to the Lead Dashboard, or add contact info
                and send recovery outreach from this page.
              </span>
            </div>
          </section>

          <LeadContactEditor
            lead={{
              kind: "prospect",
              prospectId: prospect.id,
              name: prospect.displayName,
              emails: contactEmails,
              phone: prospect.contactPhone ?? "",
              website: prospect.contactWebsite ?? "",
              mailingAddress: prospect.contactMailingAddress ?? "",
            }}
          />

          <EmailEnrichmentPanel
            targetType="prospect"
            targetId={String(prospect.id)}
            hasEmail={contactEmails.length > 0}
            revalidatePaths={[
              "/scanner/prospects/candidates",
              `/scanner/prospects/${prospect.id}`,
              `/scanner/prospects/candidates/${encodeURIComponent(
                ownerNameNormalized,
              )}?source=${encodeURIComponent(source)}`,
            ]}
          />

          <MatchEmailDraftPanel
            prospectId={prospect.id}
            businessName={prospect.displayName}
            emails={contactEmails}
            matches={matches}
            letterUrl={`/scanner/prospects/${prospect.id}/letter`}
          />
        </>
      )}

      {properties.length >= 5000 ? (
        <p className="text-xs text-neutral-600">
          Showing first 5,000 candidate properties for this normalized owner.
        </p>
      ) : null}
    </div>
  );
}
