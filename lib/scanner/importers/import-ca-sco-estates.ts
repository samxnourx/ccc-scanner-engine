/**
 * Import California SCO Estates workbook → SQLite `source_records` + FTS refresh.
 * Run: npm run import:ca-sco-estates -- [--file <path>] [--truncate]
 */

import "./load-importer-env";
import { readFileSync } from "fs";
import { access, constants, stat } from "fs/promises";
import path from "path";
import type { Prisma } from "@prisma/client";
import * as XLSX from "xlsx";

import {
  CA_SCO_ESTATES_SOURCE_KEY,
  SCANNER_FTS_SOURCE_KEYS,
} from "../ca-sco-keys";
import { CA_SCO_ESTATES_DATA_PATH } from "../config";
import { prisma } from "../db/client";
import {
  ensureSourceRecordsFtsTable,
  repopulateSourceRecordsFtsFromSourceRecords,
} from "../db/source-records-fts";
import { normalizeText } from "../normalizeText";

const LOG_PREFIX = "[ca-sco-estates-import]";
const INSERT_BATCH_SIZE = 80;
const PROGRESS_EVERY_ROWS = 50_000;
const HEADER_SCAN_ROWS = 50;
const DEFAULT_HEADER_FALLBACK = 1;

const H_PROPERTY_ID = "Property ID";
const H_E_NUMBER_VARIANTS = [
  "'E' Number",
  "E' Number",
  "'E' Number ",
  "\u2018E\u2019 Number",
];
const H_NAME = "Name";
const H_RELATION = "Relation To Property";
const H_ESTATE_RECEIVED = "Estate Received Date";
const H_DECEDENT_ALIAS = "Decedent Alias";
const H_ESCHEAT_DATE = "Escheat Date";
const H_ESCHEAT_COMMENT = "Escheat Comment";
const H_RECEIVED_DATE = "Received Date";
const H_PROBATE_DATE = "Probate Date";
const H_PROBATE_NUMBER = "Probate Number";
const H_AMOUNT = "Amount";
const H_CURRENT_BALANCE = "CurrentBalance";
const H_COUNTY = "County";

const PREFERRED_SHEETS = ["estates file", "estates", "estate file"];

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

function cellToStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "";
    if (Number.isInteger(v)) return String(v);
    return String(v);
  }
  const s = String(v).trim();
  if (s.toLowerCase() === "nan") return "";
  return s;
}

function normalizeEstatePropertyId(value: unknown): string {
  const t = cellToStr(value);
  if (!t) return "";
  const nocomma = t.replace(/,/g, "");
  const f = Number.parseFloat(nocomma);
  if (Number.isFinite(f) && Math.floor(f) === f) return String(Math.trunc(f));
  return t;
}

function normalizeEstateProbateNumber(value: unknown): string {
  return cellToStr(value);
}

function estateLookupKey(rawPid: unknown, rawProbate: unknown): [string, string] {
  return [
    normalizeEstatePropertyId(rawPid),
    normalizeEstateProbateNumber(rawProbate),
  ];
}

function countyInheritanceGroupKey(
  rawPropertyId: unknown,
  rawProbateNumber: unknown,
): [string, string] {
  const prob = normalizeEstateProbateNumber(rawProbateNumber);
  if (prob) return ["probate", prob];
  return ["property", normalizeEstatePropertyId(rawPropertyId)];
}

function relationNormLower(relation: string): string {
  return relation.trim().toLowerCase();
}

function relationIsDecedent(relation: string): boolean {
  return relationNormLower(relation) === "decedent";
}

function relationIsHeir(relation: string): boolean {
  return relationNormLower(relation) === "heir";
}

function relationKind(
  relation: string,
): "decedent" | "heir" | null {
  if (relationIsDecedent(relation)) return "decedent";
  if (relationIsHeir(relation)) return "heir";
  return null;
}

function parseCashBalance(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : null;
  }
  let text = String(raw).trim();
  if (!text || text.toLowerCase() === "nan") return null;
  text = text.replace(/\$/g, "").replace(/,/g, "");
  const n = Number.parseFloat(text);
  return Number.isFinite(n) ? n : null;
}

