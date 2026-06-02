/**
 * San Diego County Treasurer-Tax Collector — unclaimed / refund listings → source_records.
 * Ports legacy HTML grid parsers (JSON.stringify grids) from clcc-watch import_sd_ttc_*.py.
 *
 * Run: npm run import:sd-county-ttc -- [--dir path] [--file path] [--truncate] [--fetch-live]
 *
 * Default: process *.html / *.pdf / *.csv / *.xlsx under data/sd-county-ttc;
 * if none found, fetches all four public listing URLs (same as legacy importers).
 */

import "./load-importer-env";
import { createReadStream } from "fs";
import { readdir } from "fs/promises";
import { access, constants, readFile } from "fs/promises";
import path from "path";
import type { Prisma } from "@prisma/client";
import { parse } from "csv-parse";
import { PDFParse } from "pdf-parse";
import * as XLSX from "xlsx";

import {
  SCANNER_FTS_SOURCE_KEYS,
  SD_COUNTY_TTC_UNCLAIMED_SOURCE_KEY,
} from "../ca-sco-keys";
import { SD_COUNTY_TTC_DATA_DIR } from "../config";
import { prisma } from "../db/client";
import {
  ensureSourceRecordsFtsTable,
  repopulateSourceRecordsFtsFromSourceRecords,
} from "../db/source-records-fts";
import { normalizeText } from "../normalizeText";

import { largestJsonStringifyGrid } from "./sd-ttc-grid-extract";

const LOG_PREFIX = "[sd-county-ttc-import]";
const INSERT_BATCH_SIZE = 80;

export const DEFAULT_REQUEST_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
};

type ListingKind =
  | "property_tax_refunds"
  | "abandoned"
  | "estate_heir"
  | "estate_no_heir";

/** Legacy column keys (must match sdttc.com grid JSON). */
const PTR = {
  PAYEE: "Payee",
  REF: "Control / Ref No",
  DEP: "DepDate",
  AMOUNT: "Amount",
  PROP_ID: "Property ID",
  FORM: "DOWNLOAD CLAIM FORM",
} as const;

const ABN = {
  PAYEE: "PAYEE",
  REF: "REFERENCE NO",
  AMOUNT: "AMOUNT",
  FORM: "DOWNLOAD CLAIM FORM",
} as const;

const EH = {
  DECEASED: "Estate of (Name of Deceased)",
  HEIR: "Name of Heir",
  AMOUNT: "Deposit (Amount per Heir)",
  FORM: "DOWNLOAD CLAIM FORM",
} as const;

const ENH = {
  LAST: "PAYEE LAST NAME",
  FIRST: "PAYEE FIRST NAME",
  MIDDLE: "PAYEE MIDDLE NAME",
  REF: "REFERENCE NO",
  AMOUNT: "AMOUNT",
  FORM: "DOWNLOAD CLAIM FORM",
} as const;

const LISTING_ORDER: ListingKind[] = [
  "property_tax_refunds",
  "abandoned",
  "estate_heir",
  "estate_no_heir",
];

const LISTING_META: Record<
  ListingKind,
  { url: string; propertyType: string }
> = {
  property_tax_refunds: {
    url: "https://www.sdttc.com/content/ttc/en/tax-collection/property-tax-refunds.html",
    propertyType: "County Property Tax Refund",
  },
  abandoned: {
    url:
      "https://www.sdttc.com/content/ttc/en/tax-collection/Unclaimed-Money/unclaimed-monies-abandoned-properties.html",
    propertyType: "County Abandoned Property",
  },
  estate_heir: {
    url:
      "https://www.sdttc.com/content/ttc/en/tax-collection/Unclaimed-Money/unclaimed-monies-estates-of-deceased-with-heir.html",
    propertyType: "County Unclaimed Estate (With Heir)",
  },
  estate_no_heir: {
    url:
      "https://www.sdttc.com/content/ttc/en/tax-collection/Unclaimed-Money/unclaimed-monies-estates-of-deceased-without-heir.html",
    propertyType: "County Estate Refund - No Heir",
  },
};

type TtcDbRow = {
  listingKind: ListingKind;
  propertyId: string;
  ownerName: string;
  holderName: string;
  amount: number | null;
  propertyType: string;
  sourcePageUrl: string;
  sourceFilename: string;
  parsingMode: string;
  rawRow: Record<string, unknown>;
};

