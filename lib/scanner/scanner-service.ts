import "server-only";

import {
  CA_SCO_MATCH_LIMIT,
  caScoForceCsvFallback,
} from "./config";
import {
  CA_SCO_ESTATES_SOURCE_KEY,
  CA_SCO_SOURCE_KEY,
  CITY_SD_FINANCE_UNCLAIMED_SOURCE_KEY,
  SD_COUNTY_AUDITOR_UNCLAIMED_SOURCE_KEY,
  SD_COUNTY_TTC_UNCLAIMED_SOURCE_KEY,
} from "./ca-sco-keys";
import { normalizeForMatch } from "./matching/name-match";
import {
  hasCaScoEstatesImportedRecords,
  hasCaScoImportedRecords,
  hasCitySdFinanceUnclaimedImportedRecords,
  hasSdCountyAuditorUnclaimedImportedRecords,
  hasSdCountyTtcUnclaimedImportedRecords,
  searchSourceRecordsFromDatabase,
} from "./sources/ca-sco-db";
import { searchCaScoCsvFallback } from "./sources/ca-sco";
import {
  CA_SCO_ESTATES_SOURCE_LABEL,
  CITY_SD_FINANCE_UNCLAIMED_LABEL,
  normalizeScannerMatch,
  SD_COUNTY_AUDITOR_UNCLAIMED_LABEL,
  SD_COUNTY_TTC_UNCLAIMED_LABEL,
} from "./normalization";
import type {
  IntakeScanResultPayload,
  NormalizedMatch,
  ScannerQuery,
} from "./types";

export { normalizeScannerMatch };

function scannerMatchIdPrefix(sourceName: string): string {
  if (sourceName === CA_SCO_ESTATES_SOURCE_LABEL) return "ca-sco-estates";
  if (sourceName === CITY_SD_FINANCE_UNCLAIMED_LABEL) {
    return "city-sd-unclaimed";
  }
  if (sourceName === SD_COUNTY_AUDITOR_UNCLAIMED_LABEL) {
    return "sd-county-auditor";
  }
  if (sourceName === SD_COUNTY_TTC_UNCLAIMED_LABEL) {
    return "sd-county-ttc";
  }
  return "ca-sco";
}

const CONF_RANK: Record<string, number> = {
  high: 3,
  likely: 2,
  possible: 1,
  unlikely: 0,
};

/** Merge primary + supplemental DB hits; cap at {@link CA_SCO_MATCH_LIMIT}. */
function mergeUnifiedScannerMatches(
  rows: Omit<NormalizedMatch, "id">[],
): Omit<NormalizedMatch, "id">[] {
  const sorted = [...rows].sort((a, b) => {
    const rb = CONF_RANK[b.confidence] ?? 0;
    const ra = CONF_RANK[a.confidence] ?? 0;
    if (rb !== ra) return rb - ra;
    return (a.reportedOwnerName || "").localeCompare(b.reportedOwnerName || "");
  });
  const seen = new Set<string>();
  const out: Omit<NormalizedMatch, "id">[] = [];
  for (const m of sorted) {
    const key = [
      m.sourceName,
      m.propertyId,
      normalizeForMatch(m.reportedOwnerName),
      m.amount,
      normalizeForMatch(m.reportedAddress),
      normalizeForMatch(m.holderName),
      m.sourceRecordId != null ? String(m.sourceRecordId) : "",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
    if (out.length >= CA_SCO_MATCH_LIMIT) break;
  }
  return out;
}

function claimsIntakeBaseUrl(): string {
  return process.env.CLAIMS_INTAKE_BASE_URL?.trim() || "http://localhost:3000";
}

function claimsIntakeAuthHeaders(): Record<string, string> {
  const explicit = process.env.CLAIMS_INTAKE_BASIC_AUTH?.trim();
  if (explicit) {
    return {
      Authorization: explicit.startsWith("Basic ") ? explicit : `Basic ${explicit}`,
    };
  }

  const username =
    process.env.CLAIMS_INTAKE_USERNAME?.trim() ||
    process.env.CMS_ADMIN_USERNAME?.trim();
  const password =
    process.env.CLAIMS_INTAKE_PASSWORD?.trim() ||
    process.env.CMS_ADMIN_PASSWORD?.trim();
  if (!username || !password) return {};

  return {
    Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
  };
}

/**
 * Tell claims-intake-system that a scanner run finished (including zero matches).
 * Failures are non-fatal for the scanner UI; callers show a warning.
 */
export async function notifyIntakeScanRun(
  intakeId: string,
  matchCount: number,
  notes?: string,
): Promise<{ ok: boolean }> {
  const trimmed = intakeId.trim();
  if (!trimmed) return { ok: false };

  const base = claimsIntakeBaseUrl().replace(/\/$/, "");
  const url = `${base}/api/intakes/${encodeURIComponent(trimmed)}/scan-run`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...claimsIntakeAuthHeaders(),
      },
      body: JSON.stringify({
        source: "ccc-scanner-engine",
        matchCount,
        notes: notes ?? "",
      }),
    });

    if (!res.ok) {
      console.warn(
        `[intake-notify] scan-run failed (${res.status}) for intake ${trimmed}`,
      );
      return { ok: false };
    }

    return { ok: true };
  } catch (e) {
    console.warn(`[intake-notify] scan-run error for intake ${trimmed}:`, e);
    return { ok: false };
  }
}

