import "server-only";

import type { Prisma } from "@prisma/client";
import type { SourceRecord } from "@prisma/client";

import { formatAmountDisplay } from "../amounts";
import {
  CA_SCO_ESTATES_SOURCE_KEY,
  CA_SCO_SOURCE_KEY,
  CITY_SD_FINANCE_UNCLAIMED_SOURCE_KEY,
  SD_COUNTY_AUDITOR_UNCLAIMED_SOURCE_KEY,
  SD_COUNTY_TTC_UNCLAIMED_SOURCE_KEY,
} from "../ca-sco-keys";
import {
  CA_SCO_DB_CANDIDATE_LIMIT,
  CA_SCO_FTS_CANDIDATE_LIMIT,
  CA_SCO_MATCH_LIMIT,
} from "../config";
import { prisma } from "../db/client";
import { ftsDiagEnabled, logCaScoFtsDiagnostics } from "../db/fts-diagnostics";
import {
  ensureSourceRecordsFtsTable,
  FTS_COL_OWNER_NORMALIZED,
  ftsNearTokensOnColumn,
  ftsPhraseOnColumn,
  ftsPrefixTokenOnColumn,
  ftsSearchRowIds,
  ftsTokenAndQuery,
  ftsTokenOrQuery,
  ftsTokensAndOnColumn,
  ftsTokensOrOnColumn,
  sourceRecordsFtsIndexReady,
} from "../db/source-records-fts";
import type { NameMatchResult } from "../matching/name-match";
import { normalizeForMatch, scoreNameMatch } from "../matching/name-match";
import {
  isLeadNameVariantWorthBroadSearch,
  leadBusinessSearchNameVariants,
} from "../lead-business-name";
import {
  CA_SCO_ESTATES_SOURCE_LABEL,
  CA_SCO_SOURCE_LABEL,
  CITY_SD_FINANCE_UNCLAIMED_LABEL,
  SD_COUNTY_AUDITOR_UNCLAIMED_LABEL,
  SD_COUNTY_TTC_UNCLAIMED_LABEL,
} from "../normalization";
import { normalizeText } from "../normalizeText";
import type { NormalizedMatch, ScannerQuery } from "../types";

export { CA_SCO_SOURCE_KEY };

function sourceDisplayLabel(sourceKey: string): string {
  if (sourceKey === CA_SCO_SOURCE_KEY) return CA_SCO_SOURCE_LABEL;
  if (sourceKey === CA_SCO_ESTATES_SOURCE_KEY) return CA_SCO_ESTATES_SOURCE_LABEL;
  if (sourceKey === CITY_SD_FINANCE_UNCLAIMED_SOURCE_KEY) {
    return CITY_SD_FINANCE_UNCLAIMED_LABEL;
  }
  if (sourceKey === SD_COUNTY_AUDITOR_UNCLAIMED_SOURCE_KEY) {
    return SD_COUNTY_AUDITOR_UNCLAIMED_LABEL;
  }
  if (sourceKey === SD_COUNTY_TTC_UNCLAIMED_SOURCE_KEY) {
    return SD_COUNTY_TTC_UNCLAIMED_LABEL;
  }
  return sourceKey;
}

const LOG_PREFIX = "[ca-sco-db]";
let warnedFtsIndexEmpty = false;
const MIN_TOKEN_LEN = 2;

/** Legacy-style search tokens: normalized, whitespace-split; drop very short noise tokens when possible. */
export function ownerSearchTokensFromQuery(name: string): string[] {
  const n = normalizeText(name.trim());
  if (!n) return [];
  const parts = n
    .split(" ")
    .map((t) => t.trim())
    .filter(Boolean);
  let tokens = parts.filter((t) => t.length >= MIN_TOKEN_LEN);
  if (tokens.length === 0 && parts.length > 0) {
    tokens = [...parts];
  }
  return tokens.slice(0, 12);
}

export async function hasCaScoImportedRecords(): Promise<boolean> {
  const row = await prisma.sourceRecord.findFirst({
    where: { source: CA_SCO_SOURCE_KEY },
    select: { id: true },
  });
  return row !== null;
}

export async function hasCaScoEstatesImportedRecords(): Promise<boolean> {
  const row = await prisma.sourceRecord.findFirst({
    where: { source: CA_SCO_ESTATES_SOURCE_KEY },
    select: { id: true },
  });
  return row !== null;
}

export async function hasCitySdFinanceUnclaimedImportedRecords(): Promise<boolean> {
  const row = await prisma.sourceRecord.findFirst({
    where: { source: CITY_SD_FINANCE_UNCLAIMED_SOURCE_KEY },
    select: { id: true },
  });
  return row !== null;
}

