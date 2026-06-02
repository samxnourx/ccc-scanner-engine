/**
 * City of San Diego Department of Finance — Unclaimed Monies (PDF) → source_records.
 * Run: npm run import:city-sd-unclaimed -- [--file <path>] [--truncate]
 *
 * Legacy parity: clcc-watch/app/importers/import_city_san_diego_unclaimed_monies.py
 */

import "./load-importer-env";
import { readdir } from "fs/promises";
import { access, constants, readFile, stat } from "fs/promises";
import path from "path";
import type { Prisma } from "@prisma/client";
import { PDFParse } from "pdf-parse";
import type { TableResult } from "pdf-parse";

import {
  CITY_SD_FINANCE_UNCLAIMED_SOURCE_KEY,
  SCANNER_FTS_SOURCE_KEYS,
} from "../ca-sco-keys";
import {
  CITY_SD_FINANCE_REPORT_QUARTER_ENDING,
  CITY_SD_FINANCE_UNCLAIMED_PDF_PATH,
  CITY_SD_FINANCE_UPDATED_LABEL,
} from "../config";
import { prisma } from "../db/client";
import {
  ensureSourceRecordsFtsTable,
  repopulateSourceRecordsFtsFromSourceRecords,
} from "../db/source-records-fts";
import { normalizeText } from "../normalizeText";

const LOG_PREFIX = "[city-sd-unclaimed-import]";
const INSERT_BATCH_SIZE = 80;
const PROPERTY_TYPE = "City Unclaimed Check";
const SOURCE_URL = "https://www.sandiego.gov/finance/unclaimed";

const LINE_START_RE = /^(\d+)\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(.+)$/;

const CITY_BLACKLIST = new Set([
  "LLC",
  "INC",
  "LLP",
  "LCC",
  "DBA",
  "LP",
  "PC",
  "PA",
  "MD",
  "TRUST",
  "APARTMENTS",
  "APARTMENT",
  "OWNER",
  "OWNERS",
  "RETAIL",
  "MANAGEMENT",
  "ENTERPRISES",
  "ENTRPRISES",
  "PARTNERS",
  "PARTNER",
  "INVESTORS",
  "INVESTOR",
  "CORP",
  "CORPORATION",
  "COMPANY",
  "CO",
  "LTD",
  "LIMITED",
  "GROUP",
  "HOLDINGS",
  "ASSOCIATES",
  "PLLC",
  "NA",
  "NPA",
]);

type ParsedRow = {
  check: string;
  date: string;
  amount: number | null;
  payee: string;
  city: string;
  state: string;
};

function parseCliArgs(): { file?: string; truncate: boolean } {
  const args = process.argv.slice(2);
  let file: string | undefined;
  let truncate = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--truncate") truncate = true;
    else if (a.startsWith("--file=")) file = a.slice("--file=".length);
    else if (a === "--file" && args[i + 1]) file = args[++i];
  }
  return { file, truncate };
}

function parseAmount(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw)
    .trim()
    .replace(/\$/g, "")
    .replace(/,/g, "");
  if (!text || ["nan", "none", "—", "-"].includes(text.toLowerCase())) {
    return null;
  }
  const v = Number.parseFloat(text);
  return Number.isFinite(v) ? v : null;
}

function cellStr(cell: string | null | undefined): string {
  if (cell === null || cell === undefined) return "";
  const s = String(cell).trim();
  if (s.toLowerCase() === "nan") return "";
  return s;
}

