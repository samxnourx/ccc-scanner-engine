"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { updateLeadOutcomeAction } from "@/app/scanner/leads/lead-batch-actions";

type Props = {
  batchId: number;
  businessId: number;
  outreachStatus: string;
  emailTo: string | null;
  subject: string | null;
  emailText: string | null;
  portalUrl: string | null;
  intakeId: string | null;
  sentAt: string | null;
};

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    email_sent: "Email sent",
    responded: "Responded / intake initiated",
    do_not_contact: "Do not contact",
  };
  return labels[status] ?? status.replace(/_/g, " ");
}

export function OutreachRecordPanel({
  batchId,
  businessId,
  outreachStatus,
  emailTo,
  subject,
  emailText,
  portalUrl,
  intakeId,
  sentAt,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  function setOutcome(status: "responded" | "do_not_contact"): void {
    setMessage(null);
    startTransition(async () => {
      const result = await updateLeadOutcomeAction(batchId, businessId, status);
      setMessage(result.ok ? result.message : result.error);
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="border border-[#b8b8b4] bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="text-sm text-neutral-800">
            <p>
              Status: <strong>{statusLabel(outreachStatus)}</strong>
            </p>
            <p className="mt-1">
              Sent to:{" "}
              {emailTo ? (
                <span className="font-mono text-xs">{emailTo}</span>
              ) : (
                "-"
              )}
            </p>
            <p className="mt-1">
              Sent: {sentAt ? new Date(sentAt).toLocaleString("en-US") : "-"}
            </p>
            {intakeId ? <p className="mt-1">Intake: {intakeId}</p> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={`/scanner/leads/batches/${batchId}/businesses/${businessId}/letter`}
              target="_blank"
              rel="noreferrer"
              className="border border-[#6d6d68] bg-white px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-[#ececea]"
            >
              Print recovery letter
            </a>
            <button
              type="button"
              disabled={pending}
              onClick={() => setOutcome("responded")}
              className="border border-[#6d6d68] bg-[#ececea] px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-[#e0e0dc] disabled:opacity-50"
            >
              Mark responded
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setOutcome("do_not_contact")}
              className="border border-red-800 bg-white px-4 py-2 text-sm font-medium text-red-900 hover:bg-red-50 disabled:opacity-50"
            >
              Do not contact
            </button>
          </div>
        </div>
        {portalUrl ? (
          <p className="mt-4 break-all text-sm">
            Confirmation link:{" "}
            <a className="underline-offset-2 hover:underline" href={portalUrl}>
              {portalUrl}
            </a>
          </p>
        ) : null}
        {message ? (
          <p className="mt-3 text-sm text-neutral-800" role="status">
            {message}
          </p>
        ) : null}
      </div>

      <div className="border border-[#b8b8b4] bg-white p-4">
        <h2 className="text-base font-semibold">Email sent</h2>
        {subject ? (
          <p className="mt-2 text-sm text-neutral-700">Subject: {subject}</p>
        ) : null}
        <textarea
          value={
            emailText ||
            "No exact email copy was saved for this row. It may have been marked reached out manually before email snapshots were added."
          }
          readOnly
          className="mt-3 h-96 w-full resize-y border border-[#b8b8b4] bg-[#fbfbfa] p-3 font-mono text-xs leading-5 text-neutral-900"
        />
      </div>
    </div>
  );
}
