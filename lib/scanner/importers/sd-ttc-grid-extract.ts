/**
 * SD TTC AEM pages embed DataTables data via JSON.stringify([...]).
 * Ported from clcc-watch/app/importers/sd_ttc_grid_extract.py
 */

export const JSON_STRINGIFY_MARKER = "JSON.stringify(";

/** Parse a JSON array starting at bracket_start === '[' (handles strings/escapes). */
export function parseJsonArrayAt(
  html: string,
  bracketStart: number,
): unknown[] | null {
  if (bracketStart >= html.length || html[bracketStart] !== "[") {
    return null;
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  const start = bracketStart;
  for (let j = bracketStart; j < html.length; j++) {
    const c = html[j]!;
    if (inString) {
      if (escape) {
        escape = false;
      } else if (c === "\\") {
        escape = true;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(html.slice(start, j + 1)) as unknown;
          return Array.isArray(parsed) ? parsed : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Collect arrays from every JSON.stringify([...]); keep arrays where each element
 * is a dict and passes rowIsGridRow. Return the longest such array.
 */
export function largestJsonStringifyGrid(
  html: string,
  rowIsGridRow: (item: unknown) => boolean,
): Record<string, unknown>[] | null {
  const candidates: Record<string, unknown>[][] = [];
  let pos = 0;
  while (true) {
    const i = html.indexOf(JSON_STRINGIFY_MARKER, pos);
    if (i < 0) break;
    const j = i + JSON_STRINGIFY_MARKER.length;
    if (j < html.length && html[j] === "[") {
      const raw = parseJsonArrayAt(html, j);
      if (raw) {
        const dictRows = raw.filter(
          (x): x is Record<string, unknown> =>
            typeof x === "object" &&
            x !== null &&
            !Array.isArray(x) &&
            rowIsGridRow(x),
        );
        if (dictRows.length > 0 && dictRows.length === raw.length) {
          candidates.push(dictRows);
        }
      }
    }
    pos = i + 1;
  }
  if (!candidates.length) return null;
  return candidates.reduce((a, b) => (a.length >= b.length ? a : b));
}
