import { NextRequest, NextResponse } from "next/server";

import {
  ensureEmailEnrichmentTable,
  runEmailEnrichment,
  type EmailEnrichmentTarget,
} from "@/lib/scanner/email-enrichment";
import { prisma } from "@/lib/scanner/db/client";
import { listLeadDiscoveries } from "@/lib/scanner/lead-discovery-store";
import {
  ensureScannerProspectsTable,
  parseProspectContactEmails,
} from "@/lib/scanner/prospect-discovery";

export const dynamic = "force-dynamic";

function parseLimit(request: NextRequest): number {
  const n = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "25", 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 250) : 25;
}

function parseEmailsJson(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map(String).map((s) => s.trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function collectTargets(limit: number): Promise<EmailEnrichmentTarget[]> {
  const targets: EmailEnrichmentTarget[] = [];

  const businesses = await prisma.leadBusiness.findMany({
    where: {
      outreachStatus: "approved_for_email",
    },
    orderBy: { importedAt: "desc" },
    take: Math.max(limit * 2, 25),
  });
  for (const business of businesses) {
    if (targets.length >= limit) break;
    const emails = [business.email, ...parseEmailsJson(business.emailsJson)]
      .map((email) => email.trim())
      .filter(Boolean);
    if (emails.length === 0) {
      targets.push({ type: "lead_business", id: String(business.id) });
    }
  }

  const discoveries = await listLeadDiscoveries();
  for (const lead of discoveries) {
    if (targets.length >= limit) break;
    if (
      ["detected", "reviewed", "approved_for_outreach"].includes(lead.status) &&
      !lead.outreachEmailTo
    ) {
      targets.push({ type: "lead_discovery", id: lead.leadDiscoveryId });
    }
  }

  await ensureScannerProspectsTable();
  const prospects = await prisma.$queryRawUnsafe<
    { id: number; contactEmailsJson: string | null }[]
  >(
    `SELECT id, contact_emails_json AS contactEmailsJson
     FROM scanner_prospects
     WHERE status = 'saved'
     ORDER BY total_amount DESC
     LIMIT ?`,
    Math.max(limit * 2, 25),
  );
  for (const prospect of prospects) {
    if (targets.length >= limit) break;
    if (parseProspectContactEmails(prospect.contactEmailsJson).length === 0) {
      targets.push({ type: "prospect", id: String(prospect.id) });
    }
  }

  return targets;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const limit = parseLimit(request);
    await ensureEmailEnrichmentTable();
    const targets = await collectTargets(limit);
    const results: Array<{
      target: EmailEnrichmentTarget;
      ok: boolean;
      status?: string;
      message?: string;
      error?: string;
    }> = [];

    for (const target of targets) {
      try {
        const result = await runEmailEnrichment(target);
        results.push({
          target,
          ok: true,
          status: result.status,
          message: result.message,
        });
      } catch (e) {
        results.push({
          target,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return NextResponse.json({
      ok: true,
      processed: results.length,
      results,
    });
  } catch (e) {
    console.error("[email-enrichment] saved runner failed", e);
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}
