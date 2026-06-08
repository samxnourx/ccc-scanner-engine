import { notFound } from "next/navigation";

import {
  RecoveryLetterDocument,
  type RecoveryLetterMatch,
} from "@/app/scanner/leads/recovery-letter/RecoveryLetterDocument";
import "@/app/scanner/leads/recovery-letter/print.css";
import { getLeadDiscovery } from "@/lib/scanner/lead-discovery-store";
import { letterheadLogoDataUrl } from "@/lib/scanner/letterhead-logo";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ leadDiscoveryId: string }>;
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

export default async function SavedLeadLetterPage({ params, searchParams }: Props) {
  const { leadDiscoveryId } = await params;
  const sp = await searchParams;
  const id = decodeURIComponent(leadDiscoveryId).trim();
  if (!id) notFound();

  const lead = await getLeadDiscovery(id);
  if (!lead) notFound();

  const selectedIds = parseMatchIds(sp.matches);
  const sourceRows = lead.outreachMatches.length > 0 ? lead.outreachMatches : lead.matches;
  const rows =
    selectedIds.size > 0
      ? sourceRows.filter((match) => selectedIds.has(String(match.id)))
      : sourceRows;
  if (rows.length === 0) notFound();

  const matches: RecoveryLetterMatch[] = rows.map((match) => ({
    sourceName: match.sourceName,
    reportedOwnerName: match.reportedOwnerName,
    holderName: match.holderName,
    propertyId: match.propertyId,
    amount: match.amount,
    reportedAddress: match.reportedAddress,
    accountType: match.propertyType,
  }));

  return (
    <RecoveryLetterDocument
      logoDataUrl={letterheadLogoDataUrl()}
      recipientName={lead.targetName}
      recipientAddress={lead.mailingAddress}
      matches={matches}
    />
  );
}
