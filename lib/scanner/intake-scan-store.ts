import "server-only";

import { prisma } from "@/lib/scanner/db/client";
import type { ScannerIntakeQueueItem } from "@/lib/scanner/intake-queue-api";
import type { NormalizedMatch, ScannerQuery } from "@/lib/scanner/types";

export type IntakeScanWorkflowStatus =
  | "scan_pending"
  | "review_pending"
  | "no_matches"
  | "matches_sent";

export type IntakeScanProgress = {
  intakeId: string;
  status: IntakeScanWorkflowStatus;
  query: ScannerQuery | null;
  matches: NormalizedMatch[];
  matchCount: number;
  selectedCount: number;
  scanRanAt: string | null;
  resultsSentAt: string | null;
  noMatchReason: string;
  intakeSnapshot: ScannerIntakeQueueItem | null;
};

type IntakeScanRow = {
  intake_id: string;
  status: string;
  query_json: string | null;
  matches_json: string | null;
  match_count: number | bigint | null;
  selected_count: number | bigint | null;
  scan_ran_at: string | Date | null;
  results_sent_at: string | Date | null;
  no_match_reason: string | null;
  intake_json?: string | null;
};

let tableReady: Promise<void> | null = null;

function toIso(value: string | Date | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalizeStatus(status: string | null | undefined): IntakeScanWorkflowStatus {
  if (
    status === "review_pending" ||
    status === "no_matches" ||
    status === "matches_sent"
  ) {
    return status;
  }
  return "scan_pending";
}

function coerceProgress(row: IntakeScanRow | null): IntakeScanProgress | null {
  if (!row) return null;
  const matches = parseJson<NormalizedMatch[]>(row.matches_json, []);
  return {
    intakeId: row.intake_id,
    status: normalizeStatus(row.status),
    query: parseJson<ScannerQuery | null>(row.query_json, null),
    matches,
    matchCount: Number(row.match_count ?? matches.length),
    selectedCount: Number(row.selected_count ?? 0),
    scanRanAt: toIso(row.scan_ran_at),
    resultsSentAt: toIso(row.results_sent_at),
    noMatchReason: row.no_match_reason ?? "",
    intakeSnapshot: parseJson<ScannerIntakeQueueItem | null>(
      row.intake_json ?? null,
      null,
    ),
  };
}

async function ensureIntakeScanTable(): Promise<void> {
  tableReady ??= (async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS intake_scan_progress (
        intake_id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'scan_pending',
        query_json TEXT,
        matches_json TEXT NOT NULL DEFAULT '[]',
        match_count INTEGER NOT NULL DEFAULT 0,
        selected_count INTEGER NOT NULL DEFAULT 0,
        scan_ran_at DATETIME,
        results_sent_at DATETIME,
        no_match_reason TEXT NOT NULL DEFAULT '',
        intake_json TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await prisma
      .$executeRawUnsafe("ALTER TABLE intake_scan_progress ADD COLUMN intake_json TEXT")
      .catch(() => undefined);
  })();
  await tableReady;
}

export async function getIntakeScanProgress(
  intakeId: string,
): Promise<IntakeScanProgress | null> {
  const trimmed = intakeId.trim();
  if (!trimmed) return null;
  await ensureIntakeScanTable();
  const rows = await prisma.$queryRaw<IntakeScanRow[]>`
    SELECT *
    FROM intake_scan_progress
    WHERE intake_id = ${trimmed}
    LIMIT 1
  `;
  return coerceProgress(rows[0] ?? null);
}

export async function getIntakeScanProgressMap(
  intakeIds: string[],
): Promise<Map<string, IntakeScanProgress>> {
  const out = new Map<string, IntakeScanProgress>();
  for (const id of intakeIds) {
    const progress = await getIntakeScanProgress(id);
    if (progress) out.set(id, progress);
  }
  return out;
}

export async function getCompletedIntakeScanProgresses(): Promise<
  IntakeScanProgress[]
> {
  await ensureIntakeScanTable();
  const rows = await prisma.$queryRaw<IntakeScanRow[]>`
    SELECT *
    FROM intake_scan_progress
    WHERE status IN ('matches_sent', 'no_matches')
    ORDER BY COALESCE(results_sent_at, scan_ran_at, updated_at) DESC
  `;
  return rows
    .map((row) => coerceProgress(row))
    .filter((row): row is IntakeScanProgress => Boolean(row));
}

export async function saveIntakeQueueSnapshots(
  intakes: ScannerIntakeQueueItem[],
): Promise<void> {
  await ensureIntakeScanTable();
  for (const intake of intakes) {
    const snapshotJson = JSON.stringify(intake);
    await prisma.$executeRaw`
      INSERT INTO intake_scan_progress (
        intake_id,
        intake_json,
        updated_at
      )
      VALUES (
        ${intake.intakeId},
        ${snapshotJson},
        CURRENT_TIMESTAMP
      )
      ON CONFLICT(intake_id) DO UPDATE SET
        intake_json = excluded.intake_json,
        updated_at = CURRENT_TIMESTAMP
    `;
  }
}

export async function saveIntakeScanRun(
  query: ScannerQuery,
  matches: NormalizedMatch[],
): Promise<IntakeScanProgress | null> {
  const intakeId = query.intakeId?.trim();
  if (!intakeId) return null;
  await ensureIntakeScanTable();
  const status: IntakeScanWorkflowStatus =
    matches.length === 0 ? "no_matches" : "review_pending";
  const queryJson = JSON.stringify({ ...query, intakeId });
  const matchesJson = JSON.stringify(matches);
  await prisma.$executeRaw`
    INSERT INTO intake_scan_progress (
      intake_id,
      status,
      query_json,
      matches_json,
      match_count,
      selected_count,
      scan_ran_at,
      results_sent_at,
      no_match_reason,
      updated_at
    )
    VALUES (
      ${intakeId},
      ${status},
      ${queryJson},
      ${matchesJson},
      ${matches.length},
      0,
      CURRENT_TIMESTAMP,
      NULL,
      '',
      CURRENT_TIMESTAMP
    )
    ON CONFLICT(intake_id) DO UPDATE SET
      status = excluded.status,
      query_json = excluded.query_json,
      matches_json = excluded.matches_json,
      match_count = excluded.match_count,
      selected_count = 0,
      scan_ran_at = CURRENT_TIMESTAMP,
      results_sent_at = NULL,
      no_match_reason = '',
      updated_at = CURRENT_TIMESTAMP
  `;
  return getIntakeScanProgress(intakeId);
}

export async function markIntakeMatchesSent(
  intakeId: string,
  selectedCount: number,
): Promise<void> {
  const trimmed = intakeId.trim();
  if (!trimmed) return;
  await ensureIntakeScanTable();
  await prisma.$executeRaw`
    INSERT INTO intake_scan_progress (
      intake_id,
      status,
      selected_count,
      results_sent_at,
      updated_at
    )
    VALUES (
      ${trimmed},
      'matches_sent',
      ${selectedCount},
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT(intake_id) DO UPDATE SET
      status = 'matches_sent',
      selected_count = ${selectedCount},
      results_sent_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  `;
}

export async function markIntakeNoMatches(
  intakeId: string,
  reason: string,
): Promise<void> {
  const trimmed = intakeId.trim();
  if (!trimmed) return;
  await ensureIntakeScanTable();
  await prisma.$executeRaw`
    INSERT INTO intake_scan_progress (
      intake_id,
      status,
      no_match_reason,
      updated_at
    )
    VALUES (
      ${trimmed},
      'no_matches',
      ${reason},
      CURRENT_TIMESTAMP
    )
    ON CONFLICT(intake_id) DO UPDATE SET
      status = 'no_matches',
      selected_count = 0,
      results_sent_at = NULL,
      no_match_reason = ${reason},
      updated_at = CURRENT_TIMESTAMP
  `;
}

export function intakeProgressLabel(
  progress: IntakeScanProgress | null | undefined,
  fallbackStatus: string,
): string {
  if (!progress || progress.status === "scan_pending") {
    const prefix = fallbackStatus.trim() || "Inquiry received";
    return `${prefix} - scan pending`;
  }
  if (progress.status === "matches_sent") {
    const count = progress.selectedCount;
    const noun = count === 1 ? "match" : "matches";
    return `Scan completed - ${count.toLocaleString()} ${noun} sent`;
  }
  if (progress.status === "no_matches") {
    return "Scan completed - no matches";
  }
  const count = progress.matchCount;
  const noun = count === 1 ? "property" : "properties";
  return `Scan completed - ${count.toLocaleString()} ${noun} review pending`;
}

export function isIntakeScanCompleted(
  progress: IntakeScanProgress | null | undefined,
): boolean {
  return progress?.status === "matches_sent" || progress?.status === "no_matches";
}
