import { LeadDiscoveryReportActions } from "@/components/LeadDiscoveryReportActions";
import { RecoveryOpportunityMatchTable } from "@/components/RecoveryOpportunityMatchTable";
import {
  agencyContactSectionForSource,
  uniqueSortedSources,
} from "@/lib/scanner/lead-discovery-agency-info";
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

type Props = {
  lead: LeadDiscoveryRecord;
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

/**
 * Mirrors the recipient-facing printable report (internal screen preview only).
 */
export function LeadDiscoveryReportPreview({ lead }: Props) {
  const target = lead.targetName.trim() || lead.searchQuery.name;
  const sources = uniqueSortedSources(lead.matches.map((m) => m.sourceName));
  const reportDate = formatReportDate();

  return (
    <section
      className="border border-[#b8b8b4] bg-white p-6 text-neutral-900"
      aria-labelledby="lead-report-preview-heading"
    >
      <h2
        id="lead-report-preview-heading"
        className="text-lg font-semibold tracking-tight"
      >
        Recovery Opportunity Report preview
      </h2>

      <div className="mt-6 space-y-6 border-b border-[#e0e0dc] pb-8 text-sm leading-relaxed">
        <div>
          <h3 className="text-base font-semibold text-neutral-900">
            {ROR_ORG_PRIMARY}
          </h3>
          <p className="mt-1 font-semibold">{ROR_TITLE}</p>
          <p className="mt-3 text-neutral-800">{ROR_IDENTITY_LINE}</p>
        </div>
        <dl className="grid gap-2 sm:grid-cols-2">
          <div>
            <dt className="text-neutral-600">Report No.</dt>
            <dd className="font-medium">{lead.reportNumber}</dd>
          </div>
          <div>
            <dt className="text-neutral-600">Report Date</dt>
            <dd>{reportDate}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-neutral-600">Prepared for / Search name</dt>
            <dd className="font-medium">{target}</dd>
          </div>
          <div>
            <dt className="text-neutral-600">Potential matches</dt>
            <dd>{lead.matchCount.toLocaleString("en-US")}</dd>
          </div>
          <div>
            <dt className="text-neutral-600">Estimated total amount</dt>
            <dd>{formatUsd(lead.estimatedTotalAmount)}</dd>
          </div>
        </dl>

        <div className="space-y-2">
          <h3 className="text-base font-semibold text-neutral-900">
            {ROR_ABOUT_TITLE}
          </h3>
          {ROR_ABOUT_PARAS.map((para, i) => (
            <p key={`pv-about-${i}`} className="text-neutral-800">
              {para}
            </p>
          ))}
        </div>

        <div>
          <h3 className="mb-2 text-base font-semibold text-neutral-900">
            {ROR_MATCH_DETAIL_HEADING}
          </h3>
          <RecoveryOpportunityMatchTable matches={lead.matches} />
        </div>
      </div>

      <div className="mt-8 space-y-6 border-t border-dashed border-neutral-300 pt-8 text-sm text-neutral-800">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
          Page 2 (print layout)
        </p>

        <div>
          <h3 className="text-base font-semibold text-neutral-900">
            {ROR_NEXT_STEPS_TITLE}
          </h3>
          <ol className="mt-2 list-decimal space-y-2 pl-5">
            {ROR_NEXT_STEPS.map((step, i) => (
              <li key={`pv-step-${i}`}>{step}</li>
            ))}
          </ol>
        </div>

        <div>
          <h3 className="text-base font-semibold text-neutral-900">
            {ROR_HOW_CCC_ASSISTS_TITLE}
          </h3>
          {ROR_HOW_CCC_ASSISTS_PARAS.map((para, i) => (
            <p key={`pv-asst-${i}`} className="mt-2">
              {para}
            </p>
          ))}
        </div>

        <div>
          <h3 className="text-base font-semibold text-neutral-900">
            {ROR_FILE_DIRECTLY_TITLE}
          </h3>
          <p className="mt-2">{ROR_FILE_DIRECTLY_PARA}</p>
        </div>

        <div>
          <h3 className="text-base font-semibold text-neutral-900">
            {ROR_AGENCY_CONTACT_SECTION_TITLE}
          </h3>
          {sources.length === 0 ? (
            <p className="mt-2 text-neutral-700">
              No source-specific agency contacts are listed for this snapshot.
            </p>
          ) : null}
          <div className="mt-3 space-y-3">
            {sources.map((src) => {
              const block = agencyContactSectionForSource(src);
              return (
                <div
                  key={src}
                  className="border-l-2 border-[#e0e0dc] pl-3 text-neutral-900"
                >
                  <p className="font-semibold">{block.title}</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {block.lines.map((line, li) => (
                      <li key={`${src}-pv-${li}`}>{line}</li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>

        <div className="border-t border-neutral-200 pt-4">
          <h3 className="text-base font-semibold text-neutral-900">
            {ROR_REQUIRED_DISCLOSURES_TITLE}
          </h3>
          <p className="mt-2 text-xs font-semibold uppercase leading-snug tracking-wide">
            {ROR_REQUIRED_DISCLOSURES[0]}
          </p>
          <p className="mt-2">{ROR_REQUIRED_DISCLOSURES[1]}</p>
          <p className="mt-2">{ROR_REQUIRED_DISCLOSURES[2]}</p>
        </div>
      </div>

      <div className="mt-8 border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
        <p className="font-medium">Internal disclosure</p>
        <p className="mt-1">
          This preview is for internal review. Outreach language must be reviewed
          for compliance before sending.
        </p>
      </div>

      <LeadDiscoveryReportActions
        leadDiscoveryId={lead.leadDiscoveryId}
        reportNumber={lead.reportNumber}
      />
    </section>
  );
}
