import type { NormalizedMatch } from "@/lib/scanner/types";
import { formatUsdTotal, sumAmountFields } from "@/lib/scanner/amounts";

type Props = {
  matches: NormalizedMatch[];
};

export function LeadDiscoverySnapshotTable({ matches }: Props) {
  if (matches.length === 0) {
    return (
      <p className="text-sm text-neutral-700">No matches in this snapshot.</p>
    );
  }

  const totalAmount = sumAmountFields(matches.map((m) => m.amount));

  return (
    <div className="space-y-3">
      <div className="border border-[#b8b8b4] bg-white px-4 py-3 text-sm">
        Listed total:{" "}
        <strong className="text-neutral-950">
          {formatUsdTotal(totalAmount)}
        </strong>
      </div>
      <div className="overflow-x-auto border border-[#b8b8b4] bg-white">
        <table className="w-full min-w-[960px] border-collapse text-left text-sm">
          <thead className="bg-[#ececea] text-neutral-800">
            <tr>
              <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                Source
              </th>
              <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                Reported owner
              </th>
              <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                Holder
              </th>
              <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                Property ID
              </th>
              <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                Account type
              </th>
              <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                Amount
              </th>
              <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                Reported address
              </th>
              <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                Confidence
              </th>
              <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                Notes / reason
              </th>
            </tr>
          </thead>
          <tbody>
            {matches.map((row, i) => (
              <tr key={`${row.id}-${row.propertyId}-${i}`}>
                <td className="border-b border-[#e0e0dc] px-3 py-2 align-top">
                  {row.sourceName}
                </td>
                <td className="border-b border-[#e0e0dc] px-3 py-2 align-top">
                  {row.reportedOwnerName}
                </td>
                <td className="border-b border-[#e0e0dc] px-3 py-2 align-top">
                  {row.holderName}
                </td>
                <td className="border-b border-[#e0e0dc] px-3 py-2 align-top font-mono text-xs">
                  {row.propertyId}
                </td>
                <td className="border-b border-[#e0e0dc] px-3 py-2 align-top">
                  {row.propertyType || "-"}
                </td>
                <td className="border-b border-[#e0e0dc] px-3 py-2 align-top">
                  {row.amount}
                </td>
                <td className="border-b border-[#e0e0dc] px-3 py-2 align-top">
                  {row.reportedAddress}
                </td>
                <td className="border-b border-[#e0e0dc] px-3 py-2 align-top">
                  {row.confidence}
                </td>
                <td className="border-b border-[#e0e0dc] px-3 py-2 align-top text-neutral-800">
                  {row.notes}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