/**
 * Scanner entry point — CA SCO via SQLite `source_records` when imported data exists,
 * otherwise CSV stream fallback.
 *
 * TODO: County/city supplemental sources (non-SCO rolls).
 * TODO: Michigan and additional state bulk mirrors.
 * TODO: Cross-source dedupe when multiple files are wired in.
 * TODO: Background scan jobs + incremental indexing for large datasets.
 */
export async function runScanner(query: ScannerQuery): Promise<NormalizedMatch[]> {
  const t0 = Date.now();
  let usedCsvFallback = false;
  const chunks: Omit<NormalizedMatch, "id">[] = [];
  const sourceKeys: string[] = [];

  if (caScoForceCsvFallback()) {
    usedCsvFallback = true;
    console.log(
      "[scanner] CA_SCO_FORCE_CSV_FALLBACK — streaming California SCO CSV",
    );
    chunks.push(...(await searchCaScoCsvFallback(query)));
  } else {
    const hasImported = await hasCaScoImportedRecords();
    if (!hasImported) {
      usedCsvFallback = true;
      console.log(
        "[scanner] No source_records for ca_sco — CSV stream for California SCO",
      );
      chunks.push(...(await searchCaScoCsvFallback(query)));
    } else {
      console.log("[scanner] California SCO — SQLite source_records (FTS)");
      sourceKeys.push(CA_SCO_SOURCE_KEY);
    }
  }

  if (await hasCaScoEstatesImportedRecords()) {
    console.log("[scanner] California SCO Estates — SQLite source_records (FTS)");
    sourceKeys.push(CA_SCO_ESTATES_SOURCE_KEY);
  }

  if (await hasCitySdFinanceUnclaimedImportedRecords()) {
    console.log(
      "[scanner] City of San Diego Unclaimed Monies — SQLite source_records (FTS)",
    );
    sourceKeys.push(CITY_SD_FINANCE_UNCLAIMED_SOURCE_KEY);
  }

  if (await hasSdCountyAuditorUnclaimedImportedRecords()) {
    console.log(
      "[scanner] San Diego County Auditor & Controller — SQLite source_records (FTS)",
    );
    sourceKeys.push(SD_COUNTY_AUDITOR_UNCLAIMED_SOURCE_KEY);
  }

  if (await hasSdCountyTtcUnclaimedImportedRecords()) {
    console.log(
      "[scanner] San Diego County Treasurer-Tax Collector — SQLite source_records (FTS)",
    );
    sourceKeys.push(SD_COUNTY_TTC_UNCLAIMED_SOURCE_KEY);
  }

  if (sourceKeys.length > 0) {
    console.log(
      `[scanner] Unified SQLite indexed search - sources=[${sourceKeys.join(", ")}]`,
    );
    chunks.push(...(await searchSourceRecordsFromDatabase(query, sourceKeys)));
  }

  const rows = mergeUnifiedScannerMatches(chunks);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(
    `[scanner] runScanner complete — csvFallback=${usedCsvFallback}, matches=${rows.length}, elapsed=${elapsed}s`,
  );

  const slug =
    query.name
      .trim()
      .replace(/[^\w.-]+/g, "_")
      .slice(0, 48) || "scan";
  return rows.map((r, i) => ({
    ...r,
    id: `${scannerMatchIdPrefix(r.sourceName)}-${slug}-${i}`,
  }));
}

/**
 * POSTs selected normalized matches to the claims-intake-system API.
 */
export async function sendMatchesToIntake(
  intakeId: string,
  matches: IntakeScanResultPayload[],
): Promise<Response> {
  const base = claimsIntakeBaseUrl().replace(/\/$/, "");
  const url = `${base}/api/intakes/${encodeURIComponent(intakeId)}/scan-results`;

  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...claimsIntakeAuthHeaders(),
    },
    body: JSON.stringify({ matches }),
  });
}

export function matchToPayload(m: NormalizedMatch): IntakeScanResultPayload {
  return {
    sourceName: m.sourceName,
    reportedOwnerName: m.reportedOwnerName,
    holderName: m.holderName,
    propertyId: m.propertyId,
    amount: m.amount,
    reportedAddress: m.reportedAddress,
    propertyType: m.propertyType ?? null,
    accountType: m.propertyType ?? null,
    confidence: m.confidence,
    notes: m.notes,
  };
}
