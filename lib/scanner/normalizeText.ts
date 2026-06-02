/**
 * Legacy-style text normalization for indexed owner lookup and matching:
 * strip diacritics, fold punctuation, collapse whitespace, lowercase.
 * Used at import time for `owner_name_normalized` and shared with runtime name logic.
 */
export function normalizeText(input: string): string {
  if (!input) return "";
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s&'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
