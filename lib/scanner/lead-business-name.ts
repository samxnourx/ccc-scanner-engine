/**
 * Strip common legal suffix tokens from a business name for an alternate search pass.
 * Applied iteratively (e.g. "Acme Holdings LLC" → "Acme Holdings").
 */
const ENTITY_TAIL =
  /\s*,?\s*\b(inc\.?|incorporated|llc\.?|l\.l\.c\.?|corp\.?|corporation|co\.?|company|lp|llp|plc|ltd\.?|limited|trust|assoc\.?|association|aplc|apc|pc)\b\s*$/i;

export function stripTrailingBusinessSuffixes(name: string): string {
  let s = name.trim();
  for (let i = 0; i < 6; i++) {
    const next = s.replace(ENTITY_TAIL, "").trim();
    if (next === s) break;
    s = next;
  }
  return s;
}

const LOCATION_TAILS = [
  "san diego",
  "north park",
  "la mesa",
  "la jolla",
  "mission valley",
  "hillcrest",
  "chula vista",
  "el cajon",
  "national city",
  "encinitas",
  "escondido",
  "carlsbad",
  "oceanside",
  "poway",
  "santee",
  "del mar",
  "coronado",
  "california",
  "ca",
];

const CATEGORY_TAILS = [
  "pharmacy",
  "clinic",
  "medical center",
  "health center",
  "dental group",
  "dentistry",
  "dentist",
  "dds",
  "dmd",
  "rph",
  "md",
  "do",
];

const GENERIC_SINGLE_WORDS = new Set([
  "arts",
  "center",
  "centers",
  "clinic",
  "dental",
  "dentist",
  "group",
  "health",
  "medical",
  "pharmacy",
]);

const SHORT_BRAND_TOKENS = new Set(["cvs"]);

const DESCRIPTOR_WORDS_FOR_CATEGORY_SWAP = new Set([
  "community",
  "compounding",
  "hospital",
  "medical",
  "retail",
]);

const LOCATION_WORDS = new Set(
  LOCATION_TAILS.flatMap((location) => location.split(/\s+/)).filter(Boolean),
);

const PROFESSIONAL_TAIL =
  /\s*,?\s*\b(rph|pharmd|dds|dmd|md|m\.d\.|do|d\.o\.|od|o\.d\.|rn|np|pa|phd)\b\.?\s*$/i;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripTrailingLocation(name: string, locations: string[]): string {
  let s = name.trim();
  for (let i = 0; i < 4; i++) {
    const before = s;
    for (const loc of locations) {
      const clean = loc.trim();
      if (!clean) continue;
      const re = new RegExp(
        `\\s+(?:(?:of|at|in)\\s+)?(?:-|,)?\\s*${escapeRegExp(clean)}$`,
        "i",
      );
      s = s.replace(re, "").trim();
    }
    if (s === before) break;
  }
  return s;
}

function stripTrailingProfessionalTokens(name: string): string {
  let s = name.trim();
  for (let i = 0; i < 4; i++) {
    const next = s.replace(PROFESSIONAL_TAIL, "").trim();
    if (next === s) break;
    s = next;
  }
  return s;
}

function stripAtLeadQualifier(name: string): string {
  return name
    .replace(/\s*,?\s*(?:part of|a part of|inside|within|at|located in)\b.*$/i, "")
    .trim();
}

function stripTrailingRetailDescriptors(name: string): string {
  return name
    .replace(/\s+y\s+m[aá]s\s*$/i, "")
    .replace(/\s+and\s+more\s*$/i, "")
    .trim();
}

