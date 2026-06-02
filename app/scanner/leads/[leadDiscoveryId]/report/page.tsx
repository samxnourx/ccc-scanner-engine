import Link from "next/link";
import { notFound } from "next/navigation";

import { LeadDiscoveryPrintToolbar } from "@/components/LeadDiscoveryPrintToolbar";
import { RecoveryOpportunityMatchTable } from "@/components/RecoveryOpportunityMatchTable";
import {
  agencyContactSectionForSource,
  uniqueSortedSources,
} from "@/lib/scanner/lead-discovery-agency-info";
import { getLeadDiscovery } from "@/lib/scanner/lead-discovery-store";
import type { LeadDiscoveryRecord } from "@/lib/scanner/lead-discovery-types";
import {
  ROR_ABOUT_PARAS,
  ROR_ABOUT_TITLE,
  ROR_AGENCY_CONTACT_SECTION_TITLE,
  ROR_FILE_DIRECTLY_PARA,
  ROR_FILE_DIRECTLY_TITLE,
  ROR_HOW_CCC_ASSISTS_PARAS,
  ROR_HOW_CCC_ASSISTS_TITLE,
  ROR_IDENTITY_LINE,
  ROR_MATCH_DETAIL_HEADING,
  ROR_NEXT_STEPS,
  ROR_NEXT_STEPS_TITLE,
  ROR_ORG_PRIMARY,
  ROR_REQUIRED_DISCLOSURES,
  ROR_REQUIRED_DISCLOSURES_TITLE,
  ROR_TITLE,
} from "@/lib/scanner/recovery-report-copy";

import "./print.css";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ leadDiscoveryId: string }>;
};

