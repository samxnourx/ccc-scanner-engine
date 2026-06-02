import type { NormalizedMatch } from "@/lib/scanner/types";
import { formatUsdTotal, sumAmountFields } from "@/lib/scanner/amounts";

type Props = {
  matches: NormalizedMatch[];
  /** e.g. `ror-match-table` for print CSS */
  tableClassName?: string;
};

/**
 * Recipient-facing match grid (six columns). Internal staff tables may include
 * additional columns (see LeadDiscoverySnapshotTable).
 */
export function RecoveryOpportunityMatchTable({
  matches,
  tableClassName = "",
}: Props) {
  if (matches.length === 0) {
    return (
      <p className="text-sm text-neutral-700">No matches in this saved opportunity.</p>
    );
  }

  const tc = ["w-full min-w-[720px] border-collapse text-left text-sm", tableClassName]
    .filter(Boolean)
    .join(" ");
  const totalAmount = sumAmountFields(matches.map((m) => m.amount));

  return (
    <div className="space-y-3">
      <div className="border border-neutral-200 px-3 py-2 text-sm">
        Listed total: <strong>{formatUsdTotal(totalAmount)}</strong>
      </div>
      <div className="overflow-x-auto border border-neutral-200">
        <table className={tc}>
          <thead className="bg-neutral-100">
            <tr>
              <th className="border-b border-neutral-300 px-2 py-2 font-semibold">
                Source
              </th>
              <th className="border-b border-neutral-300 px-2 py-2 font-semibold">
                Reported Owner
              </th>
              <th className="border-b border-neutral-300 px-2 py-2 font-semibold">
                Holder
              </th>
              <th className="border-b border-neutral-300 px-2 py-2 font-semibold">
                Property ID
              </th>
              <th className="border-b border-neutral-300 px-2 py-2 font-semibold">
                Amount
              </th>
              <th className="border-b border-neutral-300 px-2 py-2 font-semibold">
                Reported Address
              </th>
            </tr>
          </thead>
          <tbody>
            {matches.map((m, i) => (
              <tr key={`${m.id}-${i}`}>
                <td className="border-b border-neutral-200 px-2 py-2 align-top">
                  {m.sourceName}
                </td>
                <td className="border-b border-neutral-200 px-2 py-2 align-top">
                  {m.reportedOwnerName}
                </td>
                <td className="border-b border-neutral-200 px-2 py-2 align-top">
                  {m.holderName}
                </td>
                <td className="border-b border-neutral-200 px-2 py-2 align-top font-mono text-xs">
                  {m.propertyId}
                </td>
                <td className="border-b border-neutral-200 px-2 py-2 align-top">
                  {m.amount}
                </td>
                <td className="border-b border-neutral-200 px-2 py-2 align-top">
                  {m.reportedAddress}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
