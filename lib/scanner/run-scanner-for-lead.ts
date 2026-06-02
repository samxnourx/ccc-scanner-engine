import "server-only";

import { CA_SCO_MATCH_LIMIT } from "./config";
import { normalizeForMatch } from "./matching/name-match";
import { runScanner } from "./scanner-service";
import {
  isLeadNameVariantWorthBroadSearch,
  leadBusinessSearchNameVariants,
} from "./lead-business-name";
import type { NormalizedMatch, ScannerQuery } from "./types";

const CONF_RANK: Record<string, number> = {
  high: 3,
  likely: 2,
  possible: 1,
  unlikely: 0,
};

function mergeKey(m: NormalizedMatch): string {
  return [
    m.sourceName,
    m.propertyId,
    normalizeForMatch(m.reportedOwnerName),
    m.amount,
    normalizeForMatch(m.reportedAddress),
    normalizeForMatch(m.holderName),
    m.sourceRecordId != null ? String(m.sourceRecordId) : "",
  ].join("|");
}

function hasEnoughTokensForExactBroadRetry(name: string): boolean {
  return normalizeForMatch(name).split(/\s+/).filter(Boolean).length >= 2;
}

/**
 * Runs the unified scanner for a business name plus common lead-import variants
 * such as legal suffix and trailing location removal. Merges and de-duplicates candidates.
 */
export async function runScannerForLeadBusiness(input: {
  businessName: string;
  city?: string | null;
  state?: string | null;
  addressHint?: string | null;
}): Promise<NormalizedMatch[]> {
  const base: Omit<ScannerQuery, "name"> = {
    city: input.city?.trim() || undefined,
    state: input.state?.trim() || undefined,
    addressHint: input.addressHint?.trim() || undefined,
  };

  const full = input.businessName.trim();
  if (!full) return [];

  const nameVariants = leadBusinessSearchNameVariants({
    businessName: full,
    city: input.city,
    state: input.state,
  });

  const merged: NormalizedMatch[] = [];
  const scanPasses: { name: string; scanBase: Partial<ScannerQuery>; note: string }[] = [
    { name: full, scanBase: base, note: "" },
    ...nameVariants.map((name) => ({
      name,
      scanBase: {},
      note: name === full ? "Lead business broad name-only retry" : "",
    })),
  ];
  const seenPasses = new Set<string>();

  for (const pass of scanPasses) {
    const name = pass.name.trim();
    const isStrictPass = pass.scanBase.city || pass.scanBase.state || pass.scanBase.addressHint;
    const isExactImportedName = name === full;
    if (
      !isStrictPass &&
      !isLeadNameVariantWorthBroadSearch(name) &&
      !(isExactImportedName && hasEnoughTokensForExactBroadRetry(name))
    ) {
      continue;
    }
    const key = [
      name.toLowerCase(),
      pass.scanBase.city ?? "",
      pass.scanBase.state ?? "",
      pass.scanBase.addressHint ?? "",
    ].join("|");
    if (!name || seenPasses.has(key)) continue;
    seenPasses.add(key);
    const hits = await runScanner({ ...pass.scanBase, name });
    merged.push(
      ...hits.map((m) => ({
        ...m,
        notes:
          name === full
            ? pass.note
              ? `${m.notes}; ${pass.note}`
              : m.notes
            : `${m.notes}; Lead business variant searched: ${name}`,
      })),
    );
    if (merged.length >= CA_SCO_MATCH_LIMIT) break;
  }

  const byKey = new Map<string, NormalizedMatch>();
  for (const m of merged) {
    const key = mergeKey(m);
    const prev = byKey.get(key);
    const score = m.nameMatchScore ?? 0;
    if (!prev || (prev.nameMatchScore ?? 0) < score) {
      byKey.set(key, m);
    }
  }

  const deduped = [...byKey.values()].sort((a, b) => {
    const rb = CONF_RANK[b.confidence] ?? 0;
    const ra = CONF_RANK[a.confidence] ?? 0;
    if (rb !== ra) return rb - ra;
    return (b.nameMatchScore ?? 0) - (a.nameMatchScore ?? 0);
  });

  return deduped.slice(0, CA_SCO_MATCH_LIMIT);
}
