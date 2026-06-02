"use server";

import {
  markIntakeMatchesSent,
  markIntakeNoMatches,
} from "@/lib/scanner/intake-scan-store";
import {
  matchToPayload,
  notifyIntakeScanRun,
  sendMatchesToIntake,
} from "@/lib/scanner/scanner-service";
import type { NormalizedMatch } from "@/lib/scanner/types";

export type SendScanResultsResult =
  | { ok: true; status: number }
  | { ok: false; error: string };

export async function submitScanResultsToIntake(
  intakeId: string,
  selected: NormalizedMatch[],
): Promise<SendScanResultsResult> {
  const trimmed = intakeId.trim();
  if (!trimmed) {
    return { ok: false, error: "Intake ID is required." };
  }
  if (selected.length === 0) {
    return { ok: false, error: "Select at least one match." };
  }

  try {
    const res = await sendMatchesToIntake(
      trimmed,
      selected.map(matchToPayload),
    );
    const bodyText = await res.text().catch(() => "");

    if (!res.ok) {
      return {
        ok: false,
        error:
          bodyText.trim() ||
          `Request failed (${res.status} ${res.statusText})`.trim(),
      };
    }

    await markIntakeMatchesSent(trimmed, selected.length);
    return { ok: true, status: res.status };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return { ok: false, error: message };
  }
}

export async function submitNoMatchesToIntake(
  intakeId: string,
): Promise<SendScanResultsResult> {
  const trimmed = intakeId.trim();
  if (!trimmed) {
    return { ok: false, error: "Intake ID is required." };
  }

  try {
    const result = await notifyIntakeScanRun(
      trimmed,
      0,
      "Manual no-match report from Sami Nouri Law Firm | Unclaimed Property Database.",
    );
    if (!result.ok) {
      return { ok: false, error: "Could not notify intake system." };
    }

    await markIntakeNoMatches(trimmed, "Manual no-match report.");
    return { ok: true, status: 200 };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return { ok: false, error: message };
  }
}
