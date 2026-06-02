/**
 * San Diego County Auditor & Controller — unclaimed warrants (PDF set) → source_records.
 * Run: npm run import:sd-county-auditor -- [--dir <path>] [--file <path>] [--truncate]
 *
 * Legacy parity: clcc-watch/app/importers/import_sd_county_auditor.py
 */

import "./load-importer-env";
import { readdir } from "fs/promises";
import { access, constants, readFile, stat } from "fs/promises";
import path from "path";
import type { Prisma } from "@prisma/client";
import { PDFParse } from "pdf-parse";
import type { TableResult } from "pdf-parse";

import {
  SCANNER_FTS_SOURCE_KEYS,
  SD_COUNTY_AUDITOR_UNCLAIMED_SOURCE_KEY,
} from "../ca-sco-keys";
import { SD_COUNTY_AUDITOR_DATA_DIR } from "../config";
import { prisma } from "../db/client";
import {
  ensureSourceRecordsFtsTable,
  repopulateSourceRecordsFtsFromSourceRecords,
} from "../db/source-records-fts";
import { normalizeText } from "../normalizeText";

const LOG_PREFIX = "[sd-county-auditor-import]";
const INSERT_BATCH_SIZE = 80;
const PROPERTY_TYPE = "County Auditor Unclaimed Warrant";

const CLAIM_URL_PLACEHOLDER =
  "Pending — confirm current instructions at https://www.sandiegocounty.gov/auditor/";

const LAST_UPDATE_PATTERN = /last\s+update\s+(.+?)(?:\n|$)/i;

/** Warrant # (3+ digits), payee, M/D/YYYY, amount EOL — legacy regex. */
const TEXT_ROW_RE =
  /^(\d{3,})\s+(.*)\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+([\d,]+\.\d{2})\s*$/;

const EXPECTED_PDFS = [
  "sdcac a-c.pdf",
  "sdcac_a-c.pdf",
  "sdcac d-g.pdf",
  "sdcac_d-g.pdf",
  "sdcac h-m.pdf",
  "sdcac_h-m.pdf",
  "sdcac n-r.pdf",
  "sdcac_n-r.pdf",
  "sdcac s-z.pdf",
  "sdcac_s-z.pdf",
];

type ParsedRow = {
  warrant: string;
  payee: string;
  paymentDate: string;
  amount: number | null;
  sourcePdfFilename: string;
  alphabeticalRange: string;
};

function parseCliArgs(): {
  dir?: string;
  file?: string;
  truncate: boolean;
} {
  const args = process.argv.slice(2);
  let dir: string | undefined;
  let file: string | undefined;
  let truncate = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--truncate") truncate = true;
    else if (a.startsWith("--dir=")) dir = a.slice("--dir=".length);
    else if (a === "--dir" && args[i + 1]) dir = args[++i];
    else if (a.startsWith("--file=")) file = a.slice("--file=".length);
    else if (a === "--file" && args[i + 1]) file = args[++i];
  }
  return { dir, file, truncate };
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

function alphabeticalRangeFromFilename(filename: string): string {
  const stem = path.basename(filename, path.extname(filename)).trim().toLowerCase();
  if (!stem.startsWith("sdcac")) return "";
  const rest = stem.slice(5).replace(/^[\s_-]+/, "");
  return rest ? rest.toUpperCase().replace(/_/g, "-") : "";
}

function extractLastUpdateFromText(text: string): string | null {
  const m = LAST_UPDATE_PATTERN.exec(text ?? "");
  if (!m) return null;
  return m[1]!.trim();
}

function rowLooksLikeHeader(cells: (string | null | undefined)[]): boolean {
  const joined = cells
    .map((c) => cellStr(c).toLowerCase())
    .filter(Boolean)
    .join(" ");
  return joined.includes("warrant") && joined.includes("payee");
}

function rowIsData(cells: (string | null | undefined)[], ncols: number): boolean {
  if (!cells.length || cells.length < ncols) return false;
  const w = cellStr(cells[0]);
  if (!w || rowLooksLikeHeader(cells)) return false;
  if (["total", "totals", "subtotal"].includes(w.toLowerCase())) return false;
  return true;
}