function splitMarketingSeparators(name: string): string[] {
  return name
    .split(/\s*(?:\||–|—| - )\s*/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

function singularizeSimpleTail(name: string): string {
  return name
    .replace(/\bcenters\b/i, "Center")
    .replace(/\bclinics\b/i, "Clinic")
    .replace(/\bpharmacies\b/i, "Pharmacy")
    .trim();
}

function stripTrailingCategory(name: string): string {
  let s = name.trim();
  for (let i = 0; i < 3; i++) {
    const before = s;
    for (const tail of CATEGORY_TAILS) {
      const re = new RegExp(`\\s+${escapeRegExp(tail)}$`, "i");
      s = s.replace(re, "").trim();
    }
    if (s === before) break;
  }
  return s;
}

function personNameVariants(name: string): string[] {
  const clean = stripTrailingProfessionalTokens(name)
    .replace(/\s*,\s*/g, " ")
    .replace(/\./g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = clean.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return [clean].filter(Boolean);

  const out = [clean];
  if (tokens.length >= 3) {
    out.push(`${tokens[0]} ${tokens[tokens.length - 1]}`);
  }
  return out;
}

function looksLikePersonLead(name: string): boolean {
  if (PROFESSIONAL_TAIL.test(name)) return true;
  const tokens = name
    .replace(/[.,]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length < 2 || tokens.length > 4) return false;
  return !tokens.some((token) => GENERIC_SINGLE_WORDS.has(token.toLowerCase()));
}

export function isLeadNameVariantWorthBroadSearch(name: string): boolean {
  const tokens = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return false;

  if (tokens.some((token) => SHORT_BRAND_TOKENS.has(token))) return true;

  if (tokens.length >= 3) return true;

  return tokens.some(
    (token) =>
      token.length >= 4 &&
      !LOCATION_WORDS.has(token) &&
      !GENERIC_SINGLE_WORDS.has(token),
  );
}

function pushVariant(out: string[], seen: Set<string>, value: string): void {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return;
  const key = trimmed.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  out.push(trimmed);
}

/**
 * Lead Scanner often imports location-specific business names
 * ("Perlman Clinic North Park") while unclaimed-property owner rows usually store
 * the parent name ("PERLMAN CLINIC"). Search both forms.
 */
export function leadBusinessSearchNameVariants(input: {
  businessName: string;
  city?: string | null;
  state?: string | null;
}): string[] {
  const full = input.businessName.trim();
  const seen = new Set<string>();
  const out: string[] = [];
  if (!full) return out;

  const locations = [
    input.city ?? "",
    input.state ?? "",
    ...LOCATION_TAILS,
  ].filter(Boolean);

  const marketingParts = splitMarketingSeparators(full);
  const primaryName = stripTrailingRetailDescriptors(
    stripAtLeadQualifier(marketingParts[0] ?? full),
  );
  pushVariant(out, seen, full);
  pushVariant(out, seen, primaryName);

  for (const secondaryPart of marketingParts.slice(1)) {
    const cleanPart = stripTrailingRetailDescriptors(stripAtLeadQualifier(secondaryPart));
    if (!looksLikePersonLead(cleanPart)) continue;
    for (const personVariant of personNameVariants(cleanPart)) {
      pushVariant(out, seen, personVariant);
    }
  }

  if (looksLikePersonLead(primaryName)) {
    for (const personVariant of personNameVariants(primaryName)) {
      pushVariant(out, seen, personVariant);
    }
  }

  const noEntity = stripTrailingProfessionalTokens(
    stripTrailingBusinessSuffixes(primaryName),
  );
  pushVariant(out, seen, noEntity);
  pushVariant(out, seen, singularizeSimpleTail(noEntity));

  const noLocation = stripTrailingLocation(noEntity, locations);
  if (noLocation.split(/\s+/).length >= 2) {
    pushVariant(out, seen, noLocation);
    pushVariant(out, seen, stripTrailingBusinessSuffixes(noLocation));
    pushVariant(out, seen, singularizeSimpleTail(noLocation));
  }

  const noCategory = stripTrailingCategory(noLocation);
  if (noCategory.split(/\s+/).length >= 2) {
    pushVariant(out, seen, noCategory);
  }

  const categoryThenLocation = stripTrailingLocation(
    stripTrailingCategory(noEntity),
    locations,
  );
  if (categoryThenLocation.split(/\s+/).length >= 2) {
    pushVariant(out, seen, categoryThenLocation);
    pushVariant(out, seen, singularizeSimpleTail(categoryThenLocation));
  }

  const words = noLocation.split(/\s+/).filter(Boolean);
  const lastWord = words[words.length - 1] ?? "";
  if (words.length === 3 && CATEGORY_TAILS.includes(lastWord.toLowerCase())) {
    pushVariant(out, seen, `${words[0]} ${words[1]}`);
    if (DESCRIPTOR_WORDS_FOR_CATEGORY_SWAP.has(words[1]!.toLowerCase())) {
      pushVariant(out, seen, `${words[0]} ${words[2]}`);
    }
  }

  return out.slice(0, 10);
}
