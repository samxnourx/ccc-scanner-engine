"use client";

import { updateLeadDiscoveryAction } from "@/app/actions/lead-discovery-actions";
import {
  LEAD_DISCOVERY_STATUSES,
  LEAD_TARGET_TYPES,
  type LeadDiscoveryRecord,
  type LeadDiscoveryStatus,
  type LeadTargetType,
} from "@/lib/scanner/lead-discovery-types";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Props = {
  lead: LeadDiscoveryRecord;
};

const STATUS_LABELS: Record<LeadDiscoveryStatus, string> = {
  detected: "Detected",
  reviewed: "Reviewed",
  approved_for_outreach: "Approved for outreach",
  outreach_sent: "Outreach sent",
  responded: "Responded",
  converted: "Converted",
  declined: "Declined",
  archived: "Archived",
};

const TARGET_LABELS: Record<LeadTargetType, string> = {
  individual: "Individual",
  business: "Business",
  organization: "Organization",
  unknown: "Unknown",
};

export function LeadDiscoveryDetailForm({ lead }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<LeadDiscoveryStatus>(lead.status);
  const [notes, setNotes] = useState(lead.notes);
  const [targetName, setTargetName] = useState(lead.targetName);
  const [targetType, setTargetType] = useState<string>(lead.targetType ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSave() {
    setMessage(null);
    startTransition(async () => {
      const result = await updateLeadDiscoveryAction({
        id: lead.leadDiscoveryId,
        status,
        notes,
        targetName,
        targetType,
      });
      if (result.ok) {
        setMessage("Saved.");
        router.refresh();
      } else {
        setMessage(result.error);
      }
    });
  }

  return (
    <div className="space-y-4 border border-[#b8b8b4] bg-white p-4">
      <h2 className="text-base font-semibold text-neutral-900">
        Report status &amp; notes
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1">
          <label htmlFor="leadStatus" className="text-sm font-medium">
            Status
          </label>
          <select
            id="leadStatus"
            value={status}
            onChange={(e) =>
              setStatus(e.target.value as LeadDiscoveryStatus)
            }
            className="border border-[#b8b8b4] bg-white px-2 py-1.5 text-sm"
          >
            {LEAD_DISCOVERY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <label htmlFor="leadTargetType" className="text-sm font-medium">
            Target type (optional)
          </label>
          <select
            id="leadTargetType"
            value={targetType}
            onChange={(e) => setTargetType(e.target.value)}
            className="border border-[#b8b8b4] bg-white px-2 py-1.5 text-sm"
          >
            <option value="">—</option>
            {LEAD_TARGET_TYPES.map((t) => (
              <option key={t} value={t}>
                {TARGET_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid gap-1">
        <label htmlFor="leadTargetName" className="text-sm font-medium">
          Target / display name
        </label>
        <input
          id="leadTargetName"
          value={targetName}
          onChange={(e) => setTargetName(e.target.value)}
          className="border border-[#b8b8b4] bg-white px-2 py-1.5 text-sm"
          autoComplete="off"
        />
      </div>
      <div className="grid gap-1">
        <label htmlFor="leadNotes" className="text-sm font-medium">
          Internal notes
        </label>
        <textarea
          id="leadNotes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={5}
          className="border border-[#b8b8b4] bg-white px-2 py-1.5 text-sm"
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={onSave}
          className="border border-[#6d6d68] bg-[#ececea] px-4 py-2 text-sm font-medium hover:bg-[#e0e0dc] disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save notes & status"}
        </button>
        {message ? (
          <span className="text-sm text-neutral-800" role="status">
            {message}
          </span>
        ) : null}
      </div>
    </div>
  );
}