export async function hasSdCountyAuditorUnclaimedImportedRecords(): Promise<boolean> {
  const row = await prisma.sourceRecord.findFirst({
    where: { source: SD_COUNTY_AUDITOR_UNCLAIMED_SOURCE_KEY },
    select: { id: true },
  });
  return row !== null;
}

export async function hasSdCountyTtcUnclaimedImportedRecords(): Promise<boolean> {
  const row = await prisma.sourceRecord.findFirst({
    where: { source: SD_COUNTY_TTC_UNCLAIMED_SOURCE_KEY },
    select: { id: true },
  });
  return row !== null;
}

function buildDbReportedAddress(r: SourceRecord): string {
  const line = [r.address, r.city, r.state, r.zipCode]
    .map((x) => (x ?? "").trim())
    .filter(Boolean)
    .join(", ")
    .trim();
  return line || "—";
}

/**
 * Mirrors CSV runtime location filters using structured DB columns.
 */
function dbRecordPassesLocationFilters(
  query: ScannerQuery,
  r: SourceRecord,
  reportedAddressFull: string,
): { ok: boolean; notes: string[] } {
  const notes: string[] = [];

  const qCity = query.city?.trim();
  if (qCity) {
    const rc = (r.city ?? "").trim();
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
  if (qState) {
    const rs = (r.state ?? "").trim().toUpperCase();
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
    const addr = normalizeForMatch(reportedAddressFull);
    if (h && !addr.includes(h)) {
      return { ok: false, notes: [] };
    }
    notes.push("Address hint matched row text");
  }

  return { ok: true, notes };
}

function dedupeKey(parts: Omit<NormalizedMatch, "id">): string {
  return [
    parts.sourceName,
    parts.propertyId,
    normalizeForMatch(parts.reportedOwnerName),
    parts.amount,
    normalizeForMatch(parts.reportedAddress),
    normalizeForMatch(parts.holderName),
    parts.sourceRecordId != null ? String(parts.sourceRecordId) : "",
  ].join("|");
}

function sourceRecordToNormalized(
  r: SourceRecord,
  nm: NameMatchResult,
  locNotes: string[],
  backendNote: string,
): Omit<NormalizedMatch, "id"> {
  const reportedAddress = buildDbReportedAddress(r);
  return {
    sourceName: sourceDisplayLabel(r.source),
    reportedOwnerName: r.ownerName,
    holderName: r.holderName.trim() ? r.holderName : "—",
    propertyId: r.propertyId.trim() ? r.propertyId : "—",
    amount: formatAmountDisplay(r.amount ?? ""),
    reportedAddress,
    confidence: nm.confidence,
    notes: [...nm.reasons, ...locNotes, backendNote].join("; "),
    sourceRecordId: r.id,
    nameMatchScore: nm.score,
    propertyType: r.propertyType ?? null,
  };
}

function scoreCandidateRows(
  query: ScannerQuery,
  orderedCandidates: SourceRecord[],
  backendNote: string,
  scoreNameBySourceRecordId?: Map<number, string>,
): Omit<NormalizedMatch, "id">[] {
  const out: Omit<NormalizedMatch, "id">[] = [];
  const seen = new Set<string>();

  for (const r of orderedCandidates) {
    const ownerLine = r.ownerName.trim();
    if (!ownerLine) continue;

    const scoreName = scoreNameBySourceRecordId?.get(r.id) ?? query.name;
    const nm = scoreNameMatch(scoreName, ownerLine);
    if (nm.confidence === "unlikely") continue;

    const reportedFull = buildDbReportedAddress(r);
    const loc = dbRecordPassesLocationFilters(query, r, reportedFull);
    if (!loc.ok) continue;

    const variantNotes =
      scoreName !== query.name ? [...loc.notes, `Search variant matched: ${scoreName}`] : loc.notes;
    const normalized = sourceRecordToNormalized(r, nm, variantNotes, backendNote);
    const key = dedupeKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);

    out.push(normalized);
    if (out.length >= CA_SCO_MATCH_LIMIT) break;
  }

  return out;
}

