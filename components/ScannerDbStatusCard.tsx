import type { ScannerDatasetStatus } from "@/lib/scanner/lead-batch-service";

type Props = {
  status: ScannerDatasetStatus;
};

export function ScannerDbStatusCard({ status }: Props) {
  return (
    <div className="border border-[#b8b8b4] bg-white p-4 text-sm">
      <h2 className="text-base font-semibold text-neutral-900">
        Scanner database status
      </h2>
      <dl className="mt-3 grid gap-2 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium uppercase text-neutral-600">
            source_records total
          </dt>
          <dd className="font-mono text-neutral-900">
            {status.sourceRecordsTotal.toLocaleString("en-US")}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-neutral-600">
            CA SCO rows
          </dt>
          <dd className="font-mono text-neutral-900">
            {status.caScoCount.toLocaleString("en-US")}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs font-medium uppercase text-neutral-600">
            Last CA SCO row import timestamp (max imported_at)
          </dt>
          <dd className="text-neutral-900">
            {status.lastCaScoImportedAt
              ? new Date(status.lastCaScoImportedAt).toLocaleString("en-US")
              : "—"}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs font-medium uppercase text-neutral-600">
            CA_SCO_DATA_PATH (hint)
          </dt>
          <dd className="break-all font-mono text-xs text-neutral-800">
            {status.caScoDataPath || "—"}
          </dd>
        </div>
      </dl>
      {!status.caScoDatasetHealthy ? (
        <p className="mt-3 border border-amber-300 bg-amber-50 p-3 text-amber-950">
          CA SCO dataset appears incomplete: only{" "}
          <strong>{status.caScoCount.toLocaleString("en-US")}</strong> rows
          loaded (internal threshold {status.healthMinRows.toLocaleString("en-US")}{" "}
          rows — override with{" "}
          <code className="rounded bg-white px-1">CA_SCO_HEALTH_MIN_ROWS</code>
          ). Match quality may be limited until the full catalog is imported.
        </p>
      ) : null}
      <p className="mt-3 text-xs text-neutral-600">
        Lead scans always use whatever is currently in{" "}
        <code className="rounded bg-[#ececea] px-1">source_records</code>. For
        production refreshes, plan blue/green imports (stage a new dataset, verify
        counts, then swap) so live data is not truncated before replacement is
        ready.
      </p>
    </div>
  );
}