function parseCliArgs(): {
  dir?: string;
  file?: string;
  truncate: boolean;
  fetchLive: boolean;
} {
  const args = process.argv.slice(2);
  let dir: string | undefined;
  let file: string | undefined;
  let truncate = false;
  let fetchLive = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--truncate") truncate = true;
    else if (a === "--fetch-live") fetchLive = true;
    else if (a.startsWith("--dir=")) dir = a.slice("--dir=".length);
    else if (a === "--dir" && args[i + 1]) dir = args[++i];
    else if (a.startsWith("--file=")) file = a.slice("--file=".length);
    else if (a === "--file" && args[i + 1]) file = args[++i];
  }
  return { dir, file, truncate, fetchLive };
}

function parseAmount(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw)
    .trim()
    .replace(/\$/g, "")
    .replace(/,/g, "");
  if (!text) return null;
  const v = Number.parseFloat(text);
  return Number.isFinite(v) ? v : null;
}

function claimFormUrlFromCell(raw: unknown): string {
  const s = raw === null || raw === undefined ? "" : String(raw);
  if (!s) return "";
  let m = /href="(https?:\/\/[^"]+)"/i.exec(s);
  if (m) return m[1]!.trim();
  m = /href='(https?:\/\/[^']+)'/i.exec(s);
  return m ? m[1]!.trim() : "";
}

function cellStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  return s.toLowerCase() === "nan" ? "" : s;
}

function headerMatches(want: string, header: string): boolean {
  return (
    header.trim().toUpperCase().replace(/  +/g, " ") ===
    want.toUpperCase().replace(/  +/g, " ")
  );
}

function ptrIsGridRow(item: unknown): boolean {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  const d = item as Record<string, unknown>;
  return PTR.PAYEE in d || PTR.REF in d;
}

function abandonedIsGridRow(item: unknown): boolean {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  const d = item as Record<string, unknown>;
  return ABN.PAYEE in d || ABN.REF in d;
}

function estateHeirIsGridRow(item: unknown): boolean {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  const d = item as Record<string, unknown>;
  return EH.DECEASED in d || EH.HEIR in d;
}

function estateNoHeirIsGridRow(item: unknown): boolean {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  const d = item as Record<string, unknown>;
  return (
    ENH.REF in d || ENH.LAST in d || ENH.FIRST in d
  );
}

function normalizePtrRow(d: Record<string, unknown>): Record<string, unknown> | null {
  const payee = cellStr(d[PTR.PAYEE]);
  const ref = cellStr(d[PTR.REF]);
  if (!payee && !ref) return null;
  return {
    [PTR.PAYEE]: payee,
    [PTR.REF]: ref,
    [PTR.DEP]: d[PTR.DEP],
    [PTR.AMOUNT]: d[PTR.AMOUNT],
    [PTR.PROP_ID]: d[PTR.PROP_ID],
    [PTR.FORM]: d[PTR.FORM],
  };
}

function normalizeAbandonedRow(
  d: Record<string, unknown>,
): Record<string, unknown> | null {
  const payee = cellStr(d[ABN.PAYEE]);
  const ref = cellStr(d[ABN.REF]);
  if (!payee && !ref) return null;
  return {
    [ABN.PAYEE]: payee,
    [ABN.REF]: ref,
    [ABN.AMOUNT]: d[ABN.AMOUNT],
    [ABN.FORM]: d[ABN.FORM],
  };
}

function normalizeEstateHeirRow(
  d: Record<string, unknown>,
): Record<string, unknown> | null {
  const dec = cellStr(d[EH.DECEASED]);
  const heir = cellStr(d[EH.HEIR]);
  if (!dec && !heir) return null;
  return {
    [EH.DECEASED]: dec,
    [EH.HEIR]: heir,
    [EH.AMOUNT]: d[EH.AMOUNT],
    [EH.FORM]: d[EH.FORM],
  };
}

function combinePayee(first: string, middle: string, last: string): string {
  return [first, middle, last]
    .map((p) => p.trim())
    .filter(Boolean)
    .join(" ");
}

function amountDedupeKey(raw: unknown): string {
  const p = parseAmount(raw);
  if (p !== null) return p.toFixed(6);
  return cellStr(raw).toLowerCase().replace(/\s+/g, " ");
}

function normalizeEstateNoHeirRow(
  d: Record<string, unknown>,
): Record<string, unknown> | null {
  const first = cellStr(d[ENH.FIRST]);
  const middle = cellStr(d[ENH.MIDDLE]);
  const last = cellStr(d[ENH.LAST]);
  const ref = cellStr(d[ENH.REF]);
  const owner = combinePayee(first, middle, last);
  if (!owner && !ref) return null;
  return {
    [ENH.FIRST]: first,
    [ENH.MIDDLE]: middle,
    [ENH.LAST]: last,
    [ENH.REF]: ref,
    _owner: owner,
    [ENH.AMOUNT]: d[ENH.AMOUNT],
    [ENH.FORM]: d[ENH.FORM],
  };
}

