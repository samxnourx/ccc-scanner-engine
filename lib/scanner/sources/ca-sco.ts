import "server-only";

import { access, constants, stat } from "fs/promises";
import { createReadStream } from "fs";
import { parse } from "csv-parse";

import {
  CA_SCO_DATA_PATH,
  CA_SCO_MATCH_LIMIT,
  CA_SCO_MAX_ROWS,
  CA_SCO_SAMPLE_PATH,
} from "../config";
import { normalizeForMatch, scoreNameMatch } from "../matching/name-match";
import {
  buildCaScoMatchParts,
  buildReportedAddress,
  caScoPartsToNormalized,
  getOwnerLine,
  resolveCaScoColumns,
  type CaScoColumnMap,
} from "../normalization";
import type { NormalizedMatch, ScannerQuery } from "../types";

const ROW_PROGRESS_INTERVAL = 100_000;
const GB = 1024 ** 3;

function coerceRow(row: unknown): Record<string, string> {
  const o = row as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) {
    out[k] = v === null || v === undefined ? "" : String(v);
  }
  return out;
}

function formatSizeGb(bytes: number): string {
  return `${(bytes / GB).toFixed(4)} GB`;
}

async function resolveCsvPathWithLogging(): Promise<string | null> {
  console.log(`[ca-sco] Resolved CA_SCO_DATA_PATH: ${CA_SCO_DATA_PATH}`);

  try {
    await access(CA_SCO_DATA_PATH, constants.R_OK);
    const st = await stat(CA_SCO_DATA_PATH);
    console.log(
      `[ca-sco] Primary file exists: yes — size ${formatSizeGb(st.size)} (${st.size.toLocaleString()} bytes)`,
    );
    return CA_SCO_DATA_PATH;
  } catch {
    console.warn(
      `[ca-sco] Primary file missing or unreadable; path: ${CA_SCO_DATA_PATH}`,
    );
  }

  console.log(`[ca-sco] Falling back to sample CSV: ${CA_SCO_SAMPLE_PATH}`);

  try {
    await access(CA_SCO_SAMPLE_PATH, constants.R_OK);
    const st = await stat(CA_SCO_SAMPLE_PATH);
    console.log(
      `[ca-sco] Sample file exists: yes — size ${formatSizeGb(st.size)} (${st.size.toLocaleString()} bytes)`,
    );
    return CA_SCO_SAMPLE_PATH;
  } catch {
    console.error(
      `[ca-sco] Sample file missing or unreadable; path: ${CA_SCO_SAMPLE_PATH}`,
    );
    return null;
  }
}

function rowPassesLocationFilters(
  query: ScannerQuery,
  row: Record<string, string>,
  cols: CaScoColumnMap,
  reportedAddress: string,
): { ok: boolean; notes: string[] } {
  const notes: string[] = [];

  const qCity = query.city?.trim();
  if (qCity && cols.city) {
    const rc = (row[cols.city] ?? "").trim();
    if (!rc) {
      notes.push("City filter skipped (row missing city)");
    } else {
      const a = normalizeForMatch(qCity);
      const b = normalizeForMatch(rc);
      if (a !== b && !b.includes(a) && !a.includes(b)) {
        return { ok: false, notes: [] };
      }
      notes.push("City aligns with optional filter");
    }
  }

  const qState = query.state?.trim();
  if (qState && cols.state) {
    const rs = (row[cols.state] ?? "").trim().toUpperCase();
    if (rs) {
      const qs = qState.toUpperCase();
      const q2 = qs.length >= 2 ? qs.slice(0, 2) : qs;
      if (!rs.startsWith(q2) && !rs.includes(q2)) {
        return { ok: false, notes: [] };
      }
      notes.push("State aligns with optional filter");
    }
  }

  const hint = query.addressHint?.trim();
  if (hint) {
    const h = normalizeForMatch(hint);
    const addr = normalizeForMatch(reportedAddress);
    if (h && !addr.includes(h)) {
      return { ok: false, notes: [] };
    }
    notes.push("Address hint matched row text");
  }

  return { ok: true, notes };
}

function dedupeKey(parts: Omit<NormalizedMatch, "id">): string {
  return [
    parts.propertyId,
    normalizeForMatch(parts.reportedOwnerName),
    parts.amount,
    normalizeForMatch(parts.reportedAddress),
    normalizeForMatch(parts.holderName),
  ].join("|");
}