/** Wide LIKE / token-AND path when FTS table is missing or unsupported. */
async function searchCaScoFromDatabasePrismaFallback(
  query: ScannerQuery,
  tokens: string[],
  sourceKeys: readonly string[],
): Promise<Omit<NormalizedMatch, "id">[]> {
  const tTotal = Date.now();
  const tokenAnd: Prisma.SourceRecordWhereInput[] = tokens.map((token) => ({
    ownerNameNormalized: { contains: token },
  }));

  const fullNorm = normalizeText(query.name.trim());
  const usePrefixOnly =
    fullNorm.length >= MIN_TOKEN_LEN && !fullNorm.includes(" ");

  const fallbackCap = Math.min(300, CA_SCO_DB_CANDIDATE_LIMIT);

  const sourceFilter = { in: [...sourceKeys] as string[] };

  const where: Prisma.SourceRecordWhereInput = usePrefixOnly
    ? {
        source: sourceFilter,
        ownerNameNormalized: { startsWith: fullNorm },
      }
    : {
        source: sourceFilter,
        AND: tokenAnd,
      };

  console.log(
    `${LOG_PREFIX} Prisma fallback — sources=[${sourceKeys.join(", ")}] — ${usePrefixOnly ? `startsWith("${fullNorm}")` : `token AND (${tokens.length}): ${tokens.join(", ")}`}; cap ${fallbackCap}`,
  );

  const tFetch = Date.now();
  const candidates = await prisma.sourceRecord.findMany({
    where,
    take: fallbackCap,
    orderBy: { id: "asc" },
  });
  const fetchMs = Date.now() - tFetch;
  console.log(
    `${LOG_PREFIX} Prisma fallback candidate count: ${candidates.length}; fetch elapsed: ${(fetchMs / 1000).toFixed(2)}s`,
  );

  const tJs = Date.now();
  const out = scoreCandidateRows(
    query,
    candidates,
    "SQLite source_records (Prisma fallback)",
  );
  const jsMs = Date.now() - tJs;
  console.log(
    `${LOG_PREFIX} JS scoring elapsed: ${(jsMs / 1000).toFixed(2)}s`,
  );
  console.log(
    `${LOG_PREFIX} Total search elapsed: ${((Date.now() - tTotal) / 1000).toFixed(2)}s; matches: ${out.length}`,
  );

  return out;
}

/**
 * SQLite search for one or more `source_records.source` keys (FTS + shared scoring).
 */
