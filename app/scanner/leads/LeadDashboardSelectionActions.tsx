"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  deleteLeadScanBatchesAction,
  removeLeadDashboardRowsAction,
} from "@/app/scanner/leads/lead-batch-actions";

type Props = {
  scope: string;
  kind: "batches" | "dashboard";
  emptyMessage: string;
  confirmSingular: string;
  confirmPlural: string;
  buttonLabel?: string;
};

function selectedValues(scope: string): string[] {
  const boxes = document.querySelectorAll<HTMLInputElement>(
    `input[data-dashboard-select="${scope}"]:checked`,
  );
  return [...boxes].map((box) => box.value).filter(Boolean);
}

function setScopeChecked(scope: string, checked: boolean): void {
  const boxes = document.querySelectorAll<HTMLInputElement>(
    `input[data-dashboard-select="${scope}"]`,
  );
  boxes.forEach((box) => {
    box.checked = checked;
  });
  const selectAll = document.querySelector<HTMLInputElement>(
    `input[data-dashboard-select-all="${scope}"]`,
  );
  if (selectAll) selectAll.checked = checked;
}

function parseDashboardValues(values: string[]): {
  leadBusinessIds: number[];
  leadDiscoveryIds: string[];
  prospectIds: number[];
} {
  const leadBusinessIds: number[] = [];
  const leadDiscoveryIds: string[] = [];
  const prospectIds: number[] = [];

  for (const value of values) {
    if (value.startsWith("business:")) {
      const id = Number(value.slice("business:".length));
      if (Number.isFinite(id) && id > 0) leadBusinessIds.push(id);
    } else if (value.startsWith("discovery:")) {
      const id = value.slice("discovery:".length).trim();
      if (id) leadDiscoveryIds.push(id);
    } else if (value.startsWith("prospect:")) {
      const id = Number(value.slice("prospect:".length));
      if (Number.isFinite(id) && id > 0) prospectIds.push(id);
    }
  }

  return { leadBusinessIds, leadDiscoveryIds, prospectIds };
}

export function LeadDashboardBulkActions({
  scope,
  kind,
  emptyMessage,
  confirmSingular,
  confirmPlural,
  buttonLabel = "Delete selected",
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const deleteSelected = () => {
    setMessage(null);
    const values = selectedValues(scope);
    if (values.length === 0) {
      window.alert(emptyMessage);
      return;
    }
    const countText = values.length.toLocaleString("en-US");
    const confirmText = values.length === 1 ? confirmSingular : confirmPlural;
    if (!window.confirm(confirmText.replace("{count}", countText))) return;

    startTransition(async () => {
      try {
        const result =
          kind === "batches"
            ? await deleteLeadScanBatchesAction(
                values
                  .map((value) => Number(value))
                  .filter((id) => Number.isFinite(id) && id > 0),
              )
            : await removeLeadDashboardRowsAction(parseDashboardValues(values));
        setScopeChecked(scope, false);
        setMessage(
          `Deleted ${result.deletedCount.toLocaleString("en-US")} of ${values.length.toLocaleString("en-US")} selected.`,
        );
        router.refresh();
      } catch (e) {
        window.alert(e instanceof Error ? e.message : String(e));
      }
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => setScopeChecked(scope, true)}
        className="border border-[#6d6d68] bg-white px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-[#ececea] disabled:opacity-50"
      >
        Select all
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => setScopeChecked(scope, false)}
        className="border border-[#6d6d68] bg-white px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-[#ececea] disabled:opacity-50"
      >
        Clear
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={deleteSelected}
        className="border border-red-800 bg-white px-3 py-1.5 text-sm font-medium text-red-900 hover:bg-red-50 disabled:opacity-50"
      >
        {pending ? "Deleting..." : buttonLabel}
      </button>
      {message ? (
        <span className="text-sm text-neutral-700" role="status">
          {message}
        </span>
      ) : null}
    </div>
  );
}

export function LeadDashboardSelectAllCheckbox({
  scope,
  label,
}: {
  scope: string;
  label: string;
}) {
  return (
    <input
      type="checkbox"
      data-dashboard-select-all={scope}
      aria-label={label}
      title={label}
      className="h-4 w-4"
      onChange={(event) => setScopeChecked(scope, event.currentTarget.checked)}
    />
  );
}

export function LeadDashboardDeleteButton({
  kind,
  value,
  label = "Delete",
}: {
  kind: "batches" | "dashboard";
  value: string;
  label?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const onDelete = () => {
    if (!window.confirm("Delete this row from the Lead Dashboard?")) return;
    startTransition(async () => {
      try {
        if (kind === "batches") {
          await deleteLeadScanBatchesAction([Number(value)]);
        } else {
          await removeLeadDashboardRowsAction(parseDashboardValues([value]));
        }
        router.refresh();
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
      className="border border-red-800 bg-white px-3 py-1.5 text-sm font-medium text-red-900 hover:bg-red-50 disabled:opacity-50"
    >
      {pending ? "Deleting..." : label}
    </button>
  );
}
