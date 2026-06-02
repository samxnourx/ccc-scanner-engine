import { timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  importLeadBatchRows,
  parseApiLeadImportBusinesses,
} from "@/lib/scanner/lead-batch-service";

/**
 * POST /api/leads/import
 *
 * Body: `{ batchName?: string, businesses: [...] }`
 *
 * Each business accepts `email` (primary), optional ordered deduped `emails[]`,
 * optional `emailsRaw`, plus prior optional fields (`website`, `phone`, …).
 */
export const runtime = "nodejs";

function isValidImportToken(header: string | null): boolean {
  const expected = process.env.LEAD_IMPORT_API_TOKEN?.trim();
  if (!expected) return false;
  const got = header?.trim() ?? "";
  try {
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(got, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function scannerBaseUrl(request: NextRequest): string {
  const env = process.env.NEXT_PUBLIC_SCANNER_BASE_URL?.trim();
  if (env) return env.replace(/\/$/, "");
  return request.nextUrl.origin;
}

export async function POST(request: NextRequest) {
  if (!isValidImportToken(request.headers.get("x-ccc-scanner-token"))) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { ok: false, error: "Expected a JSON object" },
      { status: 400 },
    );
  }

  const o = body as Record<string, unknown>;
  const batchName = String(o.batchName ?? "").trim();

  const rawBusinesses = o.businesses;
  if (Array.isArray(rawBusinesses)) {
    for (const item of rawBusinesses) {
      if (!item || typeof item !== "object") continue;
      const b = item as Record<string, unknown>;
      console.log("[lead import business payload]", {
        businessName: b.businessName,
        email: b.email,
        emails: b.emails,
        emailsRaw: b.emailsRaw,
      });
    }
  }

  try {
    const rows = parseApiLeadImportBusinesses(o.businesses);
    const { batchId } = await importLeadBatchRows({
      batchName: batchName || `Lead Scanner import ${new Date().toISOString()}`,
      rows,
    });
    const base = scannerBaseUrl(request);
    const batchUrl = `${base}/scanner/leads/batches/${batchId}`;
    return NextResponse.json({
      ok: true,
      batchId,
      businessCount: rows.length,
      batchUrl,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