function headerMap(cells: (string | null | undefined)[]): Record<string, number> | null {
  const norm = cells.map((c) => {
    let t = cellStr(c).toLowerCase();
    t = t.replace(/[\s#]+/g, " ").trim();
    return t;
  });
  const keyToIdx: Record<string, number> = {};
  for (let i = 0; i < norm.length; i++) {
    const t = norm[i]!;
    if (t.includes("check") && t.includes("number")) keyToIdx.check = i;
    else if (t === "date" || t.endsWith(" date")) keyToIdx.date = i;
    else if (t.includes("amount")) keyToIdx.amount = i;
    else if (t.includes("payee")) keyToIdx.payee = i;
    else if (t === "city") keyToIdx.city = i;
    else if (t === "state") keyToIdx.state = i;
  }
  const need = new Set(["check", "date", "amount", "payee", "city", "state"]);
  if ([...need].every((k) => k in keyToIdx)) return keyToIdx;
  return null;
}

function rowFromTableRow(
  row: (string | null | undefined)[],
  colmap: Record<string, number>,
): ParsedRow | null {
  const check = cellStr(row[colmap.check] ?? "");
  if (!check || !/^\d+$/.test(check)) return null;
  const d = cellStr(row[colmap.date] ?? "");
  const amt = parseAmount(cellStr(row[colmap.amount] ?? ""));
  const payee = cellStr(row[colmap.payee] ?? "");
  const city = cellStr(row[colmap.city] ?? "");
  const state = cellStr(row[colmap.state] ?? "");
  if (!payee) return null;
  return { check, date: d, amount: amt, payee, city, state };
}

function normalizeGluedAmountTokens(toks: string[]): string {
  let s = toks.join(" ");
  s = s.replace(/(\d)\s+(\d)/g, "$1$2");
  return s.replace(/\s+/g, "");
}

function cleanToken(t: string): string {
  return t.replace(/[,;]+$/, "").trim();
}

function isCityWord(t: string): boolean {
  const x = cleanToken(t);
  if (x.length < 2) return false;
  const body = x.replace(/-/g, "").replace(/'/g, "");
  if (!/^[A-Za-z]+$/.test(body)) return false;
  if (x !== x.toUpperCase()) return false;
  if (CITY_BLACKLIST.has(x)) return false;
  return true;
}

function rowFromTextLine(line: string): ParsedRow | null {
  const normLine = line.replace(/[\t \u00a0]+/g, " ").trim();
  const m = LINE_START_RE.exec(normLine);
  if (!m) return null;
  const check = m[1]!.trim();
  const d = m[2]!.trim();
  const rest = m[3]!.trim();
  const tokens = rest
    .split(/\s+/)
    .map(cleanToken)
    .filter(Boolean);
  if (tokens.length < 4) return null;

  const stateRaw = tokens[tokens.length - 1]!;
  if (stateRaw.length !== 2 || !/^[A-Za-z]{2}$/.test(stateRaw)) return null;
  const state = stateRaw.toUpperCase();

  for (const nCity of [2, 3, 1] as const) {
    if (tokens.length < 1 + nCity + 1) continue;
    const citySlice = tokens.slice(-(1 + nCity), -1);
    if (!citySlice.every(isCityWord)) continue;
    const city = citySlice.join(" ");
    const front = tokens.slice(0, -(1 + nCity));
    if (front.length < 2) continue;

    for (let k = 1; k < front.length; k++) {
      const am = normalizeGluedAmountTokens(front.slice(0, k));
      if (!/\d\.\d{2}$/.test(am)) continue;
      const candidateAmt = Number.parseFloat(am.replace(/,/g, ""));
      if (!Number.isFinite(candidateAmt)) continue;
      const payee = front.slice(k).join(" ").trim();
      if (!payee) continue;
      return {
        check,
        date: d,
        amount: candidateAmt,
        payee,
        city,
        state,
      };
    }
  }
  return null;
}

function lineLooksLikeNoise(line: string): boolean {
  const u = line.toUpperCase().trim();
  if (!u) return true;
  if (u.includes("PAGE ") && /^PAGE\s+\d+/i.test(u)) return true;
  if (u.includes("UNCLAIMED") && u.includes("MONIES")) return true;
  if (u.includes("CHECK NUMBER") && u.includes("PAYEE")) return true;
  if (u.startsWith("REPORT") || u.includes("QUARTER")) return true;
  return false;
}

function collectTables(tableResult: TableResult): string[][][] {
  const out: string[][][] = [];
  for (const page of tableResult.pages ?? []) {
    for (const t of page.tables ?? []) {
      if (t?.length) out.push(t);
    }
  }
  if (!out.length && tableResult.mergedTables?.length) {
    return tableResult.mergedTables.filter((t) => t?.length);
  }
  return out;
}

function iterTableRowsPdf(tableResult: TableResult): ParsedRow[] {
  const out: ParsedRow[] = [];
  for (const table of collectTables(tableResult)) {
    let colmap: Record<string, number> | null = null;
    let start = 0;
    for (let i = 0; i < table.length; i++) {
      const row = table[i];
      if (!row?.length) continue;
      const hm = headerMap(row);
      if (hm) {
        colmap = hm;
        start = i + 1;
        break;
      }
    }
    if (!colmap) continue;

    for (let i = start; i < table.length; i++) {
      const row = table[i];
      if (!row?.length) continue;
      const first = cellStr(row[0]).toLowerCase();
      if (["total", "totals", "subtotal"].includes(first)) continue;
      const parsed = rowFromTableRow(row, colmap);
      if (parsed) out.push(parsed);
    }
  }
  return out;
}

function iterTextRowsPdf(
  fullText: string,
  stats?: { candidate: number; skipped: number },
): ParsedRow[] {
  const out: ParsedRow[] = [];
  for (const rawLine of fullText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || lineLooksLikeNoise(line)) continue;
    if (!/^\d/.test(line)) continue;
    if (stats) stats.candidate++;
    const parsed = rowFromTextLine(line);
    if (parsed) out.push(parsed);
    else if (stats) stats.skipped++;
  }
  return out;
}

async function listPdfFilesSorted(dir: string): Promise<string[]> {
  try {
    const names = await readdir(dir);
    return names
      .filter((n) => n.toLowerCase().endsWith(".pdf"))
      .sort()
      .map((n) => path.join(dir, n));
  } catch {
    return [];
  }
}

async function resolvePdfPath(explicit?: string): Promise<string> {
  const cwd = process.cwd();
  if (explicit?.trim()) {
    const p = path.resolve(explicit.trim());
    await access(p, constants.R_OK);
    return p;
  }

  const defaultPdf = path.resolve(CITY_SD_FINANCE_UNCLAIMED_PDF_PATH);
  try {
    await access(defaultPdf, constants.R_OK);
    return defaultPdf;
  } catch {
    /* try fallbacks */
  }

  const baseName = path.basename(defaultPdf);
  const fallbackDirs = [
    path.join(cwd, "data", "city-san-diego-unclaimed"),
    path.join(cwd, "data", "city_san_diego_finance"),
    path.join(cwd, "real_data", "city_san_diego_finance"),
    path.join(cwd, "real_data", "city_of_san_diego_finance"),
  ];

  for (const d of fallbackDirs) {
    const named = path.join(d, baseName);
    try {
      await access(named, constants.R_OK);
      return path.resolve(named);
    } catch {
      /* continue */
    }
    const pdfs = await listPdfFilesSorted(d);
    if (pdfs.length >= 1) return path.resolve(pdfs[0]!);
  }

  throw new Error(
    `No PDF found. Expected ${defaultPdf} or a .pdf under: ${fallbackDirs.join(", ")}`,
  );
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

export async function importCitySanDiegoUnclaimedPdf(options?: {
  filePath?: string;
  truncate?: boolean;
}): Promise<void> {
  const cli = parseCliArgs();
  const truncate = options?.truncate ?? cli.truncate;

  if (!process.env.DATABASE_URL?.trim()) {
    console.error(`${LOG_PREFIX} DATABASE_URL is not set.`);
    process.exitCode = 1;
    return;
  }

  let pdfPath: string;
  try {
    pdfPath = await resolvePdfPath(options?.filePath ?? cli.file);
  } catch (e) {
    console.error(`${LOG_PREFIX}`, e);
    process.exitCode = 1;
    return;
  }

  const st = await stat(pdfPath);
  console.log(
    `${LOG_PREFIX} Resolved PDF: ${pdfPath} (${(st.size / 1024).toFixed(1)} KB)`,
  );

  const buf = await readFile(pdfPath);
  const data = new Uint8Array(buf);

  const t0 = Date.now();
  const parser = new PDFParse({ data });
  let tableRows: ParsedRow[] = [];
  let textRows: ParsedRow[] = [];
  const textStats = { candidate: 0, skipped: 0 };
  let mode: "table" | "text-regex" = "text-regex";

  try {
    const tableResult = await parser.getTable();
    tableRows = iterTableRowsPdf(tableResult);

    const textResult = await parser.getText();
    const docText =
      textResult.text ||
      (textResult.pages ?? []).map((p) => p.text).join("\n");
    textRows = iterTextRowsPdf(docText, textStats);

    let parsedRows: ParsedRow[];
    if (tableRows.length > 0) {
      parsedRows = tableRows;
      mode = "table";
    } else {
      parsedRows = textRows;
      mode = "text-regex";
    }

    console.log(
      `${LOG_PREFIX} ${path.basename(pdfPath)}: extraction=${mode}, ` +
        `table_rows=${tableRows.length.toLocaleString()}, ` +
        `text_rows=${textRows.length.toLocaleString()}, ` +
        `used=${parsedRows.length.toLocaleString()}`,
    );
    if (mode === "text-regex") {
      console.log(
        `${LOG_PREFIX} text lines: candidate=${textStats.candidate.toLocaleString()}, ` +
          `unparsed=${textStats.skipped.toLocaleString()}`,
      );
    }

    let skippedInvalid = 0;
    const byCheck = new Map<string, ParsedRow>();
    for (const r of parsedRows) {
      const check = r.check.trim();
      if (!check) {
        skippedInvalid++;
        continue;
      }
      byCheck.set(check, r);
    }
    const deduped = [...byCheck.values()];
    const rowsFound = parsedRows.length;
    const uniqueKeys = deduped.length;

    if (!deduped.length) {
      console.log(`${LOG_PREFIX} No rows extracted; check PDF layout.`);
      console.log(
        `${LOG_PREFIX} Summary: found=${rowsFound.toLocaleString()}, unique=${uniqueKeys.toLocaleString()}, ` +
          `inserted=0, skipped_invalid=${skippedInvalid.toLocaleString()}`,
      );
      return;
    }

    await ensureSourceRecordsFtsTable(prisma);

    if (truncate) {
      const del = await prisma.sourceRecord.deleteMany({
        where: { source: CITY_SD_FINANCE_UNCLAIMED_SOURCE_KEY },
      });
      console.log(
        `${LOG_PREFIX} Truncated source="${CITY_SD_FINANCE_UNCLAIMED_SOURCE_KEY}": ${del.count} rows removed`,
      );
    }

    let rowsInserted = 0;
    let rowsSkippedNoPayee = 0;
    let batch: Prisma.SourceRecordCreateManyInput[] = [];

    for (const r of deduped) {
      const payee = r.payee.trim();
      if (!payee) {
        rowsSkippedNoPayee++;
        continue;
      }

      const rawJson = JSON.stringify({
        checkNumber: r.check,
        checkDate: r.date,
        payee: r.payee,
        city: r.city,
        state: r.state,
        amount: r.amount,
        reportQuarterEnding: CITY_SD_FINANCE_REPORT_QUARTER_ENDING,
        updated: CITY_SD_FINANCE_UPDATED_LABEL,
        sourceUrl: SOURCE_URL,
        extractionMode: mode,
        propertyType: PROPERTY_TYPE,
      });

      batch.push({
        source: CITY_SD_FINANCE_UNCLAIMED_SOURCE_KEY,
        propertyId: r.check,
        ownerName: payee,
        ownerNameNormalized: normalizeText(payee),
        holderName: "",
        amount: amountToDbString(r.amount),
        address: null,
        city: r.city.trim() || null,
        state: r.state.trim() || null,
        zipCode: null,
        propertyType: PROPERTY_TYPE,
        rawJson,
      });

      if (batch.length >= INSERT_BATCH_SIZE) {
        rowsInserted += await flushBatch(batch);
        batch = [];
      }
    }
    rowsInserted += await flushBatch(batch);

    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
    console.log(
      `${LOG_PREFIX} Done — parsed=${rowsFound.toLocaleString()}, unique_check_numbers=${uniqueKeys.toLocaleString()}, ` +
        `inserted=${rowsInserted.toLocaleString()}, skipped_invalid=${skippedInvalid.toLocaleString()}, ` +
        `skipped_no_payee=${rowsSkippedNoPayee.toLocaleString()}, elapsed=${elapsed}s`,
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
    await parser.destroy().catch(() => undefined);
    await prisma.$disconnect();
  }
}

async function main() {
  await importCitySanDiegoUnclaimedPdf();
}

main().catch(() => {
  process.exit(1);
});