function extractGridRows(
  html: string,
  predicate: (item: unknown) => boolean,
  normalize: (d: Record<string, unknown>) => Record<string, unknown> | null,
): Record<string, unknown>[] {
  const raw = largestJsonStringifyGrid(html, predicate);
  if (!raw?.length) return [];
  const out: Record<string, unknown>[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const norm = normalize(item as Record<string, unknown>);
    if (norm) out.push(norm);
  }
  return out;
}

function dedupePtr(rows: Record<string, unknown>[]): {
  rows: Record<string, unknown>[];
  dupes: number;
} {
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  let dup = 0;
  for (const r of rows) {
    const key = `${cellStr(r[PTR.REF]).toLowerCase()}|${cellStr(r[PTR.PAYEE]).toLowerCase()}`;
    if (seen.has(key)) {
      dup++;
      continue;
    }
    seen.add(key);
    out.push(r);
  }
  return { rows: out, dupes: dup };
}

function ptrPropertyId(
  ref: string,
  payee: string,
  parcel: string,
  refCounts: Map<string, number>,
): string {
  const r = ref.trim();
  const p = payee.trim();
  const par = parcel.trim();
  const rc = refCounts.get(r) ?? 0;
  if (rc <= 1 && r) return r;
  if (r) return p ? `${r} | ${p}` : r;
  if (par) return p ? `${par} | ${p}` : par;
  return p || "unknown";
}

function buildPtrRows(html: string): Record<string, unknown>[] {
  const raw = extractGridRows(html, ptrIsGridRow, normalizePtrRow);
  return dedupePtr(raw).rows;
}

function dedupeAbandoned(rows: Record<string, unknown>[]): {
  rows: Record<string, unknown>[];
  dupes: number;
} {
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  let dup = 0;
  for (const r of rows) {
    const key = `${cellStr(r[ABN.REF]).toLowerCase()}|${cellStr(r[ABN.PAYEE]).toLowerCase()}`;
    if (seen.has(key)) {
      dup++;
      continue;
    }
    seen.add(key);
    out.push(r);
  }
  return { rows: out, dupes: dup };
}

function abandonedPid(ref: string, payee: string, refCounts: Map<string, number>): string {
  const r = ref.trim();
  const p = payee.trim();
  if ((refCounts.get(r) ?? 0) <= 1 && r) return r || p || "unknown";
  return p ? `${r} | ${p}` : r || "unknown";
}

function buildAbandonedRows(html: string): Record<string, unknown>[] {
  const raw = extractGridRows(html, abandonedIsGridRow, normalizeAbandonedRow);
  return dedupeAbandoned(raw).rows;
}

function dedupeEstateHeir(rows: Record<string, unknown>[]): {
  rows: Record<string, unknown>[];
  dupes: number;
} {
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  let dup = 0;
  for (const r of rows) {
    const amt = cellStr(r[EH.AMOUNT]).toLowerCase();
    const key = `${cellStr(r[EH.DECEASED]).toLowerCase()}|${cellStr(r[EH.HEIR]).toLowerCase()}|${amt}`;
    if (seen.has(key)) {
      dup++;
      continue;
    }
    seen.add(key);
    out.push(r);
  }
  return { rows: out, dupes: dup };
}

