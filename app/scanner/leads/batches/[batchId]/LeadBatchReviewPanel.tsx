"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import {
  approveLeadsAction,
  deleteLeadBusinessesAction,
  markLeadEmailsSentAction,
  runSelectedLeadScansAction,
} from "@/app/scanner/leads/lead-batch-actions";
import { formatUsdTotal } from "@/lib/scanner/amounts";

export type LeadBatchRowVm = {
  id: number;
  businessName: string;
  /** Primary first; all imported addresses for display. */
  emailsAll: string[];
  website: string;
  phone: string | null;
  outreachStatus: string;
  lastScannedAt: string | null;
  matchCount: number;
  matchTotal: number;
};

type Props = {
  batchId: number;
  businesses: LeadBatchRowVm[];
};

export function LeadBatchReviewPanel({ batchId, businesses }: Props) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();
  const scannedBusinesses = businesses.filter((b) => b.lastScannedAt);
  const businessesWithMatches = scannedBusinesses.filter((b) => b.matchCount > 0);
  const scannedWithoutMatches = scannedBusinesses.filter((b) => b.matchCount === 0);

  const selectedIds = (): number[] => {
    const boxes = document.querySelectorAll<HTMLInputElement>(
      `input[data-lead-select="${batchId}"]:checked`,
    );
    return [...boxes].map((el) => Number(el.value)).filter((n) => n > 0);
  };

  const toggleAllBusinesses = (checked: boolean) => {
    const boxes = document.querySelectorAll<HTMLInputElement>(
      `input[data-lead-select="${batchId}"]`,
    );
    boxes.forEach((box) => {
      box.checked = checked;
    });
    const selectAllBox = document.querySelector<HTMLInputElement>(
      `input[data-lead-select-all="${batchId}"]`,
    );
    if (selectAllBox) selectAllBox.checked = checked;
  };

  const scanSelected = () => {
    setMessage(null);
    const ids = selectedIds();
    if (ids.length === 0) {
      window.alert("Select at least one business to scan.");
      return;
    }
    startTransition(async () => {
      try {
        await runSelectedLeadScansAction(batchId, ids);
        router.refresh();
      } catch (e) {
        window.alert(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const runSelectionAction = (
    emptyMessage: string,
    action: (ids: number[]) => Promise<{ updatedCount?: number } | void>,
    successLabel: string,
  ) => {
    setMessage(null);
    const ids = selectedIds();
    if (ids.length === 0) {
      window.alert(emptyMessage);
      return;
    }
    startTransition(async () => {
      try {
        const result = await action(ids);
        toggleAllBusinesses(false);
        const updatedCount =
          result && typeof result.updatedCount === "number"
            ? result.updatedCount
            : ids.length;
        setMessage(
          `${successLabel}: ${updatedCount.toLocaleString("en-US")} of ${ids.length.toLocaleString("en-US")} selected.`,
        );
        router.refresh();
      } catch (e) {
        window.alert(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const markReachedOut = () =>
    runSelectionAction("Select at least one business to mark reached out.", (ids) =>
      markLeadEmailsSentAction(batchId, ids),
      "Marked reached out",
    );

  const saveSelected = () =>
    runSelectionAction("Select at least one business to save.", (ids) =>
      approveLeadsAction(batchId, ids),
      "Saved leads",
    );

  const deleteSelected = () => {
    setMessage(null);
    const ids = selectedIds();
    if (ids.length === 0) {
      window.alert("Select at least one business to delete.");
      return;
    }
    const ok = window.confirm(
      `Delete ${ids.length.toLocaleString("en-US")} selected business${ids.length === 1 ? "" : "es"} from this batch? This removes their saved matches too.`,
    );
    if (!ok) return;
    startTransition(async () => {
      try {
        const result = await deleteLeadBusinessesAction(batchId, ids);
        toggleAllBusinesses(false);
        setMessage(
          `Deleted ${result.deletedCount.toLocaleString("en-US")} of ${ids.length.toLocaleString("en-US")} selected.`,
        );
        router.refresh();
      } catch (e) {
        window.alert(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const scanStatus = (b: LeadBatchRowVm): string => {
    if (!b.lastScannedAt) return "not scanned";
    return b.matchCount > 0 ? "matches found" : "no matches";
  };

  const outreachLabel = (status: string): string => {
    const labels: Record<string, string> = {
      approved_for_email: "approved",
      email_sent: "email sent",
      responded: "responded",
      do_not_contact: "do not contact",
      rejected: "rejected",
    };
    return labels[status] ?? "-";
  };

  return (
    <div className="space-y-4">
      <div className="border border-[#b8b8b4] bg-white p-4">
        <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <div>
            <div className="text-xs uppercase text-neutral-600">Scanned</div>
            <div className="text-lg font-semibold">
              {scannedBusinesses.length.toLocaleString("en-US")} /{" "}
              {businesses.length.toLocaleString("en-US")}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase text-neutral-600">Matches found</div>
            <div className="text-lg font-semibold">
              {businessesWithMatches.length.toLocaleString("en-US")}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase text-neutral-600">No match</div>
            <div className="text-lg font-semibold">
              {scannedWithoutMatches.length.toLocaleString("en-US")}
            </div>
          </div>
        </div>

        {scannedBusinesses.length > 0 && businessesWithMatches.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-700">
            The scanned businesses returned no unclaimed-property matches. They
            are shown first in the table below with scan status <strong>no matches</strong>.
          </p>
        ) : null}
      </div>

      <div className="border border-[#b8b8b4] bg-white p-4">
        <p className="text-sm text-neutral-800">
          Select businesses, then scan, mark, or remove selected rows from this batch.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending || businesses.length === 0}
            onClick={() => toggleAllBusinesses(true)}
            className="border border-[#6d6d68] bg-white px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-[#ececea] disabled:opacity-50"
          >
            Select all businesses
          </button>
          <button
            type="button"
            disabled={pending || businesses.length === 0}
            onClick={() => toggleAllBusinesses(false)}
            className="border border-[#6d6d68] bg-white px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-[#ececea] disabled:opacity-50"
          >
            Clear selection
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={scanSelected}
            className="border border-[#6d6d68] bg-[#ececea] px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-[#e0e0dc] disabled:opacity-50"
          >
            {pending ? "Working..." : "Scan selected businesses"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={saveSelected}
            className="border border-[#6d6d68] bg-white px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-[#ececea] disabled:opacity-50"
          >
            Save selected leads
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={markReachedOut}
            className="border border-[#6d6d68] bg-white px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-[#ececea] disabled:opacity-50"
          >
            Mark reached out
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={deleteSelected}
            className="border border-red-800 bg-white px-4 py-2 text-sm font-medium text-red-900 hover:bg-red-50 disabled:opacity-50"
          >
            Delete selected businesses
          </button>
        </div>
        {message ? (
          <p className="mt-3 text-sm text-neutral-800" role="status">
            {message}
          </p>
        ) : null}
      </div>

      <div className="overflow-x-auto border border-[#b8b8b4] bg-white">
        <table className="w-full min-w-[1100px] border-collapse text-left text-sm">
          <thead className="bg-[#ececea] text-neutral-800">
            <tr>
              <th className="w-10 border-b border-[#b8b8b4] px-2 py-2 font-semibold">
                <input
                  type="checkbox"
                  data-lead-select-all={batchId}
                  disabled={pending || businesses.length === 0}
                  aria-label="Select all businesses"
                  title="Select all businesses"
                  onChange={(event) => toggleAllBusinesses(event.currentTarget.checked)}
                  className="h-4 w-4"
                />
              </th>
              <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                Business
              </th>
              <th className="min-w-[14rem] max-w-md border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                Emails
              </th>
              <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                Phone
              </th>
              <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                Website
              </th>
              <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                Scan status
              </th>
              <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                Outreach
              </th>
              <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                Last scanned
              </th>
              <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                Matches
              </th>
              <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                Total value
              </th>
            </tr>
          </thead>
          <tbody>
            {businesses.map((b) => (
              <tr key={b.id}>
                <td className="border-b border-[#e0e0dc] px-2 py-2 align-top">
                  <input
                    type="checkbox"
                    data-lead-select={batchId}
                    value={b.id}
                    disabled={pending}
                    aria-label={`Select ${b.businessName}`}
                    className="h-4 w-4"
                  />
                </td>
                <td className="border-b border-[#e0e0dc] px-3 py-2 align-top font-medium">
                  {b.matchCount > 0 ? (
                    <Link
                      href={`/scanner/leads/batches/${batchId}/businesses/${b.id}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {b.businessName}
                    </Link>
                  ) : (
                    b.businessName
                  )}
                </td>
                <td className="border-b border-[#e0e0dc] px-3 py-2 align-top">
                  {b.emailsAll.length === 0 ? (
                    "-"
                  ) : (
                    <ul className="max-w-md list-none space-y-1.5 p-0">
                      {b.emailsAll.map((addr, i) => (
                        <li key={`${b.id}-e-${i}`} className="flex flex-wrap">
                          <span
                            className={
                              i === 0
                                ? "inline-flex max-w-full break-all rounded-md bg-neutral-100 px-2 py-0.5 font-mono text-xs ring-1 ring-neutral-300"
                                : "inline-flex max-w-full break-all rounded-md bg-neutral-50 px-2 py-0.5 font-mono text-xs text-neutral-800"
                            }
                            title={i === 0 ? "Primary email (To: default)" : undefined}
                          >
                            {addr}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="whitespace-nowrap border-b border-[#e0e0dc] px-3 py-2 align-top">
                  {b.phone || "-"}
                </td>
                <td className="break-all border-b border-[#e0e0dc] px-3 py-2 align-top">
                  {b.website || "-"}
                </td>
                <td className="whitespace-nowrap border-b border-[#e0e0dc] px-3 py-2 align-top">
                  {scanStatus(b)}
                </td>
                <td className="whitespace-nowrap border-b border-[#e0e0dc] px-3 py-2 align-top">
                  {outreachLabel(b.outreachStatus)}
                </td>
                <td className="whitespace-nowrap border-b border-[#e0e0dc] px-3 py-2 align-top text-xs">
                  {b.lastScannedAt
                    ? new Date(b.lastScannedAt).toLocaleString("en-US")
                    : "-"}
                </td>
                <td className="border-b border-[#e0e0dc] px-3 py-2 align-top">
                  {b.matchCount > 0 ? (
                    <Link
                      href={`/scanner/leads/batches/${batchId}/businesses/${b.id}`}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {b.matchCount.toLocaleString("en-US")}
                    </Link>
                  ) : (
                    b.matchCount.toLocaleString("en-US")
                  )}
                </td>
                <td className="border-b border-[#e0e0dc] px-3 py-2 align-top text-xs">
                  {b.matchCount > 0 ? formatUsdTotal(b.matchTotal) : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
