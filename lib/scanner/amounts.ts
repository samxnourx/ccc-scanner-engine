/**
 * Amount parsing/formatting for scanner currency fields.
 */

const NON_NUMERIC = /[^\d.-]/g;

/** Strip currency symbols and grouping; parse as USD decimal. */
export function parseAmountToNumber(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const cleaned = t.replace(NON_NUMERIC, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function formatUsdTotal(total: number): string {
  return total.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Display amount for UI / payloads (two decimals when numeric). */
export function formatAmountDisplay(raw: string): string {
  const n = parseAmountToNumber(raw);
  if (n === null) return raw.trim() || "-";
  return formatUsdTotal(n);
}

export function sumAmountFields(
  values: Array<string | null | undefined>,
): number {
  return values.reduce((sum, value) => {
    if (!value) return sum;
    const n = parseAmountToNumber(value);
    return n === null ? sum : sum + n;
  }, 0);
}