function estateHeirPairCounts(rows: Record<string, unknown>[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = `${cellStr(r[EH.DECEASED]).toLowerCase()}|${cellStr(r[EH.HEIR]).toLowerCase()}`;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

function estateHeirPid(
  deceased: string,
  heir: string,
  amountRaw: string,
  pairs: Map<string, number>,
): string {
  const d = deceased.trim();
  const h = heir.trim();
  const base = `${d} | ${h}`;
  const pk = `${d.toLowerCase()}|${h.toLowerCase()}`;
  if ((pairs.get(pk) ?? 0) <= 1) return base;
  const amt = amountRaw.trim();
  return amt ? `${base} | ${amt}` : `${base} | (no amount)`;
}

function buildEstateHeirRows(html: string): Record<string, unknown>[] {
  const raw = extractGridRows(html, estateHeirIsGridRow, normalizeEstateHeirRow);
  return dedupeEstateHeir(raw).rows;
}

function dedupeEstateNoHeir(rows: Record<string, unknown>[]): {
  rows: Record<string, unknown>[];
  dupes: number;
} {
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  let dup = 0;
  for (const r of rows) {
    const ref = cellStr(r[ENH.REF]).toLowerCase();
    const owner = cellStr(r._owner).toLowerCase();
    const ak = amountDedupeKey(r[ENH.AMOUNT]);
    const key = `${ref}|${owner}|${ak}`;
    if (seen.has(key)) {
      dup++;
      continue;
    }
    seen.add(key);
    out.push(r);
  }
  return { rows: out, dupes: dup };
}

function estateNoHeirPid(
  ref: string,
  owner: string,
  refCounts: Map<string, number>,
  amountRaw: unknown,
): string {
  const r = ref.trim();
  const o = owner.trim();
  const ak = amountDedupeKey(amountRaw);
  const rc = refCounts.get(r) ?? 0;
  if (rc <= 1 && r) return r;
  if (r) return o ? `${r} | ${o} | ${ak}` : `${r} | ${ak}`;
  return o ? `${o} | ${ak}` : "unknown";
}

function buildEstateNoHeirRows(html: string): Record<string, unknown>[] {
  const raw = extractGridRows(html, estateNoHeirIsGridRow, normalizeEstateNoHeirRow);
  return dedupeEstateNoHeir(raw).rows;
}

function guessListingKind(filename: string): ListingKind | undefined {
  const n = filename.toLowerCase();
  if (
    n.includes("property-tax") ||
    n.includes("prop-tax") ||
    n.includes("tax-refund")
  ) {
    return "property_tax_refunds";
  }
  if (n.includes("abandoned")) return "abandoned";
  if (n.includes("without-heir") || n.includes("no-heir")) {
    return "estate_no_heir";
  }
  if (
    n.includes("with-heir") ||
    n.includes("estate-heir") ||
    (n.includes("estates") && n.includes("heir") && !n.includes("without"))
  ) {
    return "estate_heir";
  }
  return undefined;
}

function detectListingKind(html: string): ListingKind {
  let best: { k: ListingKind; n: number } = {
    k: "property_tax_refunds",
    n: -1,
  };
  const tryCount = (k: ListingKind, rows: Record<string, unknown>[]) => {
    if (rows.length > best.n) best = { k, n: rows.length };
  };
  tryCount("property_tax_refunds", buildPtrRows(html));
  tryCount("abandoned", buildAbandonedRows(html));
  tryCount("estate_heir", buildEstateHeirRows(html));
  tryCount("estate_no_heir", buildEstateNoHeirRows(html));
  return best.n > 0 ? best.k : "property_tax_refunds";
}

function prefixedPropertyId(kind: ListingKind, legacyPid: string): string {
  const p = legacyPid.trim() || "unknown";
  switch (kind) {
    case "property_tax_refunds":
      return `ptr:${p}`;
    case "abandoned":
      return `abn:${p}`;
    case "estate_heir":
      return `eh:${p}`;
    case "estate_no_heir":
      return `enh:${p}`;
    default:
      return `ttc:${p}`;
  }
}

function htmlToDbRows(
  html: string,
  listingKind: ListingKind,
  sourceFilename: string,
  parsingMode: string,
): TtcDbRow[] {
  const meta = LISTING_META[listingKind];
  const out: TtcDbRow[] = [];

  if (listingKind === "property_tax_refunds") {
    const rows = buildPtrRows(html);
    const refs = rows.map((r) => cellStr(r[PTR.REF]));
    const refCounts = new Map<string, number>();
    for (const ref of refs) {
      refCounts.set(ref, (refCounts.get(ref) ?? 0) + 1);
    }
    const handled = new Set<string>();
    for (const r of rows) {
      const payee = cellStr(r[PTR.PAYEE]);
      const ref = cellStr(r[PTR.REF]);
      if (!ref && !payee) continue;
      const parcel = cellStr(r[PTR.PROP_ID]);
      const pid = prefixedPropertyId(
        listingKind,
        ptrPropertyId(ref, payee, parcel, refCounts),
      );
      if (handled.has(pid)) continue;
      handled.add(pid);
      const amt = parseAmount(r[PTR.AMOUNT]);
      const rawRow = {
        ...r,
        _claimFormUrl: claimFormUrlFromCell(r[PTR.FORM]),
      };
      out.push({
        listingKind,
        propertyId: pid,
        ownerName: payee || "Unknown payee",
        holderName: "",
        amount: amt,
        propertyType: meta.propertyType,
        sourcePageUrl: meta.url,
        sourceFilename,
        parsingMode,
        rawRow,
      });
    }
    return out;
  }

  if (listingKind === "abandoned") {
    const rows = buildAbandonedRows(html);
    const refs = rows.map((r) => cellStr(r[ABN.REF]));
    const refCounts = new Map<string, number>();
    for (const ref of refs) refCounts.set(ref, (refCounts.get(ref) ?? 0) + 1);
    const handled = new Set<string>();
    for (const r of rows) {
      const payee = cellStr(r[ABN.PAYEE]);
      const ref = cellStr(r[ABN.REF]);
      if (!ref && !payee) continue;
      const pid = prefixedPropertyId(
        listingKind,
        abandonedPid(ref, payee, refCounts),
      );
      if (handled.has(pid)) continue;
      handled.add(pid);
      const amt = parseAmount(r[ABN.AMOUNT]);
      out.push({
        listingKind,
        propertyId: pid,
        ownerName: payee || "Unknown payee",
        holderName: "",
        amount: amt,
        propertyType: meta.propertyType,
        sourcePageUrl: meta.url,
        sourceFilename,
        parsingMode,
        rawRow: {
          ...r,
          _claimFormUrl: claimFormUrlFromCell(r[ABN.FORM]),
        },
      });
    }
    return out;
  }

  if (listingKind === "estate_heir") {
    const rows = buildEstateHeirRows(html);
    const pairs = estateHeirPairCounts(rows);
    const handled = new Set<string>();
    for (const r of rows) {
      const dec = cellStr(r[EH.DECEASED]);
      const heir = cellStr(r[EH.HEIR]);
      if (!dec && !heir) continue;
      const amtRaw = String(r[EH.AMOUNT] ?? "");
      const pid = prefixedPropertyId(
        listingKind,
        estateHeirPid(dec, heir, amtRaw, pairs),
      );
      if (handled.has(pid)) continue;
      handled.add(pid);
      const amt = parseAmount(r[EH.AMOUNT]);
      out.push({
        listingKind,
        propertyId: pid,
        ownerName: heir || "Unknown heir",
        holderName: dec ? `Estate of ${dec}` : "",
        amount: amt,
        propertyType: meta.propertyType,
        sourcePageUrl: meta.url,
        sourceFilename,
        parsingMode,
        rawRow: {
          ...r,
          _claimFormUrl: claimFormUrlFromCell(r[EH.FORM]),
        },
      });
    }
    return out;
  }

  /* estate_no_heir */
  const rows = buildEstateNoHeirRows(html);
  const refs = rows.map((r) => cellStr(r[ENH.REF]));
  const refCounts = new Map<string, number>();
  for (const ref of refs) refCounts.set(ref, (refCounts.get(ref) ?? 0) + 1);
  const handled = new Set<string>();
  for (const r of rows) {
    const owner = cellStr(r._owner);
    const ref = cellStr(r[ENH.REF]);
    if (!ref && !owner) continue;
    const pid = prefixedPropertyId(
      listingKind,
      estateNoHeirPid(ref, owner, refCounts, r[ENH.AMOUNT]),
    );
    if (handled.has(pid)) continue;
    handled.add(pid);
    const amt = parseAmount(r[ENH.AMOUNT]);
    out.push({
      listingKind,
      propertyId: pid,
      ownerName: owner || "Unknown payee",
      holderName: "",
      amount: amt,
      propertyType: meta.propertyType,
      sourcePageUrl: meta.url,
      sourceFilename,
      parsingMode,
      rawRow: {
        ...r,
        _claimFormUrl: claimFormUrlFromCell(r[ENH.FORM]),
      },
    });
  }
  return out;
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: DEFAULT_REQUEST_HEADERS,
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.text();
}

async function tryPdfToHtmlGridText(filePath: string): Promise<string | null> {
  const buf = await readFile(filePath);
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const textResult = await parser.getText();
    const text =
      textResult.text ||
      (textResult.pages ?? []).map((p) => p.text).join("\n");
    if (text.includes("JSON.stringify(")) return text;
    const tableResult = await parser.getTable();
    const tables = tableResult.mergedTables?.length
      ? tableResult.mergedTables
      : (tableResult.pages ?? []).flatMap((p) => p.tables ?? []);
    if (!tables.length) return null;
    return JSON.stringify({ _pdfTables: tables, _note: "pdf-table-fallback" });
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

async function csvRowsFromFile(filePath: string): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const rows: Record<string, unknown>[] = [];
    const parser = createReadStream(filePath).pipe(
      parse({
        columns: true,
        trim: true,
        bom: true,
        relax_column_count: true,
      }),
    );
    parser.on("data", (row: Record<string, unknown>) => rows.push(row));
    parser.on("error", reject);
    parser.on("end", () => resolve(rows));
  });
}