/**
 * Stream-search the CA SCO bulk CSV for owner-name matches.
 *
 * TODO: County/city supplemental sources (non-SCO local rolls).
 * TODO: Michigan (and other states) bulk files — mirror this module pattern per jurisdiction.
 * TODO: Dedupe across multiple upstream files / sources (not just within one CSV).
 * TODO: Background scan jobs + incremental indexing when CSVs move to a database.
 * TODO: Database migration — load UPD CSV into queryable store instead of full scans.
 */
/** CSV stream scanner — fallback when DB has no `ca_sco` imports or force-flag is set. */
export async function searchCaScoCsvFallback(
  query: ScannerQuery,
): Promise<Omit<NormalizedMatch, "id">[]> {
  const csvPath = await resolveCsvPathWithLogging();
  if (!csvPath) {
    console.log(`[ca-sco] No readable CSV; returning 0 matches`);
    return [];
  }

  if (CA_SCO_MAX_ROWS !== undefined) {
    console.log(
      `[ca-sco] CA_SCO_MAX_ROWS active — will stop after ${CA_SCO_MAX_ROWS.toLocaleString()} data rows`,
    );
  } else {
    console.log(`[ca-sco] CA_SCO_MAX_ROWS unset — scanning entire stream`);
  }

  const t0 = Date.now();
  console.log(`[ca-sco] Streaming started — file: ${csvPath}`);

  const parser = createReadStream(csvPath).pipe(
    parse({
      columns: true,
      trim: true,
      bom: true,
      relax_column_count: true,
      skip_records_with_error: true,
    }),
  );

  let cols: CaScoColumnMap | null = null;
  const out: Omit<NormalizedMatch, "id">[] = [];
  const seen = new Set<string>();
  let rowCount = 0;
  let abortedEarly = false;
  let stopReason = "iterator exhausted (full stream read)";

  try {
    for await (const raw of parser) {
      rowCount++;

      if (
        CA_SCO_MAX_ROWS !== undefined &&
        rowCount > CA_SCO_MAX_ROWS
      ) {
        rowCount--;
        abortedEarly = true;
        stopReason = `CA_SCO_MAX_ROWS (${CA_SCO_MAX_ROWS.toLocaleString()})`;
        console.log(
          `[ca-sco] Stopping: ${stopReason} — processed ${rowCount.toLocaleString()} rows; candidate matches so far: ${out.length}`,
        );
        break;
      }

      if (rowCount % ROW_PROGRESS_INTERVAL === 0) {
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        console.log(
          `[ca-sco] Progress — rows scanned: ${rowCount.toLocaleString()}, candidate matches: ${out.length}, elapsed: ${elapsed}s`,
        );
      }

      const row = coerceRow(raw);
      if (!cols) {
        cols = resolveCaScoColumns(Object.keys(row));
      }

      const ownerLine = getOwnerLine(row, cols);
      if (!ownerLine) continue;

      const nm = scoreNameMatch(query.name, ownerLine);
      if (nm.confidence === "unlikely") continue;

      const fullAddress = buildReportedAddress(row, cols);

      const loc = rowPassesLocationFilters(query, row, cols, fullAddress);
      if (!loc.ok) continue;

      const parts = buildCaScoMatchParts(
        row,
        cols,
        ownerLine,
        [...nm.reasons, ...loc.notes],
        nm.confidence,
      );
      const normalized = caScoPartsToNormalized(parts);
      const key = dedupeKey(normalized);
      if (seen.has(key)) continue;
      seen.add(key);

      out.push(normalized);
      if (out.length >= CA_SCO_MATCH_LIMIT) {
        abortedEarly = true;
        stopReason = `CA_SCO_MATCH_LIMIT (${CA_SCO_MATCH_LIMIT})`;
        console.log(
          `[ca-sco] Stopping: ${stopReason} — rows scanned: ${rowCount.toLocaleString()}, matches: ${out.length}`,
        );
        break;
      }
    }
  } catch (err) {
    abortedEarly = true;
    stopReason = "stream error";
    console.error(`[ca-sco] Stream error after ${rowCount.toLocaleString()} rows:`, err);
    throw err;
  } finally {
    const elapsedSec = ((Date.now() - t0) / 1000).toFixed(2);
    const streamComplete = !abortedEarly;
    console.log(
      `[ca-sco] Stream ended — reason: ${stopReason}; iteratorComplete: ${streamComplete}; total rows scanned: ${rowCount.toLocaleString()}; total matches returned: ${out.length}; elapsed: ${elapsedSec}s`,
    );
  }

  return out;
}
