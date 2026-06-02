"use client";

import { useState, useTransition } from "react";

import { fetchLeadOutreachDraftsAction } from "@/app/scanner/leads/lead-batch-actions";

type Props = {
  batchId: number;
  scanningDisabled: boolean;
};

export function LeadBatchClientActions({ batchId, scanningDisabled }: Props) {
  const [draftText, setDraftText] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const loadDrafts = () => {
    setDraftError(null);
    startTransition(async () => {
      const res = await fetchLeadOutreachDraftsAction(batchId);
      if (res.ok) {
        setDraftText(res.text);
      } else {
        setDraftError(res.error);
        setDraftText(null);
      }
    });
  };

  return (
    <div className="space-y-4 border border-[#e0e0dc] bg-[#fafaf8] p-4">
      <h3 className="text-sm font-semibold text-neutral-900">
        Approved outreach (manual send)
      </h3>
      <p className="text-sm text-neutral-700">
        Nothing is emailed automatically. Generate drafts, copy into your mail
        client, send only after human review, then mark rows as sent.
      </p>
      <button
        type="button"
        onClick={loadDrafts}
        disabled={pending}
        className="border border-[#6d6d68] bg-[#ececea] px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-[#e0e0dc] disabled:opacity-50"
      >
        {pending ? "Loading…" : "Generate email drafts (approved leads)"}
      </button>
      {draftError ? (
        <p className="text-sm text-red-800">{draftError}</p>
      ) : null}
      {draftText !== null ? (
        <div className="grid gap-2">
          <label className="text-xs font-semibold uppercase text-neutral-600">
            Drafts (copy / paste)
          </label>
          <textarea
            readOnly
            rows={16}
            value={draftText}
            className="w-full border border-[#b8b8b4] bg-white p-2 font-mono text-xs text-neutral-900"
          />
        </div>
      ) : null}
      {scanningDisabled ? null : (
        <p className="text-xs text-neutral-500">
          Run a batch scan from the form above before reviewing matches.
        </p>
      )}
    </div>
  );
}