function rowObjectsFromXlsx(filePath: string): Record<string, unknown>[] {
  const wb = XLSX.readFile(filePath, { cellDates: true, raw: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
  });
}

/** Map CSV/XLS row keys via header aliases → grid-shaped row for a listing. */
function csvRowToPtrShape(row: Record<string, unknown>): Record<string, unknown> | null {
  const keys = Object.keys(row);
  const pick = (want: string): unknown => {
    const hit = keys.find((k) => headerMatches(want, k));
    return hit ? row[hit] : undefined;
  };
  const out: Record<string, unknown> = {
    [PTR.PAYEE]: pick(PTR.PAYEE),
    [PTR.REF]: pick(PTR.REF),
    [PTR.DEP]: pick(PTR.DEP),
    [PTR.AMOUNT]: pick(PTR.AMOUNT),
    [PTR.PROP_ID]: pick(PTR.PROP_ID),
    [PTR.FORM]: pick(PTR.FORM),
  };
  return normalizePtrRow(out);
}

function csvRowsToSyntheticHtml(
  rows: Record<string, unknown>[],
  kind: ListingKind,
): string {
  const normalized: Record<string, unknown>[] = [];
  for (const row of rows) {
    let n: Record<string, unknown> | null = null;
    if (kind === "property_tax_refunds") n = csvRowToPtrShape(row);
    else if (kind === "abandoned") {
      const keys = Object.keys(row);
      const pick = (w: string) => {
        const h = keys.find((k) => headerMatches(w, k));
        return h ? row[h] : undefined;
      };
      n = normalizeAbandonedRow({
        [ABN.PAYEE]: pick(ABN.PAYEE),
        [ABN.REF]: pick(ABN.REF),
        [ABN.AMOUNT]: pick(ABN.AMOUNT),
        [ABN.FORM]: pick(ABN.FORM),
      });
    } else if (kind === "estate_heir") {
      const keys = Object.keys(row);
      const pick = (w: string) => {
        const h = keys.find((k) => headerMatches(w, k));
        return h ? row[h] : undefined;
      };
      n = normalizeEstateHeirRow({
        [EH.DECEASED]: pick(EH.DECEASED),
        [EH.HEIR]: pick(EH.HEIR),
        [EH.AMOUNT]: pick(EH.AMOUNT),
        [EH.FORM]: pick(EH.FORM),
      });
    } else {
      const keys = Object.keys(row);
      const pick = (w: string) => {
        const h = keys.find((k) => headerMatches(w, k));
        return h ? row[h] : undefined;
      };
      n = normalizeEstateNoHeirRow({
        [ENH.FIRST]: pick(ENH.FIRST),
        [ENH.MIDDLE]: pick(ENH.MIDDLE),
        [ENH.LAST]: pick(ENH.LAST),
        [ENH.REF]: pick(ENH.REF),
        [ENH.AMOUNT]: pick(ENH.AMOUNT),
        [ENH.FORM]: pick(ENH.FORM),
      });
    }
    if (n) normalized.push(n);
  }
  return `<script>JSON.stringify(${JSON.stringify(normalized)})</script>`;
}

