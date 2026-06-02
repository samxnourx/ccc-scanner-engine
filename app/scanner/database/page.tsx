import { prisma } from "@/lib/scanner/db/client";
import {
  CA_SCO_SOURCE_KEY,
  CA_SCO_ESTATES_SOURCE_KEY,
  CITY_SD_FINANCE_UNCLAIMED_SOURCE_KEY,
  SD_COUNTY_AUDITOR_UNCLAIMED_SOURCE_KEY,
  SD_COUNTY_TTC_UNCLAIMED_SOURCE_KEY,
} from "@/lib/scanner/ca-sco-keys";

export const dynamic = "force-dynamic";

const SOURCE_LABELS: Record<string, string> = {
  [CA_SCO_SOURCE_KEY]: "California SCO",
  [CA_SCO_ESTATES_SOURCE_KEY]: "California SCO Estates",
  [CITY_SD_FINANCE_UNCLAIMED_SOURCE_KEY]: "City of San Diego Unclaimed Monies",
  [SD_COUNTY_AUDITOR_UNCLAIMED_SOURCE_KEY]:
    "San Diego County Auditor & Controller",
  [SD_COUNTY_TTC_UNCLAIMED_SOURCE_KEY]:
    "San Diego County Treasurer-Tax Collector",
};

type SourceRow = {
  source: string;
  n: bigint | number;
  lastImportedAt: bigint | Date | number | string | null;
};

const NON_CA_SCO_SOURCES = [
  CA_SCO_ESTATES_SOURCE_KEY,
  CITY_SD_FINANCE_UNCLAIMED_SOURCE_KEY,
  SD_COUNTY_AUDITOR_UNCLAIMED_SOURCE_KEY,
  SD_COUNTY_TTC_UNCLAIMED_SOURCE_KEY,
];

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function formatStamp(value: bigint | Date | number | string | null): string {
  if (!value) return "-";
  if (typeof value === "bigint") return value.toString();
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function cachedCaScoCount(): number | null {
  const n = Number.parseInt(process.env.CA_SCO_IMPORTED_ROW_COUNT || "", 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function redactedDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) return "-";
  if (raw.startsWith("file:")) return raw;
  try {
    const url = new URL(raw);
    if (url.username) url.username = "***";
    if (url.password) url.password = "***";
    return url.toString();
  } catch {
    return raw.replace(/\/\/([^:@/]+):([^@/]+)@/, "//***:***@");
  }
}

function sourceQueryErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Scanner database is unavailable.";
}

export default async function DatabaseStatusPage() {
  const caScoCached = cachedCaScoCount();
  const queryResults = await Promise.all(
    NON_CA_SCO_SOURCES.map((source) =>
      prisma
        .$queryRawUnsafe<SourceRow[]>(
          `SELECT ? AS source, COUNT(*) AS n, MAX(imported_at) AS lastImportedAt
           FROM source_records
           WHERE source = ?`,
          source,
          source,
        )
        .then((rows) => ({ rows, error: null as string | null }))
        .catch((error: unknown) => ({
          rows: [],
          error: sourceQueryErrorMessage(error),
        })),
    ),
  );
  const rows = queryResults.flatMap((result) => result.rows);
  const databaseError = queryResults.find((result) => result.error)?.error ?? null;

  const sources = [
    ...(caScoCached
      ? [
          {
            source: CA_SCO_SOURCE_KEY,
            n: caScoCached,
            lastImportedAt: null,
          },
        ]
      : []),
    ...rows.map((row) => ({
      source: row.source,
      n: Number(row.n),
      lastImportedAt: row.lastImportedAt,
    })),
  ];
  const total = sources.reduce((sum, row) => sum + row.n, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-neutral-950">
          Database Status
        </h1>
      </div>

      {databaseError ? (
        <section className="border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          The scanner database is not available in this environment. Local
          scanner data and imported source indexes are not automatically present
          on Vercel.
        </section>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="border border-[#b8b8b4] bg-white p-4">
          <p className="text-xs font-semibold uppercase text-neutral-600">
            Source records
          </p>
          <p className="mt-2 font-mono text-2xl font-semibold">
            {formatNumber(total)}
          </p>
        </div>
        <div className="border border-[#b8b8b4] bg-white p-4">
          <p className="text-xs font-semibold uppercase text-neutral-600">
            Catalog sources
          </p>
          <p className="mt-2 font-mono text-2xl font-semibold">
            {formatNumber(sources.length)}
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-neutral-900">
          Source catalogs
        </h2>
        <div className="overflow-x-auto border border-[#b8b8b4] bg-white">
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <thead className="bg-[#ececea] text-neutral-800">
              <tr>
                <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                  Source
                </th>
                <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                  Key
                </th>
                <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                  Records
                </th>
                <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                  Last imported
                </th>
              </tr>
            </thead>
            <tbody>
              {sources.map((row) => (
                <tr key={row.source}>
                  <td className="border-b border-[#e0e0dc] px-3 py-2 font-medium">
                    {SOURCE_LABELS[row.source] ?? row.source}
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-2 font-mono text-xs">
                    {row.source}
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-2 font-mono">
                    {formatNumber(row.n)}
                  </td>
                  <td className="border-b border-[#e0e0dc] px-3 py-2 whitespace-nowrap text-xs">
                    {formatStamp(row.lastImportedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="border border-[#b8b8b4] bg-white p-4 text-sm">
        <h2 className="text-base font-semibold text-neutral-900">Local paths</h2>
        <dl className="mt-3 grid gap-3">
          <div>
            <dt className="text-xs font-semibold uppercase text-neutral-600">
              Database
            </dt>
            <dd className="break-all font-mono text-xs text-neutral-900">
              {redactedDatabaseUrl()}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-neutral-600">
              California SCO CSV
            </dt>
            <dd className="break-all font-mono text-xs text-neutral-900">
              {process.env.CA_SCO_DATA_PATH || "-"}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
