"use client";

import { useTransition } from "react";

import {
  dismissProspectAction,
  saveProspectAsLeadAction,
} from "@/app/scanner/prospects/prospect-actions";

type Props = {
  prospectId: number;
};

export function ProspectActionButtons({ prospectId }: Props) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          startTransition(async () => {
            await saveProspectAsLeadAction(prospectId);
          });
        }}
        className="inline-flex min-w-24 items-center justify-center whitespace-nowrap border border-[#6d6d68] bg-[#ececea] px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-[#e0e0dc] disabled:opacity-50"
      >
        Save lead
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          startTransition(async () => {
            await dismissProspectAction(prospectId);
          });
        }}
        className="inline-flex min-w-24 items-center justify-center whitespace-nowrap border border-red-800 bg-white px-3 py-1.5 text-sm font-medium text-red-900 hover:bg-red-50 disabled:opacity-50"
      >
        Dismiss
      </button>
    </div>
  );
}
