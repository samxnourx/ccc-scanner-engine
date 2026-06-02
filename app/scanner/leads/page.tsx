import Link from "next/link";

import { BulkEmailEnrichmentButton } from "@/app/scanner/leads/BulkEmailEnrichmentButton";
import {
  LeadDashboardBulkActions,
  LeadDashboardDeleteButton,
  LeadDashboardSelectAllCheckbox,
} from "@/app/scanner/leads/LeadDashboardSelectionActions";
import { LeadBatchDeleteButton } from "@/components/LeadBatchDeleteButton";
import {
  listLeadOutreachLedger,
  listLeadScanBatches,
} from "@/lib/scanner/lead-batch-service";
import { formatUsdTotal } from "@/lib/scanner/amounts";
import { listLeadDiscoveries } from "@/lib/scanner/lead-discovery-store";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  imported: "Ready to scan",
  scanning: "Scanning",
  review_needed: "Needs review",
  completed: "Completed",
};

function formatStamp(iso: string): string {
  if (!iso.trim()) return "-";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-US", {
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

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function formatStatus(status: string): string {
  return STATUS_LABELS[status] ?? status.replace(/_/g, " ");
}

function formatOutreachStatus(status: string): string {
  const labels: Record<string, string> = {
    approved_for_email: "Saved",
    email_sent: "Email sent",
    responded: "Responded",
    do_not_contact: "Do not contact",
  };
  return labels[status] ?? status.replace(/_/g, " ");
}

function percent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((done / total) * 100);
}

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LeadDashboardPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const batchDeleted = sp.batchDeleted === "1";
  const batchDeleteError =
    typeof sp.batchError === "string" ? decodeURIComponent(sp.batchError) : null;

  const batches = await listLeadScanBatches().catch(() => []);
  const outreachRows = await listLeadOutreachLedger().catch(() => []);
  const discoveryRows = await listLeadDiscoveries().catch(() => []);
  const savedRows = outreachRows.filter((row) => row.outreachStatus === "approved_for_email");
  const savedDiscoveryRows = discoveryRows.filter((row) =>
    ["detected", "reviewed", "approved_for_outreach"].includes(row.status),
  );
  const savedMissingEmailCount =
    savedRows.filter((row) => !row.email).length +
    savedDiscoveryRows.filter((row) => !row.outreachEmailTo).length;
  const reachedOutRows = outreachRows.filter((row) => row.outreachStatus === "email_sent");
  const reachedOutDiscoveryRows = discoveryRows.filter((row) => row.status === "outreach_sent");
  const outcomeRows = outreachRows.filter((row) =>
    ["responded", "do_not_contact"].includes(row.outreachStatus),
  );
  const outcomeDiscoveryRows = discoveryRows.filter((row) =>
    ["responded", "converted", "declined", "archived"].includes(row.status),
  );
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-neutral-950">
          Lead Dashboard
        </h1>
      </div>

      {batchDeleted ? (
        <div className="border border-green-300 bg-green-50 p-4 text-sm text-green-950">
          <p className="font-medium">Lead batch deleted</p>
          <p className="mt-1">
            The batch and all related businesses and matches were removed. Saved
            opportunity reports were not changed.
          </p>
        </div>
      ) : null}

      {batchDeleteError ? (
        <div className="border border-red-300 bg-red-50 p-4 text-sm text-red-950">
          <p className="font-medium">Could not delete lead batch</p>
          <p className="mt-1">{batchDeleteError}</p>
        </div>
      ) : null}

      <section className="border border-[#b8b8b4] bg-white p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-neutral-900">
              Email enrichment
            </h2>
            <p className="mt-1 text-neutral-700">
              Saved leads missing emails:{" "}
              <strong>{formatNumber(savedMissingEmailCount)}</strong>. The
              parser checks likely business websites and records the source URLs
              for every email found.
            </p>
          </div>
          <BulkEmailEnrichmentButton limit={25} />
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-neutral-900">Raw leads</h2>
          <LeadDashboardBulkActions
            scope="raw-batches"
            kind="batches"
            emptyMessage="Select at least one raw lead batch to delete."
            confirmSingular="Delete {count} selected raw lead batch? This removes its imported businesses and saved matches."
            confirmPlural="Delete {count} selected raw lead batches? This removes their imported businesses and saved matches."
          />
        </div>
        <div className="overflow-x-auto border border-[#b8b8b4] bg-white">
          <table className="w-full min-w-[960px] border-collapse text-left text-sm">
            <thead className="bg-[#ececea] text-neutral-800">
              <tr>
                <th className="w-10 border-b border-[#b8b8b4] px-2 py-2 font-semibold">
                  <LeadDashboardSelectAllCheckbox
                    scope="raw-batches"
                    label="Select all raw lead batches"
                  />
                </th>
                <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                  Batch
                </th>
                <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                  Imported
                </th>
                <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                  Scan progress
                </th>
                <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                  Match outcome
                </th>
                <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                  Outreach
                </th>
                <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                  Stage
                </th>
                <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {batches.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="border-b border-[#e0e0dc] px-3 py-6 text-center text-neutral-600"
                  >
                    No lead batches yet.
                  </td>
                </tr>
              ) : null}
              {batches.map((b) => (
                <tr key={b.id}>
                  <td className="border-b border-[#e0e0dc] px-2 py-3 align-top">
                    <input
                      type="checkbox"
                      data-dashboard-select="raw-batches"
                      value={b.id}
                      aria-label={`Select ${b.name}`}
                      className="h-4 w-4"
                    />
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-3 align-top">
                    <p className="font-medium text-neutral-950">{b.name}</p>
                    <p className="mt-1 font-mono text-xs text-neutral-500">
                      Batch #{b.id}
                    </p>
                  </td>
                  <td className="whitespace-nowrap border-b border-[#e0e0dc] px-3 py-3 align-top text-xs">
                    {formatStamp(b.createdAt.toISOString())}
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-3 align-top">
                    <p className="font-medium">
                      {formatNumber(b.scannedCount)} /{" "}
                      {formatNumber(b.totalBusinesses)}
                    </p>
                    <div className="mt-2 h-2 w-32 border border-[#b8b8b4] bg-[#f7f7f5]">
                      <div
                        className="h-full bg-[#5a6d85]"
                        style={{
                          width: `${percent(b.scannedCount, b.totalBusinesses)}%`,
                        }}
                      />
                    </div>
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-3 align-top">
                    <p className="font-medium">
                      {formatNumber(b.matchesFoundCount)} with matches
                    </p>
                    <p className="mt-1 text-xs text-neutral-600">
                      {percent(b.matchesFoundCount, b.totalBusinesses)}% of
                      imported
                    </p>
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-3 align-top">
                    <p className="font-medium">
                      {formatNumber(b.approvedEmailCount)} saved
                    </p>
                    <p className="mt-1 text-xs text-neutral-600">
                      {formatNumber(b.sentEmailCount)} sent manually
                    </p>
                  </td>
                  <td className="whitespace-nowrap border-b border-[#e0e0dc] px-3 py-3 align-top">
                    <span className="border border-[#b8b8b4] bg-[#f7f7f5] px-2 py-1 text-xs font-medium text-neutral-800">
                      {formatStatus(b.status)}
                    </span>
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-3 align-top">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/scanner/leads/batches/${b.id}`}
                        className="border border-[#6d6d68] bg-[#ececea] px-3 py-1.5 text-sm font-medium text-neutral-900 no-underline hover:bg-[#e0e0dc]"
                      >
                        Open batch
                      </Link>
                      <LeadBatchDeleteButton batchId={b.id} batchName={b.name} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3 border-t border-[#e0e0dc] pt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-neutral-900">Saved leads</h2>
          <LeadDashboardBulkActions
            scope="saved-leads"
            kind="dashboard"
            emptyMessage="Select at least one saved lead to delete."
            confirmSingular="Delete {count} selected saved lead from the Lead Dashboard?"
            confirmPlural="Delete {count} selected saved leads from the Lead Dashboard?"
          />
        </div>
        <div className="overflow-x-auto border border-[#b8b8b4] bg-white">
          <table className="w-full min-w-[1000px] border-collapse text-left text-sm">
            <thead className="bg-[#ececea] text-neutral-800">
              <tr>
                <th className="w-10 border-b border-[#b8b8b4] px-2 py-2 font-semibold">
                  <LeadDashboardSelectAllCheckbox
                    scope="saved-leads"
                    label="Select all saved leads"
                  />
                </th>
                <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                  Business
                </th>
                <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                  Email
                </th>
                <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                  Matches
                </th>
                <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                  Batch
                </th>
                <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {savedRows.length === 0 && savedDiscoveryRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="border-b border-[#e0e0dc] px-3 py-6 text-center text-neutral-600"
                  >
                    No saved leads yet.
                  </td>
                </tr>
              ) : null}
              {savedRows.map((row) => (
                <tr key={row.id}>
                  <td className="border-b border-[#e0e0dc] px-2 py-2 align-top">
                    <input
                      type="checkbox"
                      data-dashboard-select="saved-leads"
                      value={`business:${row.id}`}
                      aria-label={`Select ${row.businessName}`}
                      className="h-4 w-4"
                    />
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-2 font-medium">
                    {row.businessName}
                  </td>
                  <td className="break-all border-b border-[#e0e0dc] px-3 py-2 font-mono text-xs">
                    {row.email || "-"}
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-2">
                    {formatNumber(row.matches.length)}
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-2">
                    <Link
                      href={`/scanner/leads/batches/${row.batch.id}`}
                      className="underline-offset-2 hover:underline"
                    >
                      Batch #{row.batch.id}
                    </Link>
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/scanner/leads/batches/${row.batch.id}/businesses/${row.id}`}
                      className="border border-[#6d6d68] bg-[#ececea] px-3 py-1.5 text-sm font-medium text-neutral-900 no-underline hover:bg-[#e0e0dc]"
                    >
                      Open
                    </Link>
                    <LeadDashboardDeleteButton
                      kind="dashboard"
                      value={`business:${row.id}`}
                    />
                    </div>
                  </td>
                </tr>
              ))}
              {savedDiscoveryRows.map((row) => (
                <tr key={row.leadDiscoveryId}>
                  <td className="border-b border-[#e0e0dc] px-2 py-2 align-top">
                    <input
                      type="checkbox"
                      data-dashboard-select="saved-leads"
                      value={`discovery:${row.leadDiscoveryId}`}
                      aria-label={`Select ${row.targetName}`}
                      className="h-4 w-4"
                    />
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-2 font-medium">
                    {row.targetName}
                  </td>
                  <td className="break-all border-b border-[#e0e0dc] px-3 py-2 font-mono text-xs">
                    {row.outreachEmailTo || "-"}
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-2">
                    {formatNumber(row.matches.length)}
                    <span className="ml-2 text-xs text-neutral-600">
                      {formatUsdTotal(row.estimatedTotalAmount ?? 0)}
                    </span>
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-2">
                    Individual search
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/scanner/leads/${encodeURIComponent(row.leadDiscoveryId)}`}
                      className="border border-[#6d6d68] bg-[#ececea] px-3 py-1.5 text-sm font-medium text-neutral-900 no-underline hover:bg-[#e0e0dc]"
                    >
                      Open
                    </Link>
                    <LeadDashboardDeleteButton
                      kind="dashboard"
                      value={`discovery:${row.leadDiscoveryId}`}
                    />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3 border-t border-[#e0e0dc] pt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-neutral-900">
            Businesses reached out to
          </h2>
          <LeadDashboardBulkActions
            scope="reached-out-leads"
            kind="dashboard"
            emptyMessage="Select at least one reached-out business to delete."
            confirmSingular="Delete {count} selected reached-out business from the Lead Dashboard?"
            confirmPlural="Delete {count} selected reached-out businesses from the Lead Dashboard?"
          />
        </div>
        <div className="overflow-x-auto border border-[#b8b8b4] bg-white">
          <table className="w-full min-w-[1000px] border-collapse text-left text-sm">
            <thead className="bg-[#ececea] text-neutral-800">
              <tr>
                <th className="w-10 border-b border-[#b8b8b4] px-2 py-2 font-semibold">
                  <LeadDashboardSelectAllCheckbox
                    scope="reached-out-leads"
                    label="Select all reached-out businesses"
                  />
                </th>
                <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                  Business
                </th>
                <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                  Email
                </th>
                <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                  Status
                </th>
                <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                  Matches
                </th>
                <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                  Batch
                </th>
                <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {reachedOutRows.length === 0 && reachedOutDiscoveryRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="border-b border-[#e0e0dc] px-3 py-6 text-center text-neutral-600"
                  >
                    No reached-out businesses waiting for response.
                  </td>
                </tr>
              ) : null}
              {reachedOutRows.map((row) => (
                <tr key={row.id}>
                  <td className="border-b border-[#e0e0dc] px-2 py-2 align-top">
                    <input
                      type="checkbox"
                      data-dashboard-select="reached-out-leads"
                      value={`business:${row.id}`}
                      aria-label={`Select ${row.businessName}`}
                      className="h-4 w-4"
                    />
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-2 font-medium">
                    {row.businessName}
                  </td>
                  <td className="break-all border-b border-[#e0e0dc] px-3 py-2 font-mono text-xs">
                    {row.email || "-"}
                  </td>
                  <td className="whitespace-nowrap border-b border-[#e0e0dc] px-3 py-2">
                    {formatOutreachStatus(row.outreachStatus)}
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-2">
                    {formatNumber(row.matches.length)}
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-2">
                    <Link
                      href={`/scanner/leads/batches/${row.batch.id}`}
                      className="underline-offset-2 hover:underline"
                    >
                      Batch #{row.batch.id}
                    </Link>
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/scanner/leads/batches/${row.batch.id}/businesses/${row.id}`}
                      className="border border-[#6d6d68] bg-[#ececea] px-3 py-1.5 text-sm font-medium text-neutral-900 no-underline hover:bg-[#e0e0dc]"
                    >
                      Open
                    </Link>
                    <LeadDashboardDeleteButton
                      kind="dashboard"
                      value={`business:${row.id}`}
                    />
                    </div>
                  </td>
                </tr>
              ))}
              {reachedOutDiscoveryRows.map((row) => (
                <tr key={row.leadDiscoveryId}>
                  <td className="border-b border-[#e0e0dc] px-2 py-2 align-top">
                    <input
                      type="checkbox"
                      data-dashboard-select="reached-out-leads"
                      value={`discovery:${row.leadDiscoveryId}`}
                      aria-label={`Select ${row.targetName}`}
                      className="h-4 w-4"
                    />
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-2 font-medium">
                    {row.targetName}
                  </td>
                  <td className="break-all border-b border-[#e0e0dc] px-3 py-2 font-mono text-xs">
                    {row.outreachEmailTo || "-"}
                  </td>
                  <td className="whitespace-nowrap border-b border-[#e0e0dc] px-3 py-2">
                    Email sent
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-2">
                    {formatNumber(row.matches.length)}
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-2">
                    Individual search
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/scanner/leads/${encodeURIComponent(row.leadDiscoveryId)}`}
                      className="border border-[#6d6d68] bg-[#ececea] px-3 py-1.5 text-sm font-medium text-neutral-900 no-underline hover:bg-[#e0e0dc]"
                    >
                      Open
                    </Link>
                    <LeadDashboardDeleteButton
                      kind="dashboard"
                      value={`discovery:${row.leadDiscoveryId}`}
                    />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3 border-t border-[#e0e0dc] pt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-neutral-900">
            Responded and do-not-contact businesses
          </h2>
          <LeadDashboardBulkActions
            scope="outcome-leads"
            kind="dashboard"
            emptyMessage="Select at least one outcome row to delete."
            confirmSingular="Delete {count} selected outcome row from the Lead Dashboard?"
            confirmPlural="Delete {count} selected outcome rows from the Lead Dashboard?"
          />
        </div>
        <div className="overflow-x-auto border border-[#b8b8b4] bg-white">
          <table className="w-full min-w-[1000px] border-collapse text-left text-sm">
            <thead className="bg-[#ececea] text-neutral-800">
              <tr>
                <th className="w-10 border-b border-[#b8b8b4] px-2 py-2 font-semibold">
                  <LeadDashboardSelectAllCheckbox
                    scope="outcome-leads"
                    label="Select all outcome rows"
                  />
                </th>
                <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                  Business
                </th>
                <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                  Email
                </th>
                <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                  Outcome
                </th>
                <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                  Matches
                </th>
                <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                  Intake
                </th>
                <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {outcomeRows.length === 0 && outcomeDiscoveryRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="border-b border-[#e0e0dc] px-3 py-6 text-center text-neutral-600"
                  >
                    No outreach outcomes yet.
                  </td>
                </tr>
              ) : null}
              {outcomeRows.map((row) => (
                <tr key={row.id}>
                  <td className="border-b border-[#e0e0dc] px-2 py-2 align-top">
                    <input
                      type="checkbox"
                      data-dashboard-select="outcome-leads"
                      value={`business:${row.id}`}
                      aria-label={`Select ${row.businessName}`}
                      className="h-4 w-4"
                    />
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-2 font-medium">
                    {row.businessName}
                  </td>
                  <td className="break-all border-b border-[#e0e0dc] px-3 py-2 font-mono text-xs">
                    {row.email || "-"}
                  </td>
                  <td className="whitespace-nowrap border-b border-[#e0e0dc] px-3 py-2">
                    {formatOutreachStatus(row.outreachStatus)}
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-2">
                    {formatNumber(row.matches.length)}
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-2">
                    {row.outreachIntakeId || "-"}
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/scanner/leads/batches/${row.batch.id}/businesses/${row.id}`}
                      className="border border-[#6d6d68] bg-[#ececea] px-3 py-1.5 text-sm font-medium text-neutral-900 no-underline hover:bg-[#e0e0dc]"
                    >
                      Open
                    </Link>
                    <LeadDashboardDeleteButton
                      kind="dashboard"
                      value={`business:${row.id}`}
                    />
                    </div>
                  </td>
                </tr>
              ))}
              {outcomeDiscoveryRows.map((row) => (
                <tr key={row.leadDiscoveryId}>
                  <td className="border-b border-[#e0e0dc] px-2 py-2 align-top">
                    <input
                      type="checkbox"
                      data-dashboard-select="outcome-leads"
                      value={`discovery:${row.leadDiscoveryId}`}
                      aria-label={`Select ${row.targetName}`}
                      className="h-4 w-4"
                    />
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-2 font-medium">
                    {row.targetName}
                  </td>
                  <td className="break-all border-b border-[#e0e0dc] px-3 py-2 font-mono text-xs">
                    {row.outreachEmailTo || "-"}
                  </td>
                  <td className="whitespace-nowrap border-b border-[#e0e0dc] px-3 py-2">
                    {row.status.replace(/_/g, " ")}
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-2">
                    {formatNumber(row.matches.length)}
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-2">
                    {row.outreachIntakeId || "-"}
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/scanner/leads/${encodeURIComponent(row.leadDiscoveryId)}`}
                      className="border border-[#6d6d68] bg-[#ececea] px-3 py-1.5 text-sm font-medium text-neutral-900 no-underline hover:bg-[#e0e0dc]"
                    >
                      Open
                    </Link>
                    <LeadDashboardDeleteButton
                      kind="dashboard"
                      value={`discovery:${row.leadDiscoveryId}`}
                    />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

    </div>
  );
}
