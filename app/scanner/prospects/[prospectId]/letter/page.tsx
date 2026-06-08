import { notFound } from "next/navigation";

import {
  RecoveryLetterDocument,
  type RecoveryLetterMatch,
} from "@/app/scanner/leads/recovery-letter/RecoveryLetterDocument";
import "@/app/scanner/leads/recovery-letter/print.css";
import { letterheadLogoDataUrl } from "@/lib/scanner/letterhead-logo";
import {
  getScannerProspect,
  listProspectProperties,
  listProspectPropertiesBySourceRecordIds,
} from "@/lib/scanner/prospect-discovery";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ prospectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function parseMatchIds(raw: string | string[] | undefined): number[] {
  const value = Array.isArray(raw) ? raw.join(",") : raw ?? "";
  return [
    ...new Set(
      value
        .split(",")
        .map((id) => Number(id.trim()))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  ];
}

export default async function ProspectLetterPage({ params, searchParams }: Props) {
  const { prospectId: raw } = await params;
  const sp = await searchParams;
  const prospectId = Number.parseInt(raw, 10);
  if (!Number.isFinite(prospectId) || prospectId <= 0) notFound();

  const prospect = await getScannerProspect(prospectId);
  if (!prospect) notFound();

  const selectedIds = parseMatchIds(sp.matches);
  const rows =
    selectedIds.length > 0
      ? await listProspectPropertiesBySourceRecordIds(selectedIds)
      : await listProspectProperties(prospect);
  if (rows.length === 0) notFound();

  const matches: RecoveryLetterMatch[] = rows.map((row) => ({
    sourceName: row.sourceName,
    reportedOwnerName: row.reportedOwnerName,
    holderName: row.holderName,
    propertyId: row.propertyId,
    amount: row.amount,
    reportedAddress: row.reportedAddress,
    accountType: row.accountType,
  }));

  return (
    <RecoveryLetterDocument
      logoDataUrl={letterheadLogoDataUrl()}
      recipientName={prospect.displayName}
      recipientAddress={prospect.contactMailingAddress}
      matches={matches}
    />
  );
}
