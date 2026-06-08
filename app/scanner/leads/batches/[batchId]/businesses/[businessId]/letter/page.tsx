import { notFound } from "next/navigation";

import { RecoveryLetterDocument, type RecoveryLetterMatch } from "@/app/scanner/leads/recovery-letter/RecoveryLetterDocument";
import "@/app/scanner/leads/recovery-letter/print.css";
import { prisma } from "@/lib/scanner/db/client";
import { letterheadLogoDataUrl } from "@/lib/scanner/letterhead-logo";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ batchId: string; businessId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function parseMatchIds(raw: string | string[] | undefined): Set<string> {
  const value = Array.isArray(raw) ? raw.join(",") : raw ?? "";
  return new Set(
    value
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

export default async function LeadBusinessLetterPage({ params, searchParams }: Props) {
  const { batchId: rawBatchId, businessId: rawBusinessId } = await params;
  const sp = await searchParams;
  const batchId = Number.parseInt(rawBatchId, 10);
  const businessId = Number.parseInt(rawBusinessId, 10);
  if (!Number.isFinite(batchId) || !Number.isFinite(businessId)) notFound();

  const lead = await prisma.leadBusiness.findFirst({
    where: { id: businessId, batchId },
    include: {
      matches: {
        orderBy: [
          { matchScore: "desc" },
          { confidence: "asc" },
          { id: "asc" },
        ],
      },
    },
  });
  if (!lead) notFound();

  const selectedIds = parseMatchIds(sp.matches);
  const rows = selectedIds.size > 0
    ? lead.matches.filter((match) => selectedIds.has(String(match.id)))
    : lead.matches;
  if (rows.length === 0) notFound();

  const matches: RecoveryLetterMatch[] = rows.map((match) => ({
    sourceName: match.sourceName,
    reportedOwnerName: match.reportedOwnerName,
    holderName: match.holderName,
    propertyId: match.propertyId,
    amount: match.amount,
    reportedAddress: match.reportedAddress,
    accountType: match.accountType,
  }));

  return (
    <RecoveryLetterDocument
      logoDataUrl={letterheadLogoDataUrl()}
      recipientName={lead.businessName}
      recipientAddress={lead.address}
      matches={matches}
    />
  );
}
