import { ScanResultsTable } from "@/components/ScanResultsTable";
import { saveIntakeScanRun } from "@/lib/scanner/intake-scan-store";
import {
  notifyIntakeScanRun,
  runScanner,
} from "@/lib/scanner/scanner-service";
import type { ScannerQuery } from "@/lib/scanner/types";
import Link from "next/link";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ScannerResultsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const name = typeof sp.name === "string" ? sp.name : "";
  const city = typeof sp.city === "string" ? sp.city : undefined;
  const state = typeof sp.state === "string" ? sp.state : undefined;
  const addressHint =
    typeof sp.addressHint === "string" ? sp.addressHint : undefined;
  const intakeId =
    typeof sp.intakeId === "string" ? sp.intakeId : undefined;

  if (!name.trim()) {
    return (
      <div className="space-y-4">
        <div className="border border-[#b8b8b4] bg-white p-4 text-sm">
          <p className="mb-3 text-neutral-800">
            Enter a name on the search page to run a scan.
          </p>
          <Link href="/scanner" className="text-neutral-900 underline">
            Go to scanner search
          </Link>
        </div>
      </div>
    );
  }

  const query: ScannerQuery = {
    name: name.trim(),
    city,
    state,
    addressHint,
    intakeId,
  };

  const matches = await runScanner(query);
  const savedProgress = await saveIntakeScanRun(query, matches);

  let intakeScanNotify:
    | { notified: true; matchCount: number }
    | { notified: false }
    | undefined;
  const trimmedIntakeId = intakeId?.trim();
  if (trimmedIntakeId) {
    const notifyNotes = [
      query.city && `city=${query.city}`,
      query.state && `state=${query.state}`,
      query.addressHint && `addressHint=${query.addressHint}`,
    ]
      .filter(Boolean)
      .join("; ");
    const { ok } = await notifyIntakeScanRun(
      trimmedIntakeId,
      matches.length,
      notifyNotes || undefined,
    );
    intakeScanNotify = ok
      ? { notified: true, matchCount: matches.length }
      : { notified: false };
  }

  const querySummary = [
    query.name,
    query.city,
    query.state,
    query.intakeId ? `Intake: ${query.intakeId}` : "",
  ]
    .filter(Boolean)
    .join(" - ");

  const matchSummary =
    matches.length === 0
      ? "No matches found"
      : matches.length === 1
        ? "1 match found"
        : `${matches.length.toLocaleString()} matches found`;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Scan results</h1>
        <p className="mt-1 text-sm text-neutral-700">Query: {querySummary}</p>
        <p className="mt-2 text-sm font-medium text-neutral-900">
          {matchSummary}
        </p>
      </div>
      <ScanResultsTable
        matches={matches}
        scannerQuery={query}
        intakeId={intakeId}
        intakeScanNotify={intakeScanNotify}
        workflowStatus={savedProgress?.status}
      />
    </div>
  );
}
