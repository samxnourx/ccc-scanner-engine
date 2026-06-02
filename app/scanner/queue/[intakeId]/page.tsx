import Link from "next/link";
import { notFound } from "next/navigation";

import { ScanResultsTable } from "@/components/ScanResultsTable";
import {
  fetchScannerIntakeQueue,
  type ScannerIntakeQueueItem,
} from "@/lib/scanner/intake-queue-api";
import {
  getIntakeScanProgress,
  intakeProgressLabel,
} from "@/lib/scanner/intake-scan-store";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ intakeId: string }>;
};

function formatStamp(iso: string | null): string {
  if (!iso?.trim()) return "-";
  try {
    return new Date(iso).toLocaleString("en-US", {
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

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm text-neutral-950">
        {value || "-"}
      </dd>
    </div>
  );
}

export default async function ScannerQueueDetailPage({ params }: Props) {
  const { intakeId } = await params;
  const decodedIntakeId = decodeURIComponent(intakeId);
  const progress = await getIntakeScanProgress(decodedIntakeId);
  const queueResult = await fetchScannerIntakeQueue();
  if (!queueResult.ok) {
    if (progress?.intakeSnapshot) {
      return <DetailView intake={progress.intakeSnapshot} progress={progress} />;
    }
    return (
      <div className="space-y-4">
        <Link
          href="/scanner/queue"
          className="text-sm text-neutral-800 underline-offset-2 hover:underline"
        >
          Back to scan queue
        </Link>
        <div className="border border-[#b8b8b4] bg-white p-4 text-sm text-neutral-800">
          {queueResult.message}
        </div>
      </div>
    );
  }

  const intake =
    queueResult.intakes.find((row) => row.intakeId === decodedIntakeId) ??
    progress?.intakeSnapshot;
  if (!intake) notFound();

  return <DetailView intake={intake} progress={progress} />;
}

function DetailView({
  intake,
  progress,
}: {
  intake: ScannerIntakeQueueItem;
  progress: Awaited<ReturnType<typeof getIntakeScanProgress>>;
}) {
  const qs = new URLSearchParams({
    name: intake.fullName,
    intakeId: intake.intakeId,
  });
  const statusLabel = intakeProgressLabel(progress, intake.intakeStatus);
  const matches = progress?.matches ?? [];
  const query = progress?.query ?? {
    name: intake.fullName,
    intakeId: intake.intakeId,
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href="/scanner/queue"
            className="text-sm text-neutral-800 underline-offset-2 hover:underline"
          >
            Back to scan queue
          </Link>
          <h1 className="mt-2 text-xl font-semibold tracking-tight">
            Intake scan detail
          </h1>
          <p className="mt-1 text-sm text-neutral-700">{statusLabel}</p>
        </div>
        <Link
          href={`/scanner/results?${qs.toString()}`}
          className="inline-flex items-center justify-center whitespace-nowrap border border-[#6d6d68] bg-[#ececea] px-4 py-2 text-sm font-medium text-neutral-900 no-underline hover:bg-[#e0e0dc]"
        >
          {progress?.scanRanAt ? "Run scan again" : "Run scan"}
        </Link>
      </div>

      <section className="border border-[#b8b8b4] bg-white p-4">
        <h2 className="text-base font-semibold tracking-tight">
          Intake information
        </h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <DetailRow label="Intake ID" value={intake.intakeId} />
          <DetailRow label="Name" value={intake.fullName} />
          <DetailRow label="Phone" value={intake.phone} />
          <DetailRow label="Email" value={intake.email} />
          <DetailRow
            label="Primary Claim Type"
            value={intake.primaryClaimType}
          />
          <DetailRow label="Intake Status" value={intake.intakeStatus} />
          <DetailRow label="Created" value={formatStamp(intake.createdAt)} />
          <DetailRow
            label="Last Scan"
            value={formatStamp(progress?.scanRanAt ?? null)}
          />
        </dl>
      </section>

      {!progress?.scanRanAt ? (
        <section className="border border-[#b8b8b4] bg-white p-4 text-sm text-neutral-800">
          No scan has been run for this intake yet.
        </section>
      ) : (
        <section className="space-y-3">
          <div>
            <h2 className="text-base font-semibold tracking-tight">
              Saved scan results
            </h2>
            <p className="mt-1 text-sm text-neutral-700">
              {matches.length === 0
                ? "Scan completed with no raw property matches."
                : `${matches.length.toLocaleString()} raw property matches saved for review.`}
            </p>
          </div>
          <ScanResultsTable
            matches={matches}
            scannerQuery={query}
            intakeId={intake.intakeId}
            workflowStatus={progress.status}
          />
        </section>
      )}
    </div>
  );
}