function uniquePreserve(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const t = n.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

function estateTotalBalance(balances: (number | null)[]): number | null {
  const vals = balances.filter(
    (b): b is number => b !== null && Number.isFinite(b),
  );
  if (vals.length === 0) return null;
  const rounded = new Set(vals.map((v) => Math.round(v * 100) / 100));
  if (rounded.size === 1) return vals[0]!;
  return vals.reduce((a, b) => a + b, 0);
}

type RowPayload = {
  excelOrder: number;
  groupKey: [string, string];
  rawPropertyId: string;
  rawProbateNumber: string;
  rawCounty: string;
  relationRaw: string;
  role: "decedent" | "heir" | null;
  ownerName: string;
  balance: number | null;
  row: Record<string, string>;
};

type EstateGroupContext = {
  associatedDecedent?: string;
  otherKnownHeirs?: string;
  estateRole?: string;
  estateTotalCurrentBalance?: string;
  estateGroupCounty?: string;
};

function resolveColumn(columns: string[], ...candidates: string[]): string | null {
  const stripped = new Map(columns.map((c) => [c.trim(), c]));
  for (const cand of candidates) {
    const key = cand.trim();
    const hit = stripped.get(key);
    if (hit !== undefined) return hit;
  }
  return null;
}

function resolveSheetName(wb: XLSX.WorkBook): string {
  const lower = new Map(wb.SheetNames.map((n) => [n.toLowerCase(), n]));
  for (const p of PREFERRED_SHEETS) {
    const hit = lower.get(p);
    if (hit) return hit;
  }
  return wb.SheetNames[0] ?? "Sheet1";
}

function findHeaderRowIndex(matrix: unknown[][]): number {
  const targetPid = H_PROPERTY_ID.trim();
  const targetName = H_NAME.trim();
  const max = Math.min(matrix.length, HEADER_SCAN_ROWS);
  for (let i = 0; i < max; i++) {
    const row = matrix[i];
    if (!row) continue;
    const vals = new Set<string>();
    for (const cell of row) {
      const s = cellToStr(cell);
      if (s) vals.add(s);
    }
    if (vals.has(targetPid) && vals.has(targetName)) return i;
  }
  return DEFAULT_HEADER_FALLBACK;
}

function matrixToObjects(
  matrix: unknown[][],
  headerRow: number,
): Record<string, string>[] {
  const headerCells = matrix[headerRow] ?? [];
  const bodyWidths = matrix.slice(headerRow + 1).map((r) => r?.length ?? 0);
  const width = Math.max(
    headerCells.length,
    bodyWidths.length > 0 ? Math.max(...bodyWidths) : 0,
  );
  const seen = new Map<string, number>();
  const uniqueHeaders: string[] = [];
  for (let c = 0; c < width; c++) {
    let key = cellToStr(headerCells[c]).trim();
    if (!key) key = `__col_${c}`;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    if (n > 0) key = `${key}__${n}`;
    uniqueHeaders.push(key);
  }

  const objects: Record<string, string>[] = [];
  for (let r = headerRow + 1; r < matrix.length; r++) {
    const row = matrix[r];
    if (!row) continue;
    const o: Record<string, string> = {};
    let any = false;
    for (let c = 0; c < uniqueHeaders.length; c++) {
      const hk = uniqueHeaders[c];
      const v = cellToStr(row[c]);
      if (v) any = true;
      o[hk] = v;
    }
    if (any) objects.push(o);
  }
  return objects;
}

function buildDecedentNamesByKey(payloads: RowPayload[]): Map<string, string[]> {
  const ordered = new Map<string, string[]>();
  const seen = new Map<string, Set<string>>();
  const sorted = [...payloads].sort((a, b) => a.excelOrder - b.excelOrder);

  for (const p of sorted) {
    if (!relationIsDecedent(p.relationRaw)) continue;
    const nm = p.ownerName.trim();
    if (!nm) continue;
    const gk = `${p.groupKey[0]}|${p.groupKey[1]}`;
    if (!seen.has(gk)) seen.set(gk, new Set());
    const s = seen.get(gk)!;
    const lk = nm.toLowerCase();
    if (s.has(lk)) continue;
    s.add(lk);
    if (!ordered.has(gk)) ordered.set(gk, []);
    ordered.get(gk)!.push(nm);
  }
  return ordered;
}

function buildGroupCountyByInheritanceKey(
  payloads: RowPayload[],
): Map<string, string> {
  const byKey = new Map<string, RowPayload[]>();
  for (const p of payloads) {
    const ck = countyInheritanceGroupKey(
      p.rawPropertyId,
      p.rawProbateNumber,
    ).join("|");
    if (!byKey.has(ck)) byKey.set(ck, []);
    byKey.get(ck)!.push(p);
  }
  const out = new Map<string, string>();
  for (const [ck, members] of byKey) {
    members.sort((a, b) => a.excelOrder - b.excelOrder);
    let county = "";
    for (const m of members) {
      if (m.role === "decedent") {
        const c = m.rawCounty.trim();
        if (c) {
          county = c;
          break;
        }
      }
    }
    if (!county) {
      for (const m of members) {
        const c = m.rawCounty.trim();
        if (c) {
          county = c;
          break;
        }
      }
    }
    if (county) out.set(ck, county);
  }
  return out;
}

function buildEstateContextByOrder(
  groupKey: [string, string],
  members: RowPayload[],
  decedentNamesByKey: Map<string, string[]>,
  groupCountyByInheritanceKey: Map<string, string>,
): Map<number, EstateGroupContext> {
  const gkStr = `${groupKey[0]}|${groupKey[1]}`;
  members.sort((a, b) => a.excelOrder - b.excelOrder);
  const decedentCsv = (decedentNamesByKey.get(gkStr) ?? []).join(", ");

  const heirNames = uniquePreserve(
    members.filter((m) => m.role === "heir").map((m) => m.ownerName),
  );
  const totalBal = estateTotalBalance(members.map((m) => m.balance));
  const totalStr =
    totalBal !== null ? totalBal.toFixed(2) : undefined;

  const out = new Map<number, EstateGroupContext>();
  for (const m of members) {
    const nm = m.ownerName.trim();
    const role = m.role;
    const roleLabel =
      role === "decedent" ? "Decedent" : role === "heir" ? "Heir" : "";

    let associatedDecedent: string | undefined;
    if (role === "heir" && decedentCsv) associatedDecedent = decedentCsv;

    let otherHeirs: string;
    if (role === "decedent") {
      otherHeirs = heirNames.filter((h) => h.toLowerCase() !== nm.toLowerCase()).join(", ");
    } else if (role === "heir") {
      otherHeirs = heirNames.filter((h) => h.toLowerCase() !== nm.toLowerCase()).join(", ");
    } else {
      otherHeirs = heirNames.join(", ");
    }

    const ckey = countyInheritanceGroupKey(
      m.rawPropertyId,
      m.rawProbateNumber,
    ).join("|");
    const gc = groupCountyByInheritanceKey.get(ckey) ?? "";

    const ctx: EstateGroupContext = {};
    if (associatedDecedent) ctx.associatedDecedent = associatedDecedent;
    if (otherHeirs) ctx.otherKnownHeirs = otherHeirs;
    if (roleLabel) ctx.estateRole = roleLabel;
    if (totalStr !== undefined) ctx.estateTotalCurrentBalance = totalStr;
    if (gc) ctx.estateGroupCounty = gc;

    out.set(m.excelOrder, ctx);
  }
  return out;
}

function amountFieldFromBalance(bal: number | null): string | null {
  if (bal === null || !Number.isFinite(bal)) return null;
  return bal.toFixed(2);
}

async function flushBatch(
  batch: Prisma.SourceRecordCreateManyInput[],
): Promise<number> {
  if (batch.length === 0) return 0;
  const result = await prisma.sourceRecord.createMany({ data: batch });
  return result.count;
}

export async function importCaScoEstatesXlsx(options?: {
  filePath?: string;
  truncate?: boolean;
}): Promise<void> {
  const cli = parseCliArgs();
  const xlsxPath = path.resolve(
    options?.filePath ?? cli.file ?? CA_SCO_ESTATES_DATA_PATH,
  );
  const truncate = options?.truncate ?? cli.truncate;

  console.log(`${LOG_PREFIX} Resolved workbook: ${xlsxPath}`);
  if (!process.env.DATABASE_URL?.trim()) {
    console.error(`${LOG_PREFIX} DATABASE_URL is not set.`);
    process.exitCode = 1;
    return;
  }

  try {
    await access(xlsxPath, constants.R_OK);
    const st = await stat(xlsxPath);
    console.log(
      `${LOG_PREFIX} File OK — ${(st.size / 1024).toFixed(1)} KB`,
    );
  } catch {
    console.error(`${LOG_PREFIX} File missing or unreadable: ${xlsxPath}`);
    process.exitCode = 1;
    return;
  }

  const t0 = Date.now();
  console.log(`${LOG_PREFIX} Reading workbook…`);
  const buf = readFileSync(xlsxPath);
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true, raw: false });
  const sheetName = resolveSheetName(wb);
  const sheet = wb.Sheets[sheetName];
  if (!sheet) {
    console.error(`${LOG_PREFIX} Sheet not found: ${sheetName}`);
    process.exitCode = 1;
    return;
  }

  const matrix = XLSX.utils.sheet_to_json<(string | number | undefined)[]>(
    sheet,
    { header: 1, defval: "", raw: true },
  ) as unknown[][];

  const headerRow = findHeaderRowIndex(matrix);
  console.log(
    `${LOG_PREFIX} Header row index=${headerRow} (spreadsheet row ${headerRow + 1})`,
  );

  const rows = matrixToObjects(matrix, headerRow);
  console.log(
    `${LOG_PREFIX} Data rows (non-empty): ${rows.length.toLocaleString()}`,
  );

  const columns = rows.length > 0 ? Object.keys(rows[0]!) : [];
  const cPid = resolveColumn(columns, H_PROPERTY_ID);
  const cName = resolveColumn(columns, H_NAME);
  const cBalance = resolveColumn(columns, H_CURRENT_BALANCE);
  const cE = resolveColumn(columns, ...H_E_NUMBER_VARIANTS);
  const cRelation = resolveColumn(columns, H_RELATION);
  const cEstateRecv = resolveColumn(columns, H_ESTATE_RECEIVED);
  const cAlias = resolveColumn(columns, H_DECEDENT_ALIAS);
  const cEscheatD = resolveColumn(columns, H_ESCHEAT_DATE);
  const cEscheatC = resolveColumn(columns, H_ESCHEAT_COMMENT);
  const cRecv = resolveColumn(columns, H_RECEIVED_DATE);
  const cProbD = resolveColumn(columns, H_PROBATE_DATE);
  const cProbN = resolveColumn(columns, H_PROBATE_NUMBER);
  const cAmount = resolveColumn(columns, H_AMOUNT);
  const cCounty = resolveColumn(columns, H_COUNTY);

  const required: [string, string | null][] = [
    [H_PROPERTY_ID, cPid],
    [H_NAME, cName],
    [H_CURRENT_BALANCE, cBalance],
    [H_RELATION, cRelation],
    [H_ESTATE_RECEIVED, cEstateRecv],
    [H_DECEDENT_ALIAS, cAlias],
    [H_ESCHEAT_DATE, cEscheatD],
    [H_ESCHEAT_COMMENT, cEscheatC],
    [H_RECEIVED_DATE, cRecv],
    [H_PROBATE_DATE, cProbD],
    [H_PROBATE_NUMBER, cProbN],
    [H_AMOUNT, cAmount],
    [H_COUNTY, cCounty],
  ];
  const missing = required.filter(([, col]) => !col).map(([name]) => name);
  if (missing.length > 0) {
    console.error(
      `${LOG_PREFIX} Missing required column(s): ${missing.join(", ")}; found: ${JSON.stringify(columns)}`,
    );
    process.exitCode = 1;
    return;
  }

  const payloads: RowPayload[] = [];
  let excelOrder = 0;
  for (const row of rows) {
    excelOrder++;
    const rawPid = cPid ? row[cPid] ?? "" : "";
    const rawProbate = cProbN ? row[cProbN] ?? "" : "";
    const rawCounty = cCounty ? row[cCounty] ?? "" : "";
    const relation = cRelation ? row[cRelation] ?? "" : "";
    const ownerName = cName ? row[cName] ?? "" : "";
    const balCell = cBalance ? row[cBalance] : "";
    const bal = parseCashBalance(balCell);

    payloads.push({
      excelOrder,
      groupKey: estateLookupKey(rawPid, rawProbate),
      rawPropertyId: rawPid,
      rawProbateNumber: rawProbate,
      rawCounty,
      relationRaw: relation,
      role: relationKind(relation),
      ownerName,
      balance: bal,
      row: { ...row },
    });
  }

  const byGroup = new Map<string, RowPayload[]>();
  for (const p of payloads) {
    const k = `${p.groupKey[0]}|${p.groupKey[1]}`;
    if (!byGroup.has(k)) byGroup.set(k, []);
    byGroup.get(k)!.push(p);
  }
  console.log(
    `${LOG_PREFIX} Grouping: ${payloads.length.toLocaleString()} rows → ${byGroup.size.toLocaleString()} estate groups`,
  );

  const decedentNamesByKey = buildDecedentNamesByKey(payloads);
  const groupCountyMap = buildGroupCountyByInheritanceKey(payloads);

  const contextByExcelOrder = new Map<number, EstateGroupContext>();
  for (const [, members] of byGroup) {
    const gkey = members[0]!.groupKey;
    const ctxMap = buildEstateContextByOrder(
      gkey,
      members,
      decedentNamesByKey,
      groupCountyMap,
    );
    for (const [ord, ctx] of ctxMap) contextByExcelOrder.set(ord, ctx);
  }

  await ensureSourceRecordsFtsTable(prisma);

  if (truncate) {
    const del = await prisma.sourceRecord.deleteMany({
      where: { source: CA_SCO_ESTATES_SOURCE_KEY },
    });
    console.log(
      `${LOG_PREFIX} Truncated source="${CA_SCO_ESTATES_SOURCE_KEY}": ${del.count} rows removed`,
    );
  }

  let rowsImported = 0;
  let rowsSkippedNoOwner = 0;
  let batch: Prisma.SourceRecordCreateManyInput[] = [];

  console.log(
    `${LOG_PREFIX} Inserting (batch ${INSERT_BATCH_SIZE}) — FTS sources: ${SCANNER_FTS_SOURCE_KEYS.join(", ")}`,
  );

  try {
    for (const p of payloads) {
      const ownerLine = p.ownerName.trim();
      if (!ownerLine) {
        rowsSkippedNoOwner++;
        continue;
      }

      let propertyId = p.rawPropertyId.trim();
      if (!propertyId) propertyId = `ESTATE-IMPORT-${p.excelOrder}`;

      const ctx = contextByExcelOrder.get(p.excelOrder) ?? {};

      const rawJson = JSON.stringify({
        excelRowOrder: p.excelOrder,
        relationToProperty: p.relationRaw.trim(),
        probateNumber: (cProbN ? p.row[cProbN] : "")?.trim() ?? "",
        probateDate: (cProbD ? p.row[cProbD] : "")?.trim() ?? "",
        receivedDate: (cRecv ? p.row[cRecv] : "")?.trim() ?? "",
        estateReceivedDate: (cEstateRecv ? p.row[cEstateRecv] : "")?.trim() ?? "",
        escheatDate: (cEscheatD ? p.row[cEscheatD] : "")?.trim() ?? "",
        escheatComment: (cEscheatC ? p.row[cEscheatC] : "")?.trim() ?? "",
        decedentAlias: (cAlias ? p.row[cAlias] : "")?.trim() ?? "",
        county: (cCounty ? p.row[cCounty] : "")?.trim() ?? "",
        amountColumn: (cAmount ? p.row[cAmount] : "")?.trim() ?? "",
        eNumber: (cE ? p.row[cE] : "")?.trim() ?? "",
        currentBalance: p.balance,
        estateGroup: ctx,
        rawRow: p.row,
      });

      batch.push({
        source: CA_SCO_ESTATES_SOURCE_KEY,
        propertyId,
        ownerName: ownerLine,
        ownerNameNormalized: normalizeText(ownerLine),
        holderName: "",
        amount: amountFieldFromBalance(p.balance),
        address: null,
        city: null,
        state: null,
        zipCode: null,
        propertyType: "Estate",
        rawJson,
      });

      if (batch.length >= INSERT_BATCH_SIZE) {
        rowsImported += await flushBatch(batch);
        batch = [];
      }

      if (p.excelOrder % PROGRESS_EVERY_ROWS === 0) {
        const sec = ((Date.now() - t0) / 1000).toFixed(1);
        console.log(
          `${LOG_PREFIX} Progress — processed: ${p.excelOrder.toLocaleString()}, inserted: ${rowsImported.toLocaleString()}, elapsed: ${sec}s`,
        );
      }
    }

    rowsImported += await flushBatch(batch);

    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
    console.log(
      `${LOG_PREFIX} Done — rows processed: ${payloads.length.toLocaleString()}; inserted: ${rowsImported.toLocaleString()}; skipped (no owner): ${rowsSkippedNoOwner.toLocaleString()}; elapsed: ${elapsed}s`,
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
  await importCaScoEstatesXlsx();
}

main().catch(() => {
  process.exit(1);
});