export async function searchSourceRecordsFromDatabase(
  query: ScannerQuery,
  sourceKeys: readonly string[],
): Promise<Omit<NormalizedMatch, "id">[]> {
  if (sourceKeys.length === 0) return [];

  const tTotal = Date.now();
  const tokens = ownerSearchTokensFromQuery(query.name);

  if (tokens.length === 0) {
    console.log(
      `${LOG_PREFIX} No searchable tokens after normalize — returning 0 matches`,
    );
    return [];
  }

  await ensureSourceRecordsFtsTable(prisma);
  const ftsReady = await sourceRecordsFtsIndexReady(prisma);
  if (ftsDiagEnabled()) {
    await logCaScoFtsDiagnostics(prisma);
  }
  if (!ftsReady) {
    if (!warnedFtsIndexEmpty) {
      warnedFtsIndexEmpty = true;
      console.warn(
        `${LOG_PREFIX} FTS index empty (table created but not rebuilt) — Prisma fallback; populate with: npm run db:fts-rebuild, npm run import:ca-sco, or npm run import:ca-sco-estates`,
      );
    }
    return searchCaScoFromDatabasePrismaFallback(query, tokens, sourceKeys);
  }

  const fullNorm = normalizeText(query.name.trim());
  const cap = CA_SCO_FTS_CANDIDATE_LIMIT;

  const tFts = Date.now();
  const orderedIds: number[] = [];
  const seen = new Set<number>();
  const scoreNameById = new Map<number, string>();

  const pushIds = async (ids: number[], scoreName?: string) => {
    for (const id of ids) {
      if (orderedIds.length >= cap) return;
      if (seen.has(id)) {
        if (scoreName && !scoreNameById.has(id)) scoreNameById.set(id, scoreName);
        continue;
      }
      seen.add(id);
      if (scoreName) scoreNameById.set(id, scoreName);
      orderedIds.push(id);
    }
  };

  const ftsPhase = async (
    label: string,
    expr: string,
    sqlLimit: number,
    scoreName?: string,
  ) => {
    if (!expr.trim() || sqlLimit <= 0) return;
    console.log(`${LOG_PREFIX} FTS MATCH [${label}]: ${expr}`);
    await pushIds(await ftsSearchRowIds(prisma, expr, sqlLimit, sourceKeys), scoreName);
  };

  const phraseLimit = Math.min(120, cap);
  if (fullNorm.includes(" ")) {
    await ftsPhase(
      "phrase-adjacent-owner_norm",
      ftsPhraseOnColumn(FTS_COL_OWNER_NORMALIZED, fullNorm),
      phraseLimit,
    );
  } else if (fullNorm.length >= MIN_TOKEN_LEN) {
    await ftsPhase(
      "phrase-single-owner_norm",
      ftsPhraseOnColumn(FTS_COL_OWNER_NORMALIZED, fullNorm),
      Math.min(80, cap),
    );
    if (orderedIds.length < cap) {
      await ftsPhase(
        "prefix-owner_norm",
        ftsPrefixTokenOnColumn(FTS_COL_OWNER_NORMALIZED, fullNorm),
        Math.min(100, cap),
      );
    }
  }

  if (tokens.length >= 2 && orderedIds.length < cap) {
    const nearGap = Math.min(100, Math.max(14, tokens.length * 12));
    await ftsPhase(
      "near-owner_norm",
      ftsNearTokensOnColumn(FTS_COL_OWNER_NORMALIZED, tokens, nearGap),
      Math.min(160, cap),
    );
  }

  if (orderedIds.length < cap) {
    await ftsPhase(
      "owner_norm-token-and",
      ftsTokensAndOnColumn(FTS_COL_OWNER_NORMALIZED, tokens),
      Math.min(280, cap),
    );
  }

  if (orderedIds.length < cap) {
    const broadBudget = Math.min(cap * 3, 900);
    await ftsPhase(
      "global-token-and",
      ftsTokenAndQuery(tokens),
      broadBudget,
    );
  }

  const allowBroadOrFallback =
    !sourceKeys.includes(CA_SCO_SOURCE_KEY) && tokens.every((t) => t.length >= 4);

  if (orderedIds.length === 0 && allowBroadOrFallback) {
    await ftsPhase(
      "owner_norm-token-or",
      ftsTokensOrOnColumn(FTS_COL_OWNER_NORMALIZED, tokens),
      Math.min(350, Math.max(cap, 300)),
    );
  }

  if (orderedIds.length === 0 && allowBroadOrFallback) {
    await ftsPhase(
      "global-token-or",
      ftsTokenOrQuery(tokens),
      Math.min(350, Math.max(cap, 300)),
    );
  }

  if (orderedIds.length < Math.min(80, cap) && tokens.length >= 3) {
    const variants = leadBusinessSearchNameVariants({
      businessName: query.name,
      city: query.city,
      state: query.state,
    }).filter((name) => normalizeText(name) !== fullNorm);

    for (const variant of variants) {
      if (orderedIds.length >= cap) break;
      if (!isLeadNameVariantWorthBroadSearch(variant)) continue;
      const variantTokens = ownerSearchTokensFromQuery(variant);
      if (variantTokens.length === 0) continue;
      await ftsPhase(
        `business-variant:${variant}`,
        ftsTokensAndOnColumn(FTS_COL_OWNER_NORMALIZED, variantTokens),
        Math.min(160, cap),
        variant,
      );
    }
  }

  const ftsMs = Date.now() - tFts;
  console.log(
    `${LOG_PREFIX} FTS query elapsed: ${(ftsMs / 1000).toFixed(2)}s; candidate count: ${orderedIds.length}`,
  );

  if (orderedIds.length === 0) {
    console.log(`${LOG_PREFIX} FTS returned 0 rowids — total elapsed: ${((Date.now() - tTotal) / 1000).toFixed(2)}s`);
    return [];
  }

  const tJs = Date.now();
  const records = await prisma.sourceRecord.findMany({
    where: {
      id: { in: orderedIds },
      source: { in: [...sourceKeys] as string[] },
    },
  });
  const rowById = new Map(records.map((r) => [r.id, r]));
  const orderedCandidates = orderedIds
    .map((id) => rowById.get(id))
    .filter((r): r is SourceRecord => r != null);

  const out = scoreCandidateRows(
    query,
    orderedCandidates,
    "SQLite source_records (FTS)",
    scoreNameById,
  );
  const jsMs = Date.now() - tJs;
  console.log(
    `${LOG_PREFIX} JS scoring elapsed: ${(jsMs / 1000).toFixed(2)}s`,
  );
  console.log(
    `${LOG_PREFIX} Total search elapsed: ${((Date.now() - tTotal) / 1000).toFixed(2)}s; matches: ${out.length}`,
  );

  return out;
}

/** Primary CA SCO bulk catalog only (`ca_sco`). */
export async function searchCaScoFromDatabase(
  query: ScannerQuery,
): Promise<Omit<NormalizedMatch, "id">[]> {
  return searchSourceRecordsFromDatabase(query, [CA_SCO_SOURCE_KEY]);
}
