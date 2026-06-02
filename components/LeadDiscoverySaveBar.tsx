"use client";

import { createLeadDiscoveryAction } from "@/app/actions/lead-discovery-actions";
import type { NormalizedMatch, ScannerQuery } from "@/lib/scanner/types";
import { useState, useTransition } from "react";

type Props = {
  scannerQuery: ScannerQuery;
  /** All rows currently displayed on the results table. */
  matches: NormalizedMatch[];
  /** Checkbox state keyed by match id (same keys as results table). */
  selectedById: Record<string, boolean>;
};

export function LeadDiscoverySaveBar({
  scannerQuery,
  matches,
  selectedById,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (matches.length === 0) return null;

  function onSave() {
    setError(null);
    const selectedOnly = matches.filter((m) => selectedById[m.id]);
    const toSave = selectedOnly.length > 0 ? selectedOnly : matches;

    startTransition(async () => {
      const result = await createLeadDiscoveryAction({
        scannerQuery,
        matches: toSave,
      });
      if (result?.ok === false) {
        setError(result.error);
      }
    });
  }

  return (
    <div className="border border-[#b8b8b4] bg-[#f7f7f5] p-4 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[200px] flex-1 space-y-1 text-neutral-800">
          <p>
            Save this scan to the Lead Dashboard as an opportunity record (no
            outreach is sent).
          </p>
          <p className="text-xs text-neutral-600">
            If one or more rows are checked, only those rows are saved. If none
            are checked, all displayed matches are saved.
          </p>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={onSave}
          className="shrink-0 border border-[#6d6d68] bg-[#ececea] px-4 py-2 text-sm font-medium hover:bg-[#e0e0dc] disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save to Lead Dashboard"}
        </button>
      </div>
      {error ? (
        <p className="mt-2 text-sm text-red-800" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
