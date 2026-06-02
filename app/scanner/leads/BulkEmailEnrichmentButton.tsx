"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Props = {
  limit?: number;
};

export function BulkEmailEnrichmentButton({ limit = 25 }: Props) {
  const router = useRouter();
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
            const response = await fetch(
              `/api/scanner/email-enrichment/run-saved?limit=${limit}`,
              { method: "POST" },
            );
            const data = (await response.json().catch(() => null)) as
              | { ok?: boolean; processed?: number; error?: string }
              | null;
            if (!response.ok || !data?.ok) {
              setMessage(data?.error || "Email parser run failed.");
              return;
            }
            setMessage(`Processed ${data.processed ?? 0} saved lead(s).`);
            router.refresh();
          });
        }}
        className="border border-[#6d6d68] bg-[#ececea] px-4 py-2 text-sm font-medium hover:bg-[#e0e0dc] disabled:opacity-50"
      >
        {pending ? "Finding emails..." : "Find emails for saved leads"}
      </button>
      {message ? (
        <span className="text-sm text-neutral-700" role="status">
          {message}
        </span>
      ) : null}
    </div>
  );
}
