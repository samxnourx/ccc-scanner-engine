import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/scanner/db/client";

export const dynamic = "force-dynamic";

function asPositiveInt(value: unknown): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function POST(request: Request) {
  let body: { leadBusinessId?: unknown; intakeId?: unknown };
  try {
    body = (await request.json()) as { leadBusinessId?: unknown; intakeId?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const leadBusinessId = asPositiveInt(body.leadBusinessId);
  const intakeId = typeof body.intakeId === "string" ? body.intakeId.trim() : "";
  if (!leadBusinessId) {
    return NextResponse.json(
      { ok: false, error: "leadBusinessId is required." },
      { status: 400 },
    );
  }

  const lead = await prisma.leadBusiness.findUnique({
    where: { id: leadBusinessId },
    select: { id: true, batchId: true, notes: true },
  });
  if (!lead) {
    return NextResponse.json({ ok: false, error: "Lead not found." }, { status: 404 });
  }

  await prisma.leadBusiness.update({
    where: { id: leadBusinessId },
    data: {
      outreachStatus: "responded",
      outreachIntakeId: intakeId || undefined,
      notes: `${lead.notes ? `${lead.notes}\n` : ""}[outreach] Client confirmed properties${intakeId ? ` for intake ${intakeId}` : ""} ${new Date().toISOString()}.`.slice(
        0,
        8000,
      ),
    },
  });

  revalidatePath("/scanner/leads");
  revalidatePath(`/scanner/leads/batches/${lead.batchId}`);
  revalidatePath(`/scanner/leads/batches/${lead.batchId}/businesses/${leadBusinessId}`);

  return NextResponse.json({ ok: true });
}