function formatUsd(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatReportDate(): string {
  return new Date().toLocaleString("en-US", {
    dateStyle: "long",
    timeStyle: "short",
  });
}

function ReportBody({ lead }: { lead: LeadDiscoveryRecord }) {
  const target = lead.targetName.trim() || lead.searchQuery.name;
  const sources = uniqueSortedSources(lead.matches.map((m) => m.sourceName));
  const reportDate = formatReportDate();

  return (
    <article className="print-report-root print-document text-neutral-900">
      <div className="ror-page-one space-y-6">
        <header className="ror-report-header-block border-b border-neutral-300 pb-6">
          <h1 className="ror-serif-heading text-2xl font-bold tracking-tight text-neutral-950">
            {ROR_ORG_PRIMARY}
          </h1>
          <p className="ror-serif-heading mt-2 text-xl font-semibold text-neutral-900">
            {ROR_TITLE}
          </p>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-neutral-800">
            {ROR_IDENTITY_LINE}
          </p>
          <dl className="mt-6 grid gap-3 border-t border-neutral-200 pt-6 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-neutral-600">Report No.</dt>
              <dd className="font-semibold tracking-wide">{lead.reportNumber}</dd>
            </div>
            <div>
              <dt className="text-neutral-600">Report Date</dt>
              <dd className="font-medium">{reportDate}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-neutral-600">Prepared for / Search name</dt>
              <dd className="font-medium">{target}</dd>
            </div>
            <div>
              <dt className="text-neutral-600">Potential matches</dt>
              <dd className="font-medium">
                {lead.matchCount.toLocaleString("en-US")}
              </dd>
            </div>
            <div>
              <dt className="text-neutral-600">Estimated total amount</dt>
              <dd className="font-medium">
                {formatUsd(lead.estimatedTotalAmount)}
              </dd>
            </div>
          </dl>
        </header>

        <section className="ror-about-section space-y-3 text-sm leading-relaxed text-neutral-800">
          <h2 className="ror-serif-heading text-base font-semibold text-neutral-900">
            {ROR_ABOUT_TITLE}
          </h2>
          {ROR_ABOUT_PARAS.map((para, i) => (
            <p key={`about-${i}`}>{para}</p>
          ))}
        </section>

        <section className="ror-match-wrap">
          <h2 className="ror-serif-heading mb-3 text-base font-semibold text-neutral-900">
            {ROR_MATCH_DETAIL_HEADING}
          </h2>
          <RecoveryOpportunityMatchTable
            matches={lead.matches}
            tableClassName="ror-match-table"
          />
        </section>
      </div>

      <div className="ror-page-two mt-10 space-y-8 pt-2">
        <section className="ror-next-steps space-y-3 text-sm leading-relaxed text-neutral-800">
          <h2 className="ror-serif-heading text-base font-semibold text-neutral-900">
            {ROR_NEXT_STEPS_TITLE}
          </h2>
          <ol className="list-decimal space-y-2 pl-5">
            {ROR_NEXT_STEPS.map((step, i) => (
              <li key={`step-${i}`}>{step}</li>
            ))}
          </ol>
        </section>

        <section className="space-y-3 text-sm leading-relaxed text-neutral-800">
          <h2 className="ror-serif-heading text-base font-semibold text-neutral-900">
            {ROR_HOW_CCC_ASSISTS_TITLE}
          </h2>
          {ROR_HOW_CCC_ASSISTS_PARAS.map((para, i) => (
            <p key={`assist-${i}`}>{para}</p>
          ))}
        </section>

        <section className="space-y-2 text-sm leading-relaxed text-neutral-800">
          <h2 className="ror-serif-heading text-base font-semibold text-neutral-900">
            {ROR_FILE_DIRECTLY_TITLE}
          </h2>
          <p>{ROR_FILE_DIRECTLY_PARA}</p>
        </section>

        <section className="ror-agency-section space-y-4">
          <h2 className="ror-serif-heading text-base font-semibold text-neutral-900">
            {ROR_AGENCY_CONTACT_SECTION_TITLE}
          </h2>
          {sources.length === 0 ? (
            <p className="text-sm text-neutral-700">
              No source-specific agency contacts are listed for this snapshot.
            </p>
          ) : null}
          {sources.map((src) => {
            const block = agencyContactSectionForSource(src);
            return (
              <div
                key={src}
                className="ror-agency-block border-l-2 border-neutral-300 pl-4 text-sm"
              >
                <p className="font-semibold text-neutral-900">{block.title}</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-neutral-800">
                  {block.lines.map((line, li) => (
                    <li key={`${src}-${li}`}>{line}</li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>

        <section className="ror-required-disclosures space-y-3 border-t border-neutral-300 pt-6 text-sm leading-relaxed text-neutral-800">
          <h2 className="ror-serif-heading text-base font-semibold text-neutral-900">
            {ROR_REQUIRED_DISCLOSURES_TITLE}
          </h2>
          <p className="text-xs font-semibold uppercase leading-snug tracking-wide text-neutral-900">
            {ROR_REQUIRED_DISCLOSURES[0]}
          </p>
          <p>{ROR_REQUIRED_DISCLOSURES[1]}</p>
          <p>{ROR_REQUIRED_DISCLOSURES[2]}</p>
        </section>
      </div>
    </article>
  );
}

export default async function LeadDiscoveryPrintReportPage({ params }: Props) {
  const { leadDiscoveryId } = await params;
  const id = decodeURIComponent(leadDiscoveryId).trim();
  if (!id) notFound();

  const lead = await getLeadDiscovery(id);
  if (!lead) notFound();

  return (
    <div className="space-y-4 py-4">
      <p className="text-sm no-print">
        <Link
          href={`/scanner/leads/${encodeURIComponent(id)}`}
          className="text-neutral-900 underline"
        >
          ← Back to report detail
        </Link>
      </p>

      <LeadDiscoveryPrintToolbar />

      <ReportBody lead={lead} />

      <p className="text-xs text-neutral-600 no-print">
        Internal use. Same data as the saved report snapshot — not a live scan.
      </p>
    </div>
  );
}
