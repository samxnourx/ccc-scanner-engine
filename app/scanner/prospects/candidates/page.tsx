import Link from "next/link";

import { formatUsdTotal } from "@/lib/scanner/amounts";
import {
  type BusinessCandidateSort,
  getBusinessCandidateIndexStats,
  listBusinessCandidateGroups,
} from "@/lib/scanner/prospect-discovery";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(
  value: string | string[] | undefined,
  fallback: string,
): string {
  if (Array.isArray(value)) return value[0] ?? fallback;
  return value ?? fallback;
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function splitCsv(value: string | null, limit: number): string {
  if (!value) return "-";
  return value
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, limit)
    .join(", ");
}

function sortParam(value: string): BusinessCandidateSort {
  if (
    value === "business" ||
    value === "properties" ||
    value === "cities" ||
    value === "top"
  ) {
    return value;
  }
  return "total";
}

function sortLink(
  sp: URLSearchParams,
  sort: BusinessCandidateSort,
  currentSort: BusinessCandidateSort,
  currentDirection: "asc" | "desc",
): string {
  const next = new URLSearchParams(sp);
  next.set("sort", sort);
  next.set(
    "direction",
    currentSort === sort && currentDirection === "desc" ? "asc" : "desc",
  );
  next.set("page", "1");
  return `?${next.toString()}`;
}

