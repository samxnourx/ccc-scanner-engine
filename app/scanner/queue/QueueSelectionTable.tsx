"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";

import { removeSelectedIntakesFromQueue } from "@/app/scanner/queue/queue-actions";

export type QueueSelectionRow = {
  intakeId: string;
  fullName: string;
  phone: string;
  email: string;
  primaryClaimType: string;
  scanStatus: string;
  createdLabel: string;
  actionLabel: string;
};

type Props = {
  rows: QueueSelectionRow[];
  emptyMessage: string;
};

export function QueueSelectionTable({ rows, emptyMessage }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const rowIds = useMemo(() => rows.map((row) => row.intakeId), [rows]);
  const allSelected = rowIds.length > 0 && rowIds.every((id) => selected.has(id));

  function toggleAll(checked: boolean) {
    setMessage(null);
    setSelected(checked ? new Set(rowIds) : new Set());
  }

  function toggleOne(intakeId: string, checked: boolean) {
    setMessage(null);
    setSelected((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(intakeId);
      } else {
        next.delete(intakeId);
      }
      return next;
    });
  }

  function removeSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    const countLabel = ids.length === 1 ? "1 selected item" : `${ids.length} selected items`;
    if (!window.confirm(`Remove ${countLabel} from the scan queue?`)) return;

    startTransition(async () => {
      const result = await removeSelectedIntakesFromQueue(ids);
      if (!result.ok) {
        setMessage(result.error ?? "Could not remove selected queue rows.");
        return;
      }
      setSelected(new Set());
      setMessage(
        result.removedCount === 1
          ? "Removed 1 item from the scan queue."
          : `Removed ${result.removedCount} items from the scan queue.`,
      );
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-neutral-700">
          {selected.size === 0
            ? "No rows selected"
            : `${selected.size.toLocaleString()} row${selected.size === 1 ? "" : "s"} selected`}
        </p>
        <button
          type="button"
          onClick={removeSelected}
          disabled={selected.size === 0 || isPending}
          className="border border-[#6d6d68] bg-white px-3 py-1.5 text-sm font-medium text-neutral-900 disabled:cursor-not-allowed disabled:opacity-50 hover:bg-[#ececea]"
        >
          {isPending ? "Deleting..." : "Delete selected"}
        </button>
      </div>
      {message ? (
        <p className="border border-[#b8b8b4] bg-white px-3 py-2 text-sm text-neutral-800">
          {message}
        </p>
      ) : null}
      <div className="overflow-x-auto border border-[#b8b8b4] bg-white">
        <table className="w-full min-w-[1040px] border-collapse text-left text-sm">
          <thead className="bg-[#ececea] text-neutral-800">
            <tr>
              <th className="w-12 border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                <input
                  type="checkbox"
                  aria-label="Select all queue rows"
                  checked={allSelected}
                  disabled={rows.length === 0}
                  onChange={(event) => toggleAll(event.target.checked)}
                />
              </th>
              <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                Intake ID
              </th>
              <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                Name
              </th>
              <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                Phone
              </th>
              <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                Email
              </th>
              <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                Primary Claim Type
              </th>
              <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                Scan Status
              </th>
              <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                Created
              </th>
              <th className="w-32 border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="border-b border-[#e0e0dc] px-3 py-6 text-center text-neutral-600"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.intakeId} className="hover:bg-[#fafaf8]">
                  <td className="border-b border-[#e0e0dc] px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Select ${row.intakeId}`}
                      checked={selected.has(row.intakeId)}
                      onChange={(event) =>
                        toggleOne(row.intakeId, event.target.checked)
                      }
                    />
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-2 font-mono text-xs">
                    <Link
                      href={`/scanner/queue/${encodeURIComponent(row.intakeId)}`}
                      className="text-neutral-900 underline-offset-2 hover:underline"
                    >
                      {row.intakeId}
                    </Link>
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-2">
                    {row.fullName || "-"}
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-2 whitespace-nowrap">
                    {row.phone || "-"}
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-2">
                    {row.email || "-"}
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-2">
                    {row.primaryClaimType || "-"}
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-2">
                    {row.scanStatus}
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-2 whitespace-nowrap text-xs">
                    {row.createdLabel}
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-2 whitespace-nowrap">
                    <Link
                      href={`/scanner/queue/${encodeURIComponent(row.intakeId)}`}
                      className="inline-flex min-w-24 items-center justify-center whitespace-nowrap border border-[#6d6d68] bg-[#ececea] px-3 py-1.5 text-sm font-medium text-neutral-900 no-underline hover:bg-[#e0e0dc]"
                    >
                      {row.actionLabel}
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