/** Pick listing layout for spreadsheet rows when filename gives no hint. */
function pickCsvListingKind(objs: Record<string, unknown>[]): ListingKind {
  let best: ListingKind = "property_tax_refunds";
  let bestN = -1;
  for (const k of LISTING_ORDER) {
    const html = csvRowsToSyntheticHtml(objs, k);
    const n = htmlToDbRows(html, k, "_detect.csv", "detect").length;
    if (n > bestN) {
      bestN = n;
      best = k;
    }
  }
  return best;
}

async function processPath(
  filePath: string,
  listingHint?: ListingKind,
): Promise<{ dbRows: TtcDbRow[]; parsingMode: string }> {
  const ext = path.extname(filePath).toLowerCase();
  const base = path.basename(filePath);
  const hint = listingHint ?? guessListingKind(base);

  if (ext === ".html" || ext === ".htm") {
    const html = await readFile(filePath, "utf8");
    const useKind = hint ?? detectListingKind(html);
    return {
      dbRows: htmlToDbRows(html, useKind, base, "json-stringify-grid"),
      parsingMode: "json-stringify-grid",
    };
  }

  if (ext === ".pdf") {
    const gridText = await tryPdfToHtmlGridText(filePath);
    if (!gridText || !gridText.includes("JSON.stringify(")) {
      console.warn(
        `${LOG_PREFIX} ${base}: PDF has no embedded JSON.stringify grid — skipped`,
      );
      return { dbRows: [], parsingMode: "pdf-unsupported" };
    }
    const useKind = hint ?? detectListingKind(gridText);
    return {
      dbRows: htmlToDbRows(gridText, useKind, base, "pdf-text-json-grid"),
      parsingMode: "pdf-text-json-grid",
    };
  }

  if (ext === ".csv") {
    const objs = await csvRowsFromFile(filePath);
    const useKind = hint ?? pickCsvListingKind(objs);
    const html = csvRowsToSyntheticHtml(objs, useKind);
    return {
      dbRows: htmlToDbRows(html, useKind, base, "csv-header-map"),
      parsingMode: "csv-header-map",
    };
  }

  if (ext === ".xlsx" || ext === ".xls") {
    const objs = rowObjectsFromXlsx(filePath);
    const useKind = hint ?? pickCsvListingKind(objs);
    const html = csvRowsToSyntheticHtml(objs, useKind);
    return {
      dbRows: htmlToDbRows(html, useKind, base, "xlsx-header-map"),
      parsingMode: "xlsx-header-map",
    };
  }

  console.warn(`${LOG_PREFIX} Unsupported extension for ${base}`);
  return { dbRows: [], parsingMode: "skipped" };
}

