"use client";

import { useState, useTransition } from "react";

import { runEmailEnrichmentAction } from "@/app/scanner/leads/email-enrichment-actions";

type Props = {
  targetType: "lead_business" | "lead_discovery" | "prospect";
  targetId: string;
  revalidatePaths: string[];
};

export function EmailEnrichmentRunButton({
  targetType,
  targetId,
  revalidatePaths,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setMessage(null);
          startTransition(async () => {
            const result = await runEmailEnrichmentAction({
              targetType,
              targetId,
              revalidatePaths,
            });
            setMessage(result.ok ? result.message : result.error);
          });
        }}
        className="border border-[#6d6d68] bg-[#ececea] px-4 py-2 text-sm font-medium hover:bg-[#e0e0dc] disabled:opacity-50"
      >
        {pending ? "Finding emails..." : "Run email parser"}
      </button>
      {message ? (
        <span className="text-sm text-neutral-700" role="status">
          {message}
        </span>
      ) : null}
    </div>
  );
}
