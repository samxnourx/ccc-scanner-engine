"use client";

import {
  submitNoMatchesToIntake,
  submitScanResultsToIntake,
} from "@/app/actions/scan-actions";
import { LeadDiscoverySaveBar } from "@/components/LeadDiscoverySaveBar";
import { formatUsdTotal, sumAmountFields } from "@/lib/scanner/amounts";
import type { NormalizedMatch, ScannerQuery } from "@/lib/scanner/types";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";

type Props = {
  matches: NormalizedMatch[];
  /** When set and there are matches, shows internal lead discovery save (uses row checkboxes). */
  scannerQuery?: ScannerQuery;
  intakeId?: string;
  workflowStatus?:
    | "scan_pending"
    | "review_pending"
    | "no_matches"
    | "matches_sent";
  intakeScanNotify?:
    | { notified: true; matchCount: number }
    | { notified: false };
};

export function ScanResultsTable({
  matches,
  scannerQuery,
  intakeId,
  workflowStatus,
  intakeScanNotify,
}: Props) {
  const [localWorkflowStatus, setLocalWorkflowStatus] = useState(workflowStatus);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const selectedRows = useMemo(
    () => matches.filter((m) => selected[m.id]),
    [matches, selected],
  );
  const listedTotal = useMemo(
    () => sumAmountFields(matches.map((m) => m.amount)),
    [matches],
  );
  const selectedTotal = useMemo(
    () => sumAmountFields(selectedRows.map((m) => m.amount)),
    [selectedRows],
  );

  function toggle(id: string) {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function toggleAll(checked: boolean) {
    const next: Record<string, boolean> = {};
    if (checked) {
      for (const m of matches) next[m.id] = true;
    }
    setSelected(next);
  }

  const allSelected =
    matches.length > 0 && matches.every((m) => selected[m.id]);

  function onSendToIntake() {
    if (!intakeId?.trim()) return;
    setMessage(null);
    startTransition(async () => {
      const result = await submitScanResultsToIntake(
        intakeId.trim(),
        selectedRows,
      );
      if (result.ok) {
        setMessage(`Sent (${result.status}).`);
        setLocalWorkflowStatus("matches_sent");
      } else {
        setMessage(result.error);
      }
    });
  }

  function onReportNoMatches() {
    if (!intakeId?.trim()) return;
    setMessage(null);
    startTransition(async () => {
      const result = await submitNoMatchesToIntake(intakeId.trim());
      if (result.ok) {
        setMessage("No-match result reported to intake.");
        setLocalWorkflowStatus("no_matches");
      } else {
        setMessage(result.error);
      }
    });
  }

  return (
    <div className="space-y-3">
      {intakeScanNotify?.notified === true ? (
        <p className="text-sm text-neutral-700" role="status">
          Intake notified: scan completed with {intakeScanNotify.matchCount}{" "}
          matches.
        </p>
      ) : intakeScanNotify?.notified === false ? (
        <p className="text-sm text-amber-900" role="status">
          Scan completed, but intake system was not notified.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Link
          href="/scanner"
          className="text-neutral-800 underline-offset-2 hover:underline"
        >
          New search
        </Link>
        {intakeId?.trim() && matches.length > 0 ? (
          <button
            type="button"
            disabled={
              isPending ||
              selectedRows.length === 0 ||
              localWorkflowStatus === "matches_sent"
            }
            onClick={onSendToIntake}
            className="border border-[#6d6d68] bg-[#ececea] px-4 py-2 text-sm font-medium hover:bg-[#e0e0dc] disabled:opacity-50"
          >
            Send selected matches to intake
          </button>
        ) : null}
        {intakeId?.trim() ? (
          <button
            type="button"
            disabled={isPending || localWorkflowStatus === "no_matches"}
            onClick={onReportNoMatches}
            className="inline-flex items-center justify-center whitespace-nowrap border border-[#6d6d68] bg-[#ececea] px-4 py-2 text-sm font-medium hover:bg-[#e0e0dc] disabled:opacity-50"
          >
            {localWorkflowStatus === "no_matches"
              ? "No matches reported to intake"
              : "Report no matches to intake"}
          </button>
        ) : null}
        {message ? (
          <span className="text-neutral-700" role="status">
            {message}
          </span>
        ) : null}
      </div>

      {matches.length > 0 ? (
        <div className="border border-[#b8b8b4] bg-white px-4 py-3 text-sm">
          <span>
            Listed total:{" "}
            <strong className="text-neutral-950">
              {formatUsdTotal(listedTotal)}
            </strong>
          </span>
          <span className="ml-6">
            Selected total:{" "}
            <strong className="text-neutral-950">
              {formatUsdTotal(selectedTotal)}
            </strong>
          </span>
        </div>
      ) : null}

      {scannerQuery && matches.length > 0 ? (
        <LeadDiscoverySaveBar
          scannerQuery={scannerQuery}
          matches={matches}
          selectedById={selected}
        />
      ) : null}

      <div className="overflow-x-auto border border-[#b8b8b4] bg-white">
        <table className="w-full min-w-[960px] border-collapse text-left text-sm">
          <thead className="bg-[#ececea] text-neutral-800">
            <tr>
              <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(e) => toggleAll(e.target.checked)}
                    aria-label="Select all rows"
                  />
                  Select
                </label>
              </th>
              <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                Source
              </th>
              <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                Reported owner
              </th>
              <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                Holder
              </th>
              <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                Property ID
              </th>
              <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                Account type
              </th>
              <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                Amount
              </th>
              <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                Reported address
              </th>
              <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                Confidence
              </th>
              <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                Notes / reason
              </th>
            </tr>
          </thead>
          <tbody>
            {matches.map((row) => (
              <tr key={row.id}>
                <td className="border-b border-[#e0e0dc] px-3 py-2 align-top">
                  <input
                    type="checkbox"
                    checked={!!selected[row.id]}
                    onChange={() => toggle(row.id)}
                    aria-label={`Select row ${row.propertyId}`}
                  />
                </td>
                <td className="border-b border-[#e0e0dc] px-3 py-2 align-top">
                  {row.sourceName}
                </td>
                <td className="border-b border-[#e0e0dc] px-3 py-2 align-top">
                  {row.reportedOwnerName}
                </td>
                <td className="border-b border-[#e0e0dc] px-3 py-2 align-top">
                  {row.holderName}
                </td>
                <td className="border-b border-[#e0e0dc] px-3 py-2 align-top font-mono text-xs">
                  {row.propertyId}
                </td>
                <td className="border-b border-[#e0e0dc] px-3 py-2 align-top">
                  {row.propertyType || "-"}
                </td>
                <td className="border-b border-[#e0e0dc] px-3 py-2 align-top">
                  {row.amount}
                </td>
                <td className="border-b border-[#e0e0dc] px-3 py-2 align-top">
                  {row.reportedAddress}
                </td>
                <td className="border-b border-[#e0e0dc] px-3 py-2 align-top">
                  {row.confidence}
                </td>
                <td className="border-b border-[#e0e0dc] px-3 py-2 align-top text-neutral-800">
                  {row.notes}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {matches.length === 0 ? (
        <p className="text-sm text-neutral-700">No matches.</p>
      ) : null}
    </div>
  );
}