function lineLooksLikeHeader(line: string): boolean {
  const u = line.toUpperCase();
  if (u.includes("LAST UPDATE")) return true;
  if (u.includes("WARRANT") && u.includes("CHECK")) return true;
  if (u.includes("PAYEE") && (u.includes("NAME") || u.includes("BUSINESS"))) {
    return true;
  }
  if (u.startsWith("PAYMENT DATE") || u.startsWith("PAYMENT AMOUNT")) {
    return true;
  }
  if (u.includes("PAGE ") && /^PAGE\s+\d+/i.test(u)) return true;
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

function iterTableRowsFromPdf(
  tableResult: TableResult,
  pdfFilename: string,
  alphaRange: string,
): ParsedRow[] {
  const out: ParsedRow[] = [];
  for (const table of collectTables(tableResult)) {
    let headerIdx: number | null = null;
    let ncols = 0;
    for (let i = 0; i < table.length; i++) {
      const row = table[i];
      if (!row?.length) continue;
      if (rowLooksLikeHeader(row)) {
        headerIdx = i;
        ncols = row.length;
        break;
      }
    }
    if (headerIdx === null || ncols < 4) continue;

    for (let i = headerIdx + 1; i < table.length; i++) {
      const row = table[i];
      if (!row?.length || row.length < 4) continue;
      if (!rowIsData(row, ncols)) continue;
      const warrant = cellStr(row[0]);
      const payee = cellStr(row[1]);
      const paymentDate = cellStr(row[2]);
      const amount = parseAmount(cellStr(row[3]));
      if (!warrant && !payee) continue;
      if (!warrant) continue;
      out.push({
        warrant,
        payee,
        paymentDate,
        amount,
        sourcePdfFilename: pdfFilename,
        alphabeticalRange: alphaRange,
      });
    }
  }
  return out;
}

function iterTextRowsFromPdf(
  fullText: string,
  pdfFilename: string,
  alphaRange: string,
): ParsedRow[] {
  const out: ParsedRow[] = [];
  for (const rawLine of fullText.split(/\r?\n/)) {
    const line = rawLine.replace(/[\t \u00a0]+/g, " ").trim();
    if (!line || lineLooksLikeHeader(line)) continue;
    if (!/^\d/.test(line)) continue;
    const m = TEXT_ROW_RE.exec(line);
    if (!m) continue;
    const warrant = m[1]!.trim();
    const payee = m[2]!.replace(/\s+/g, " ").trim();
    const paymentDate = m[3]!.trim();
    const amount = parseAmount(m[4]);
    if (!warrant) continue;
    out.push({
      warrant,
      payee,
      paymentDate,
      amount,
      sourcePdfFilename: pdfFilename,
      alphabeticalRange: alphaRange,
    });
  }
  return out;
}

async function listPdfFilesSorted(dir: string): Promise<string[]> {
  try {
    const names = await readdir(dir);
    return names
      .filter((n) => n.toLowerCase().endsWith(".pdf"))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      .map((n) => path.join(dir, n));
  } catch {
    return [];
  }
}

async function resolveImportTargets(options: {
  dir?: string;
  file?: string;
}): Promise<{ resolvedDir: string; pdfPaths: string[] }> {
  if (options.file?.trim()) {
    const f = path.resolve(options.file.trim());
    await access(f, constants.R_OK);
    const st = await stat(f);
    if (!st.isFile()) throw new Error(`Not a file: ${f}`);
    return { resolvedDir: path.dirname(f), pdfPaths: [f] };
  }

  const dir = path.resolve(options.dir?.trim() || SD_COUNTY_AUDITOR_DATA_DIR);
  await access(dir, constants.R_OK);
  const st = await stat(dir);
  if (!st.isDirectory()) throw new Error(`Not a directory: ${dir}`);

  const paths: string[] = [];
  for (const name of EXPECTED_PDFS) {
    const p = path.join(dir, name);
    try {
      await access(p, constants.R_OK);
      paths.push(p);
    } catch {
      /* missing expected name */
    }
  }

  if (paths.length === 0) {
    const found = await listPdfFilesSorted(dir);
    if (!found.length) {
      throw new Error(
        `No PDFs in ${dir}. Add sdcac_*.pdf files (see legacy real_data/san_diego_county_auditor).`,
      );
    }
    return { resolvedDir: dir, pdfPaths: found };
  }

  paths.sort((a, b) =>
    path.basename(a).localeCompare(path.basename(b), undefined, {
      sensitivity: "base",
    }),
  );
  return { resolvedDir: dir, pdfPaths: paths };
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

export async function importSdCountyAuditorPdfs(options?: {
  dir?: string;
  file?: string;
  truncate?: boolean;
}): Promise<void> {
  const cli = parseCliArgs();
  const truncate = options?.truncate ?? cli.truncate;

  if (!process.env.DATABASE_URL?.trim()) {
    console.error(`${LOG_PREFIX} DATABASE_URL is not set.`);
    process.exitCode = 1;
    return;
  }

  let resolvedDir: string;
  let pdfPaths: string[];
  try {
    ({ resolvedDir, pdfPaths } = await resolveImportTargets({
      dir: options?.dir ?? cli.dir,
      file: options?.file ?? cli.file,
    }));
  } catch (e) {
    console.error(`${LOG_PREFIX}`, e);
    process.exitCode = 1;
    return;
  }

  console.log(`${LOG_PREFIX} Resolved directory: ${resolvedDir}`);
  console.log(
    `${LOG_PREFIX} PDF files (${pdfPaths.length}): ${pdfPaths.map((p) => path.basename(p)).join(", ")}`,
  );

  const t0 = Date.now();
  const lastUpdateRef: { current: string | null } = { current: null };
  const allRows: ParsedRow[] = [];
  let skippedParseNoWarrant = 0;

  for (const pdfPath of pdfPaths) {
    const pdfFilename = path.basename(pdfPath);
    const alphaRange = alphabeticalRangeFromFilename(pdfFilename);
    const buf = await readFile(pdfPath);
    const data = new Uint8Array(buf);
    const parser = new PDFParse({ data });

    try {
      const textResult = await parser.getText();
      const fullText =
        textResult.text ||
        (textResult.pages ?? []).map((p) => p.text).join("\n");
      if (!lastUpdateRef.current) {
        const lu = extractLastUpdateFromText(fullText);
        if (lu) lastUpdateRef.current = lu;
      }

      const tableResult = await parser.getTable();
      const tableRows = iterTableRowsFromPdf(
        tableResult,
        pdfFilename,
        alphaRange,
      );
      const textRows = iterTextRowsFromPdf(
        fullText,
        pdfFilename,
        alphaRange,
      );

      const selected = tableRows.length > 0 ? tableRows : textRows;
      const mode = tableRows.length > 0 ? "table" : "text-regex";
      console.log(
        `${LOG_PREFIX} ${pdfFilename}: extraction=${mode}, ` +
          `table_rows=${tableRows.length.toLocaleString()}, ` +
          `text_rows=${textRows.length.toLocaleString()}, ` +
          `selected=${selected.length.toLocaleString()}`,
      );
      allRows.push(...selected);
    } catch (e) {
      console.error(`${LOG_PREFIX} Failed parsing ${pdfFilename}:`, e);
      throw e;
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  }

  const byWarrant = new Map<string, ParsedRow>();
  for (const r of allRows) {
    const wid = r.warrant.trim();
    if (!wid) {
      skippedParseNoWarrant++;
      continue;
    }
    byWarrant.set(wid, r);
  }
  const deduped = [...byWarrant.values()];
  const parsedRaw = allRows.length;

  if (!deduped.length) {
    console.log(
      `${LOG_PREFIX} No data rows extracted; check PDF layout or paths.`,
    );
    console.log(
      `${LOG_PREFIX} Summary: parsed_lines=${parsedRaw.toLocaleString()}, unique=0, inserted=0, ` +
        `skipped_no_warrant=${skippedParseNoWarrant.toLocaleString()}, ` +
        `elapsed=${((Date.now() - t0) / 1000).toFixed(2)}s`,
    );
    return;
  }

  await ensureSourceRecordsFtsTable(prisma);

  if (truncate) {
    const del = await prisma.sourceRecord.deleteMany({
      where: { source: SD_COUNTY_AUDITOR_UNCLAIMED_SOURCE_KEY },
    });
    console.log(
      `${LOG_PREFIX} Truncated source="${SD_COUNTY_AUDITOR_UNCLAIMED_SOURCE_KEY}": ${del.count} rows removed`,
    );
  }

  const lastUpdate = lastUpdateRef.current;
  let rowsInserted = 0;
  let rowsSkippedNoPayee = 0;
  let batch: Prisma.SourceRecordCreateManyInput[] = [];

  try {
    for (const r of deduped) {
      const payee = r.payee.trim();
      if (!payee) rowsSkippedNoPayee++;

      const rawJson = JSON.stringify({
        warrantNumber: r.warrant,
        payee: r.payee,
        paymentDate: r.paymentDate,
        amount: r.amount,
        sourcePdfFilename: r.sourcePdfFilename,
        alphabeticalRange: r.alphabeticalRange,
        lastUpdateDate: lastUpdate ?? "",
        claimInstructionsUrl: CLAIM_URL_PLACEHOLDER,
        propertyType: PROPERTY_TYPE,
      });

      batch.push({
        source: SD_COUNTY_AUDITOR_UNCLAIMED_SOURCE_KEY,
        propertyId: r.warrant,
        ownerName: payee || "Unknown payee",
        ownerNameNormalized: normalizeText(payee || "unknown payee"),
        holderName: "",
        amount: amountToDbString(r.amount),
        address: null,
        city: null,
        state: null,
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
      `${LOG_PREFIX} Done — parsed_rows=${parsedRaw.toLocaleString()}, ` +
        `unique_warrants=${deduped.length.toLocaleString()}, ` +
        `inserted=${rowsInserted.toLocaleString()}, ` +
        `skipped_no_warrant=${skippedParseNoWarrant.toLocaleString()}, ` +
        `empty_payee_rows=${rowsSkippedNoPayee.toLocaleString()}, ` +
        `elapsed=${elapsed}s`,
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
  await importSdCountyAuditorPdfs();
}

main().catch(() => {
  process.exit(1);
});
