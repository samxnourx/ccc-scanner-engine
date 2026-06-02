import Link from "next/link";
import { notFound } from "next/navigation";

import {
  LeadBatchReviewPanel,
  type LeadBatchRowVm,
} from "@/app/scanner/leads/batches/[batchId]/LeadBatchReviewPanel";
import {
  getLeadScanBatchDetail,
  listEmailsForLeadBusiness,
} from "@/lib/scanner/lead-batch-service";
import { sumAmountFields } from "@/lib/scanner/amounts";

export const dynamic = "force-dynamic";

export default async function LeadScanBatchDetailPage(props: {
  params: Promise<{ batchId: string }>;
}) {
  const { batchId: raw } = await props.params;
  const batchId = Number.parseInt(raw, 10);
  if (!Number.isFinite(batchId) || batchId <= 0) notFound();

  const batch = await getLeadScanBatchDetail(batchId);
  if (!batch) notFound();

  const activeStatuses = new Set([
    "not_scanned",
    "scan_pending",
    "matches_found",
    "no_matches",
    "rejected",
  ]);

  const rows: LeadBatchRowVm[] = batch.businesses
    .filter((b) => activeStatuses.has(b.outreachStatus))
    .map((b) => ({
      id: b.id,
      businessName: b.businessName,
      emailsAll: listEmailsForLeadBusiness(b),
      website: b.website,
      phone: b.phone,
      outreachStatus: b.outreachStatus,
      lastScannedAt: b.lastScannedAt?.toISOString() ?? null,
      matchCount: b.matches.length,
      matchTotal: sumAmountFields(b.matches.map((m) => m.amount)),
    }))
    .sort((a, b) => {
    if (a.lastScannedAt && !b.lastScannedAt) return -1;
    if (!a.lastScannedAt && b.lastScannedAt) return 1;
    if (a.lastScannedAt && b.lastScannedAt) {
      return b.lastScannedAt.localeCompare(a.lastScannedAt);
    }
    return a.id - b.id;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Lead batch #{batch.id}
        </h1>
        <p className="mt-1 text-sm text-neutral-700">{batch.name}</p>
        <p className="mt-2 text-xs text-neutral-600">
          Status: <strong>{batch.status.replace(/_/g, " ")}</strong> | Created{" "}
          {new Date(batch.createdAt).toLocaleString("en-US")} | Businesses{" "}
          {batch.totalBusinesses.toLocaleString("en-US")} | Scanned{" "}
          {batch.scannedCount.toLocaleString("en-US")} | With matches{" "}
          {batch.matchesFoundCount.toLocaleString("en-US")}
        </p>
      </div>

      <LeadBatchReviewPanel batchId={batch.id} businesses={rows} />

      <p className="text-sm text-neutral-700">
        <Link href="/scanner/leads" className="underline-offset-2 hover:underline">
          Back to Lead Dashboard
        </Link>
      </p>
    </div>
  );
}
