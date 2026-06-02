/**
 * Name matching for CA SCO owner lines (person or business).
 * Heuristic scoring — tune against legacy CLCC behavior when that repo is available.
 */

import { normalizeText } from "../normalizeText";

export type NameMatchResult = {
  /** 0–1 overall similarity */
  score: number;
  /** Aligns with claims-intake-system scan confidence vocabulary */
  confidence: "unlikely" | "possible" | "likely" | "high";
  /** Human-readable reasons appended to scan notes */
  reasons: string[];
};

export function normalizeForMatch(name: string): string {
  return normalizeText(name);
}

export function tokenize(name: string): string[] {
  return normalizeText(name)
    .split(" ")
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Jaccard similarity on token sets */
function tokenJaccard(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Ordered token sequence containment bonus */
function consecutiveOverlapRatio(query: string[], owner: string[]): number {
  if (query.length === 0 || owner.length === 0) return 0;
  let hits = 0;
  let qi = 0;
  for (const tok of owner) {
    if (qi < query.length && tok === query[qi]) {
      hits++;
      qi++;
    }
  }
  return hits / query.length;
}

const ENTITY_SUFFIX =
  /\b(inc|incorporated|llc|l\.l\.c\.|corp|corporation|co|company|lp|llp|plc|ltd|limited|trust|assoc|association|aplc|apc|pc)\b\.?$/i;

function stripTrailingEntityTokens(tokens: string[]): string[] {
  while (tokens.length > 0 && ENTITY_SUFFIX.test(tokens[tokens.length - 1]!)) {
    tokens.pop();
  }
  return tokens;
}

export function scoreNameMatch(query: string, ownerLine: string): NameMatchResult {
  const reasons: string[] = [];
  const qRaw = query.trim();
  const oRaw = ownerLine.trim();
  if (!qRaw || !oRaw) {
    return { score: 0, confidence: "unlikely", reasons: ["Missing name text"] };
  }

  const qNorm = normalizeText(qRaw);
  const oNorm = normalizeText(oRaw);

  if (qNorm === oNorm) {
    return {
      score: 1,
      confidence: "high",
      reasons: ["Exact normalized owner match"],
    };
  }

  if (oNorm.includes(qNorm) || qNorm.includes(oNorm)) {
    reasons.push("Substring match on normalized names");
  }

  let qTok = tokenize(qRaw);
  let oTok = tokenize(oRaw);
  if (qTok.length >= 2) qTok = stripTrailingEntityTokens([...qTok]);
  if (oTok.length >= 2) oTok = stripTrailingEntityTokens([...oTok]);

  const jac = tokenJaccard(qTok, oTok);
  const seq = consecutiveOverlapRatio(qTok, oTok);
  let score = Math.max(jac * 0.85 + seq * 0.15, jac);

  if (oNorm.includes(qNorm) || qNorm.includes(oNorm)) {
    score = Math.max(score, 0.82);
  }

  /** Minimum score to surface as a candidate row */
  const MIN_SCORE = 0.42;
  if (score < MIN_SCORE) {
    return {
      score,
      confidence: "unlikely",
      reasons: ["Below CA SCO name match threshold"],
    };
  }

  if (jac >= 0.55) reasons.push("Strong token overlap with search name");
  else if (jac >= 0.35) reasons.push("Partial token overlap with search name");
  else reasons.push("Looser text match; verify owner carefully");

  let confidence: NameMatchResult["confidence"];
  if (score >= 0.92) confidence = "likely";
  else if (score >= 0.72) confidence = "possible";
  else confidence = "possible";

  return { score, confidence, reasons };
}