export default async function CandidateDatabasePage({
  searchParams,
}: PageProps) {
  const sp = await searchParams;
  const name = firstParam(sp.name, "");
  const city = firstParam(sp.city, "");
  const holder = firstParam(sp.holder, "");
  const address = firstParam(sp.address, "");
  const minAmount = Math.max(
    Number.parseFloat(firstParam(sp.minAmount, "5000")) || 0,
    0,
  );
  const maxTotalRaw = Number.parseFloat(
    firstParam(sp.maxTotal, firstParam(sp.maxAmount, "")),
  );
  const maxTotal =
    Number.isFinite(maxTotalRaw) && maxTotalRaw > 0 ? maxTotalRaw : 0;
  const limit = Math.min(
    Math.max(Number.parseInt(firstParam(sp.limit, "250"), 10) || 250, 25),
    1000,
  );
  const page = Math.max(Number.parseInt(firstParam(sp.page, "1"), 10) || 1, 1);
  const offset = (page - 1) * limit;
  const sort = sortParam(firstParam(sp.sort, "total"));
  const direction = firstParam(sp.direction, "desc") === "asc" ? "asc" : "desc";
  const queryForLinks = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (Array.isArray(value)) {
      if (value[0] != null) queryForLinks.set(key, value[0]);
    } else if (value != null) {
      queryForLinks.set(key, value);
    }
  }

  const [stats, groups] = await Promise.all([
    getBusinessCandidateIndexStats().catch(() => ({
      exists: false,
      status: "unknown",
      lastSourceRecordId: 0,
      candidateCount: 0,
      sourceRecordCount: 0,
      sourceRecordTotalAmount: 0,
      sourceRecordValueLastId: 0,
      sourceValueStatsStatus: "not started",
      sourceValueStatsUpdatedAt: null,
      candidateTotalAmount: 0,
      updatedAt: null,
      completedAt: null,
    })),
    listBusinessCandidateGroups({
      name,
      city,
      holder,
      address,
      minAmount,
      maxAmount: maxTotal || undefined,
      limit,
      offset,
      sort,
      direction,
    }).catch(() => []),
  ]);
  const hasNextPage = groups.length === limit;
  const previousParams = new URLSearchParams(queryForLinks);
  previousParams.set("page", String(Math.max(page - 1, 1)));
  const nextParams = new URLSearchParams(queryForLinks);
  nextParams.set("page", String(page + 1));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-neutral-950">
          Candidate Database
        </h1>
        <p className="mt-1 text-sm text-neutral-700">
          Search the business-candidate index built from CA SCO records before
          those rows are promoted into saved leads.
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div className="min-w-0 border border-[#b8b8b4] bg-white p-4">
          <p className="text-xs font-semibold uppercase text-neutral-600">
            Total CA SCO value
          </p>
          <p className="mt-2 break-words font-mono text-xl font-semibold leading-tight xl:text-lg 2xl:text-xl">
            {formatUsdTotal(stats.sourceRecordTotalAmount)}
          </p>
          <p className="mt-1 text-xs text-neutral-600">
            {stats.sourceValueStatsStatus === "complete"
              ? `${formatNumber(stats.sourceRecordCount)} source rows`
              : `${formatNumber(stats.sourceRecordCount)} rows summed so far`}
          </p>
          <p className="mt-1 font-mono text-xs text-neutral-600">
            {stats.sourceValueStatsStatus === "not started"
              ? "not started"
              : `${stats.sourceValueStatsStatus} through row ${formatNumber(stats.sourceRecordValueLastId)}`}
          </p>
        </div>
        <div className="min-w-0 border border-[#b8b8b4] bg-white p-4">
          <p className="text-xs font-semibold uppercase text-neutral-600">
            Candidate value
          </p>
          <p className="mt-2 break-words font-mono text-xl font-semibold leading-tight xl:text-lg 2xl:text-xl">
            {formatUsdTotal(stats.candidateTotalAmount)}
          </p>
          <p className="mt-1 text-xs text-neutral-600">
            {formatNumber(stats.candidateCount)} indexed business rows
          </p>
        </div>
        <div className="min-w-0 border border-[#b8b8b4] bg-white p-4">
          <p className="text-xs font-semibold uppercase text-neutral-600">
            Candidate rows
          </p>
          <p className="mt-2 break-words font-mono text-xl font-semibold leading-tight xl:text-lg 2xl:text-xl">
            {formatNumber(stats.candidateCount)}
          </p>
        </div>
        <div className="min-w-0 border border-[#b8b8b4] bg-white p-4">
          <p className="text-xs font-semibold uppercase text-neutral-600">
            Index status
          </p>
          <p className="mt-2 text-sm font-medium capitalize">{stats.status}</p>
        </div>
        <div className="min-w-0 border border-[#b8b8b4] bg-white p-4">
          <p className="text-xs font-semibold uppercase text-neutral-600">
            Source
          </p>
          <p className="mt-2 text-sm font-medium">California SCO</p>
          <p className="mt-1 font-mono text-xs text-neutral-600">
            through row {formatNumber(stats.lastSourceRecordId)}
          </p>
        </div>
      </section>

      <form className="border border-[#b8b8b4] bg-white p-4 text-sm">
        <div className="grid gap-3 md:grid-cols-[1fr_10rem_1fr_1fr_9rem_9rem_7rem_auto]">
          <label>
            <span className="mb-1 block text-xs uppercase text-neutral-600">
              Business name
            </span>
            <input
              name="name"
              defaultValue={name}
              placeholder="Medical, Dental, Pharmacy..."
              className="w-full border border-[#b8b8b4] bg-white px-3 py-2"
            />
          </label>
          <label>
            <span className="mb-1 block text-xs uppercase text-neutral-600">
              City
            </span>
            <input
              name="city"
              defaultValue={city}
              placeholder="San Diego"
              className="w-full border border-[#b8b8b4] bg-white px-3 py-2"
            />
          </label>
          <label>
            <span className="mb-1 block text-xs uppercase text-neutral-600">
              Holder
            </span>
            <input
              name="holder"
              defaultValue={holder}
              placeholder="Wells Fargo..."
              className="w-full border border-[#b8b8b4] bg-white px-3 py-2"
            />
          </label>
          <label>
            <span className="mb-1 block text-xs uppercase text-neutral-600">
              Address
            </span>
            <input
              name="address"
              defaultValue={address}
              placeholder="Street contains..."
              className="w-full border border-[#b8b8b4] bg-white px-3 py-2"
            />
          </label>
          <label>
            <span className="mb-1 block text-xs uppercase text-neutral-600">
              Min total
            </span>
            <input
              name="minAmount"
              defaultValue={String(minAmount)}
              className="w-full border border-[#b8b8b4] bg-white px-3 py-2"
            />
          </label>
          <label>
            <span className="mb-1 block text-xs uppercase text-neutral-600">
              Max total
            </span>
            <input
              name="maxTotal"
              defaultValue={maxTotal ? String(maxTotal) : ""}
              placeholder="Optional"
              className="w-full border border-[#b8b8b4] bg-white px-3 py-2"
            />
          </label>
          <label>
            <span className="mb-1 block text-xs uppercase text-neutral-600">
              Show
            </span>
            <input
              name="limit"
              defaultValue={String(limit)}
              className="w-full border border-[#b8b8b4] bg-white px-3 py-2"
            />
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              className="border border-[#6d6d68] bg-[#ececea] px-4 py-2 font-medium hover:bg-[#e0e0dc]"
            >
              Search
            </button>
          </div>
        </div>
      </form>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
          <h2 className="text-lg font-semibold text-neutral-900">
            Matching businesses
          </h2>
          <p className="mt-1 text-sm text-neutral-700">
            Showing page {formatNumber(page)} with {formatNumber(groups.length)} grouped
            businesses from the candidate table.
          </p>
          </div>
          <div className="flex gap-2 text-sm">
            {page > 1 ? (
              <Link
                href={`?${previousParams.toString()}`}
                className="border border-[#6d6d68] bg-white px-3 py-1.5 font-medium hover:bg-[#ececea]"
              >
                Previous
              </Link>
            ) : null}
            {hasNextPage ? (
              <Link
                href={`?${nextParams.toString()}`}
                className="border border-[#6d6d68] bg-white px-3 py-1.5 font-medium hover:bg-[#ececea]"
              >
                Next
              </Link>
            ) : null}
          </div>
        </div>
        <div className="overflow-x-auto border border-[#b8b8b4] bg-white">
          <table className="w-full min-w-[1100px] border-collapse text-left text-sm">
            <thead className="bg-[#ececea] text-neutral-800">
              <tr>
                <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                  <Link
                    href={sortLink(queryForLinks, "business", sort, direction)}
                    className="underline-offset-2 hover:underline"
                  >
                    Business
                  </Link>
                </th>
                <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                  <Link
                    href={sortLink(queryForLinks, "total", sort, direction)}
                    className="underline-offset-2 hover:underline"
                  >
                    Total
                  </Link>
                </th>
                <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                  <Link
                    href={sortLink(queryForLinks, "properties", sort, direction)}
                    className="underline-offset-2 hover:underline"
                  >
                    Properties
                  </Link>
                </th>
                <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                  <Link
                    href={sortLink(queryForLinks, "cities", sort, direction)}
                    className="underline-offset-2 hover:underline"
                  >
                    Cities / addresses
                  </Link>
                </th>
                <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                  <Link
                    href={sortLink(queryForLinks, "top", sort, direction)}
                    className="underline-offset-2 hover:underline"
                  >
                    Top property
                  </Link>
                </th>
                <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="border-b border-[#e0e0dc] px-3 py-6 text-center text-neutral-600"
                  >
                    No candidate businesses found for these filters.
                  </td>
                </tr>
              ) : null}
              {groups.map((group) => (
                <tr key={`${group.source}-${group.ownerNameNormalized}`}>
                  <td className="border-b border-[#e0e0dc] px-3 py-3 align-top font-medium">
                    {group.displayName}
                    <p className="mt-1 font-mono text-xs text-neutral-500">
                      {group.ownerNameNormalized}
                    </p>
                  </td>
                  <td className="whitespace-nowrap border-b border-[#e0e0dc] px-3 py-3 align-top font-mono font-semibold">
                    {formatUsdTotal(group.totalAmount)}
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-3 align-top">
                    {formatNumber(group.propertyCount)}
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-3 align-top text-xs">
                    <p>
                      {group.cityCount} cit{group.cityCount === 1 ? "y" : "ies"}:{" "}
                      {splitCsv(group.citiesCsv, 4)}
                    </p>
                    <p className="mt-1">
                      {group.addressCount} address
                      {group.addressCount === 1 ? "" : "es"}:{" "}
                      {splitCsv(group.addressesCsv, 2)}
                    </p>
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-3 align-top text-xs">
                    <p className="font-mono font-semibold">
                      {group.topAmount == null
                        ? "-"
                        : formatUsdTotal(group.topAmount)}
                    </p>
                    <p>{group.topHolder || "-"}</p>
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-3 align-top">
                    <Link
                      href={`/scanner/prospects/candidates/${encodeURIComponent(
                        group.ownerNameNormalized,
                      )}?source=${encodeURIComponent(group.source)}`}
                      className="inline-block border border-[#6d6d68] bg-white px-3 py-1.5 text-sm font-medium hover:bg-[#ececea]"
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
