import { QueueSelectionTable } from "@/app/scanner/queue/QueueSelectionTable";
import {
  fetchScannerIntakeQueue,
  type ScannerIntakeQueueItem,
} from "@/lib/scanner/intake-queue-api";
import {
  getCompletedIntakeScanProgresses,
  getHiddenIntakeScanQueueIds,
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

function QueueTableData({
  rows,
  progressByIntakeId,
  actionLabel,
}: QueueTableProps) {
  return rows.map((row) => {
    const progress = progressByIntakeId.get(row.intakeId);
    return {
      intakeId: row.intakeId,
      fullName: row.fullName,
      phone: row.phone,
      email: row.email,
      primaryClaimType: row.primaryClaimType,
      scanStatus: intakeProgressLabel(progress, row.intakeStatus),
      createdLabel: formatStamp(row.createdAt),
      actionLabel,
    };
  });
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
  const hiddenResult = await getHiddenIntakeScanQueueIds()
    .then((ids) => ({ ids, error: null as string | null }))
    .catch((error: unknown) => ({
      ids: new Set<string>(),
      error: errorMessage(error),
    }));
  if (hiddenResult.error) scanProgressErrors.push(hiddenResult.error);
  const hiddenIntakeIds = hiddenResult.ids;
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
        (row) =>
          !hiddenIntakeIds.has(row.intakeId) &&
          !isIntakeScanCompleted(progressByIntakeId.get(row.intakeId)),
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
  }).filter((row) => !hiddenIntakeIds.has(row.intakeId));

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
            <QueueSelectionTable
              rows={QueueTableData({
                rows: activeIntakes,
                progressByIntakeId,
                emptyMessage: "No active intakes in the scan queue.",
                actionLabel: "Open",
              })}
              emptyMessage="No active intakes in the scan queue."
            />
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold tracking-tight">
              Completed scans
            </h2>
            <QueueSelectionTable
              rows={QueueTableData({
                rows: completedIntakes,
                progressByIntakeId,
                emptyMessage: "No completed scans yet.",
                actionLabel: "View",
              })}
              emptyMessage="No completed scans yet."
            />
          </section>
        </div>
      )}
    </div>
  );
}
