import {
  plannedRecoveryReportEmailSubject,
  ROR_PLANNED_EMAIL_BODY,
} from "@/lib/scanner/recovery-report-copy";

type Props = {
  leadDiscoveryId: string;
  reportNumber: string;
};

/**
 * Links to the printable HTML report; email with PDF attachment is disabled in v1.
 * Planned email copy is shown for staff alignment (nothing is sent automatically).
 */
export function LeadDiscoveryReportActions({
  leadDiscoveryId,
  reportNumber,
}: Props) {
  const reportHref = `/scanner/leads/${encodeURIComponent(leadDiscoveryId)}/report`;
  const plannedSubject = plannedRecoveryReportEmailSubject(reportNumber);

  return (
    <div className="mt-6 space-y-4 border-t border-[#e0e0dc] pt-6">
      <div className="flex flex-wrap gap-3">
        <a
          href={reportHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex border border-[#6d6d68] bg-[#ececea] px-4 py-2 text-sm font-medium text-neutral-900 no-underline hover:bg-[#e0e0dc]"
        >
          Print / Save PDF Report
        </a>
        <span className="self-center text-xs text-neutral-600">
          Opens a printable report — use the browser Print dialog, then choose
          Save as PDF.
        </span>
      </div>

      <div className="border border-[#b8b8b4] bg-[#fafaf8] p-4 opacity-90">
        <h3 className="text-sm font-semibold text-neutral-900">
          Email opportunity report (planned)
        </h3>
        <p className="mt-2 text-sm text-neutral-800" role="status">
          PDF attachment email will be added after the mail attachment pipeline is
          stabilized. Nothing is sent automatically from this application. Use{" "}
          <strong>Print / Save PDF Report</strong> and your browser&apos;s print
          dialog to create a PDF for now.
        </p>

        <div className="mt-4 space-y-3 rounded border border-neutral-200 bg-white p-3 text-sm text-neutral-800">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
            Planned subject line
          </p>
          <p className="font-mono text-xs leading-relaxed">{plannedSubject}</p>
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
            Planned body (conservative wording)
          </p>
          <p className="leading-relaxed">{ROR_PLANNED_EMAIL_BODY}</p>
        </div>

        <div className="mt-4 grid max-w-lg gap-3">
          <div className="grid gap-1">
            <label htmlFor="leadReportEmail" className="text-sm font-medium">
              Recipient email
            </label>
            <input
              id="leadReportEmail"
              type="email"
              disabled
              readOnly
              placeholder="Unavailable in v1"
              className="border border-[#b8b8b4] bg-neutral-100 px-2 py-1.5 text-sm"
            />
          </div>
          <div className="grid gap-1">
            <label htmlFor="leadReportEmailNote" className="text-sm font-medium">
              Optional message / note
            </label>
            <textarea
              id="leadReportEmailNote"
              rows={3}
              disabled
              readOnly
              placeholder="Unavailable in v1"
              className="border border-[#b8b8b4] bg-neutral-100 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <button
              type="button"
              disabled
              className="border border-[#6d6d68] bg-neutral-200 px-4 py-2 text-sm font-medium text-neutral-500"
            >
              Send email
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