async function gatherLocalFiles(
  dir: string,
): Promise<string[]> {
  const names = await readdir(dir);
  const paths = names
    .filter((n) => /\.(html|htm|pdf|csv|xlsx|xls)$/i.test(n))
    .map((n) => path.join(dir, n))
    .sort((a, b) =>
      path.basename(a).localeCompare(path.basename(b), undefined, {
        sensitivity: "base",
      }),
    );
  return paths;
}

function amountToDbString(amount: number | null): string | null {
  if (amount === null || !Number.isFinite(amount)) return null;
  return amount.toFixed(2);
}

async function flushBatch(
  batch: Prisma.SourceRecordCreateManyInput[],
): Promise<number> {
  if (batch.length === 0) return 0;
  const result = await prisma.sourceRecord.createMany({ data: batch });
  return result.count;
}

export async function importSdCountyTtc(options?: {
  dir?: string;
  file?: string;
  truncate?: boolean;
  fetchLive?: boolean;
}): Promise<void> {
  const cli = parseCliArgs();
  const truncate = options?.truncate ?? cli.truncate;
  const fetchLive = options?.fetchLive ?? cli.fetchLive;

  if (!process.env.DATABASE_URL?.trim()) {
    console.error(`${LOG_PREFIX} DATABASE_URL is not set.`);
    process.exitCode = 1;
    return;
  }

  const t0 = Date.now();
  let tasks: { path?: string; label: string; listingHint?: ListingKind }[] =
    [];

  if (fetchLive) {
    tasks = LISTING_ORDER.map((kind) => ({
      label: `live:${kind}`,
      listingHint: kind,
    }));
  } else if (options?.file ?? cli.file) {
    const f = path.resolve((options?.file ?? cli.file)!.trim());
    await access(f, constants.R_OK);
    tasks = [{ path: f, label: path.basename(f) }];
  } else {
    const dir = path.resolve(options?.dir ?? cli.dir ?? SD_COUNTY_TTC_DATA_DIR);
    await access(dir, constants.R_OK);
    const files = await gatherLocalFiles(dir);
    console.log(`${LOG_PREFIX} Resolved directory: ${dir}`);
    if (!files.length) {
      console.log(
        `${LOG_PREFIX} No .html/.pdf/.csv/.xlsx files — fetching live listings (use --dir to suppress).`,
      );
      tasks = LISTING_ORDER.map((kind) => ({
        label: `live:${kind}`,
        listingHint: kind,
      }));
    } else {
      console.log(
        `${LOG_PREFIX} Files (${files.length}): ${files.map((p) => path.basename(p)).join(", ")}`,
      );
      tasks = files.map((p) => ({ path: p, label: path.basename(p) }));
    }
  }

  await ensureSourceRecordsFtsTable(prisma);

  if (truncate) {
    const del = await prisma.sourceRecord.deleteMany({
      where: { source: SD_COUNTY_TTC_UNCLAIMED_SOURCE_KEY },
    });
    console.log(
      `${LOG_PREFIX} Truncated source="${SD_COUNTY_TTC_UNCLAIMED_SOURCE_KEY}": ${del.count} rows removed`,
    );
  }

  let totalParsed = 0;
  let rowsInserted = 0;
  let rowsSkippedEmpty = 0;
  const batch: Prisma.SourceRecordCreateManyInput[] = [];

  try {
    for (const task of tasks) {
      if (task.path) {
        const r = await processPath(task.path, guessListingKind(task.label));
        console.log(
          `${LOG_PREFIX} ${task.label}: parsingMode=${r.parsingMode}, rows=${r.dbRows.length.toLocaleString()}`,
        );
        totalParsed += r.dbRows.length;
        for (const row of r.dbRows) {
          if (!row.ownerName.trim()) {
            rowsSkippedEmpty++;
            continue;
          }
          const rawJson = JSON.stringify({
            listingKind: row.listingKind,
            sourceFilename: row.sourceFilename,
            sourcePageUrl: row.sourcePageUrl,
            parsingMode: row.parsingMode,
            propertyType: row.propertyType,
            originalParsedRow: row.rawRow,
          });
          batch.push({
            source: SD_COUNTY_TTC_UNCLAIMED_SOURCE_KEY,
            propertyId: row.propertyId,
            ownerName: row.ownerName,
            ownerNameNormalized: normalizeText(row.ownerName),
            holderName: row.holderName.trim() ? row.holderName : "",
            amount: amountToDbString(row.amount),
            address: null,
            city: null,
            state: null,
            zipCode: null,
            propertyType: row.propertyType,
            rawJson,
          });
          if (batch.length >= INSERT_BATCH_SIZE) {
            rowsInserted += await flushBatch(batch);
            batch.length = 0;
          }
        }
        continue;
      }

      /* fetch live */
      const kind = task.listingHint!;
      const url = LISTING_META[kind].url;
      console.log(`${LOG_PREFIX} Fetching ${kind}: ${url}`);
      const html = await fetchHtml(url);
      const sourceFilename = `live-${kind}.html`;
      const dbRows = htmlToDbRows(
        html,
        kind,
        sourceFilename,
        "fetch-live-json-grid",
      );
      console.log(
        `${LOG_PREFIX} ${sourceFilename}: parsingMode=fetch-live-json-grid, rows=${dbRows.length.toLocaleString()}`,
      );
      totalParsed += dbRows.length;
      for (const row of dbRows) {
        if (!row.ownerName.trim()) {
          rowsSkippedEmpty++;
          continue;
        }
        const rawJson = JSON.stringify({
          listingKind: row.listingKind,
          sourceFilename: row.sourceFilename,
          sourcePageUrl: row.sourcePageUrl,
          parsingMode: row.parsingMode,
          propertyType: row.propertyType,
          originalParsedRow: row.rawRow,
        });
        batch.push({
          source: SD_COUNTY_TTC_UNCLAIMED_SOURCE_KEY,
          propertyId: row.propertyId,
          ownerName: row.ownerName,
          ownerNameNormalized: normalizeText(row.ownerName),
          holderName: row.holderName.trim() ? row.holderName : "",
          amount: amountToDbString(row.amount),
          address: null,
          city: null,
          state: null,
          zipCode: null,
          propertyType: row.propertyType,
          rawJson,
        });
        if (batch.length >= INSERT_BATCH_SIZE) {
          rowsInserted += await flushBatch(batch);
          batch.length = 0;
        }
      }
    }

    rowsInserted += await flushBatch(batch);

    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
    console.log(
      `${LOG_PREFIX} Totals — rows_parsed=${totalParsed.toLocaleString()}, inserted=${rowsInserted.toLocaleString()}, ` +
        `skipped_empty_owner=${rowsSkippedEmpty.toLocaleString()}, elapsed=${elapsed}s`,
    );

    const rb = Date.now();
    console.log(
      `${LOG_PREFIX} Repopulating FTS (${SCANNER_FTS_SOURCE_KEYS.join(", ")})…`,
    );
    await repopulateSourceRecordsFtsFromSourceRecords(prisma);
    console.log(
      `${LOG_PREFIX} FTS repopulate done in ${((Date.now() - rb) / 1000).toFixed(1)}s`,
    );
  } catch (e) {
    console.error(`${LOG_PREFIX} Import failed:`, e);
    process.exitCode = 1;
    throw e;
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  await importSdCountyTtc();
}

main().catch(() => {
  process.exit(1);
});
