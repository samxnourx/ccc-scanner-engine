"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { approveLeadsAction } from "@/app/scanner/leads/lead-batch-actions";

type Props = {
  batchId: number;
  businessId: number;
};

export function SaveLeadButton({ batchId, businessId }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function saveLead(): void {
    setMessage(null);
    startTransition(async () => {
      try {
        await approveLeadsAction(batchId, [businessId]);
        setMessage("Saved lead.");
        router.refresh();
      } catch (e) {
        window.alert(e instanceof Error ? e.message : String(e));
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 border border-[#b8b8b4] bg-white p-4">
      <button
        type="button"
        disabled={pending}
        onClick={saveLead}
        className="border border-[#6d6d68] bg-[#ececea] px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-[#e0e0dc] disabled:opacity-50"
      >
        {pending ? "Saving..." : "Save lead"}
      </button>
      {message ? (
        <p className="text-sm text-neutral-800" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
