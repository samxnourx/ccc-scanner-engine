"use client";

import { useTransition } from "react";

import { deleteLeadScanBatchAction } from "@/app/scanner/leads/lead-batch-actions";

type Props = {
  batchId: number;
  batchName: string;
};

export function LeadBatchDeleteButton({ batchId, batchName }: Props) {
  const [pending, startTransition] = useTransition();

  const onDelete = () => {
    const label = batchName.trim() || `Batch #${batchId}`;
    if (
      !window.confirm(
        `Delete this lead batch and all related businesses/matches?\n\n${label}`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      try {
        await deleteLeadScanBatchAction(batchId);
      } catch (e) {
        window.alert(e instanceof Error ? e.message : String(e));
      }
    });
  };

  return (
    <button
      type="button"
      disabled={pending}
      onClick={onDelete}
      className="border border-red-800 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-950 hover:bg-red-100 disabled:opacity-50"
    >
      {pending ? "Deleting…" : "Delete"}
    </button>
  );
}
