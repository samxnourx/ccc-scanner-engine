import Link from "next/link";

import {
  fetchScannerIntakeQueue,
  type ScannerIntakeQueueItem,
} from "@/lib/scanner/intake-queue-api";
import {
  getCompletedIntakeScanProgresses,
  getIntakeScanProgressMap,
  intakeProgressLabel,
  isIntakeScanCompleted,
  saveIntakeQueueSnapshots,
} from "@/lib/scanner/intake-scan-store";

export const dynamic = "force-dynamic";

function formatStamp(iso: string): string {
  if (!iso.trim()) return "-";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

type QueueTableProps = {
  rows: ScannerIntakeQueueItem[];
  progressByIntakeId: Awaited<ReturnType<typeof getIntakeScanProgressMap>>;
  emptyMessage: string;
  actionLabel: string;
};

function QueueTable({
  rows,
  progressByIntakeId,
  emptyMessage,
  actionLabel,
}: QueueTableProps) {
  return (
    <div className="overflow-x-auto border border-[#b8b8b4] bg-white">
      <table className="w-full min-w-[960px] border-collapse text-left text-sm">
        <thead className="bg-[#ececea] text-neutral-800">
          <tr>
            <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
              Intake ID
            </th>
            <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
              Name
            </th>
            <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
              Phone
            </th>
            <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
              Email
            </th>
            <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
              Primary Claim Type
            </th>
            <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
              Scan Status
            </th>
            <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
              Created
            </th>
            <th className="w-32 border-b border-[#b8b8b4] px-3 py-2 font-semibold">
              Action
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={8}
                className="border-b border-[#e0e0dc] px-3 py-6 text-center text-neutral-600"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const progress = progressByIntakeId.get(row.intakeId);
              return (
                <tr key={row.intakeId} className="hover:bg-[#fafaf8]">
                  <td className="border-b border-[#e0e0dc] px-3 py-2 font-mono text-xs">
                    <Link
                      href={`/scanner/queue/${encodeURIComponent(row.intakeId)}`}
                      className="text-neutral-900 underline-offset-2 hover:underline"
                    >
                      {row.intakeId}
                    </Link>
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-2">
                    {row.fullName || "-"}
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-2 whitespace-nowrap">
                    {row.phone || "-"}
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-2">
                    {row.email || "-"}
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-2">
                    {row.primaryClaimType || "-"}
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-2">
                    {intakeProgressLabel(progress, row.intakeStatus)}
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-2 whitespace-nowrap text-xs">
                    {formatStamp(row.createdAt)}
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-2 whitespace-nowrap">
                    <Link
                      href={`/scanner/queue/${encodeURIComponent(row.intakeId)}`}
                      className="inline-flex min-w-24 items-center justify-center whitespace-nowrap border border-[#6d6d68] bg-[#ececea] px-3 py-1.5 text-sm font-medium text-neutral-900 no-underline hover:bg-[#e0e0dc]"
                    >
                      {actionLabel}
                    </Link>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Scanner database unavailable.";
}

export default async function ScannerQueuePage() {
  const result = await fetchScannerIntakeQueue();
  const scanProgressErrors: string[] = [];
  if (result.ok) {
    const snapshotResult = await saveIntakeQueueSnapshots(result.intakes)
      .then(() => null)
      .catch(errorMessage);
    if (snapshotResult) scanProgressErrors.push(snapshotResult);
  }
  const completedResult = await getCompletedIntakeScanProgresses()
    .then((rows) => ({ rows, error: null as string | null }))
    .catch((error: unknown) => ({ rows: [], error: errorMessage(error) }));
  if (completedResult.error) scanProgressErrors.push(completedResult.error);
  const completedProgresses = completedResult.rows;
  const progressResult = result.ok
    ? await getIntakeScanProgressMap([
        ...new Set([
          ...result.intakes.map((row) => row.intakeId),
          ...completedProgresses.map((progress) => progress.intakeId),
        ]),
      ])
        .then((map) => ({ map, error: null as string | null }))
        .catch((error: unknown) => ({
          map: new Map(),
          error: errorMessage(error),
        }))
    : { map: new Map(), error: null };
  if (progressResult.error) scanProgressErrors.push(progressResult.error);
  const progressByIntakeId = progressResult.map;
  const activeIntakes = result.ok
    ? result.intakes.filter(
        (row) => !isIntakeScanCompleted(progressByIntakeId.get(row.intakeId)),
      )
    : [];
  const completedIntakes = completedProgresses.map((progress) => {
    const liveIntake = result.ok
      ? result.intakes.find((row) => row.intakeId === progress.intakeId)
      : undefined;
    return (
      liveIntake ??
      progress.intakeSnapshot ?? {
        intakeId: progress.intakeId,
        fullName: progress.query?.name ?? "",
        phone: "",
        email: "",
        primaryClaimType: "",
        intakeStatus: "Completed",
        checkUnclaimedProperty: true,
        createdAt: progress.scanRanAt ?? "",
        updatedAt: progress.resultsSentAt ?? progress.scanRanAt ?? "",
      }
    );
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Intake scan queue
        </h1>
        <p className="mt-1 text-sm text-neutral-700">
          Intakes from the intake system that need an unclaimed property scan.
          Open a row to see scan progress, review saved results, or send matches.
        </p>
      </div>

      {!result.ok ? (
        <div className="border border-[#b8b8b4] bg-white p-4 text-sm text-neutral-800">
          {result.message}
        </div>
      ) : (
        <div className="space-y-6">
          {scanProgressErrors.length > 0 ? (
            <div className="border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
              Scan progress storage is not available in this environment. Live
              queue rows can still be shown when the intake endpoint is
              available, but saved scan progress requires the scanner database.
            </div>
          ) : null}
          <section className="space-y-2">
            <h2 className="text-base font-semibold tracking-tight">
              Active scan queue
            </h2>
            <QueueTable
              rows={activeIntakes}
              progressByIntakeId={progressByIntakeId}
              emptyMessage="No active intakes in the scan queue."
              actionLabel="Open"
            />
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold tracking-tight">
              Completed scans
            </h2>
            <QueueTable
              rows={completedIntakes}
              progressByIntakeId={progressByIntakeId}
              emptyMessage="No completed scans yet."
              actionLabel="View"
            />
          </section>
        </div>
      )}
    </div>
  );
}
