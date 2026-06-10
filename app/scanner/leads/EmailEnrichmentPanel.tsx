import {
  type EmailEnrichmentTargetType,
  getEmailEnrichmentResult,
  parseCheckedEmailUrls,
  parseEmailFindings,
} from "@/lib/scanner/email-enrichment";

import { EmailEnrichmentRunButton } from "./EmailEnrichmentRunButton";

type Props = {
  targetType: EmailEnrichmentTargetType;
  targetId: string;
  hasEmail: boolean;
  revalidatePaths: string[];
  compact?: boolean;
};

function formatStamp(value: string | null): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export async function EmailEnrichmentPanel({
  targetType,
  targetId,
  hasEmail,
  revalidatePaths,
  compact = false,
}: Props) {
  const result = await getEmailEnrichmentResult({ type: targetType, id: targetId }).catch(
    () => null,
  );
  const findings = result ? parseEmailFindings(result.emailCandidatesJson) : [];
  const checked = result ? parseCheckedEmailUrls(result.checkedUrlsJson) : [];
  const selectedEmail = result?.selectedEmail ?? null;

  if (compact) {
    return (
      <div className="mt-3 border border-[#d8d8d4] bg-[#fbfbfa] p-3 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">
              Email parser
            </h2>
            <p className="mt-1 text-xs text-neutral-700">
              Finds public business emails and records which URLs they came from.
              {hasEmail
                ? " This lead already has an email, but you can refresh the findings."
                : " This lead needs an email before outreach."}
            </p>
            {result ? (
              <p className="mt-2 text-xs text-neutral-600">
                Last run: {formatStamp(result.updatedAt)} | Status:{" "}
                {result.status.replace(/_/g, " ")}
              </p>
            ) : null}
          </div>
          <EmailEnrichmentRunButton
            targetType={targetType}
            targetId={targetId}
            revalidatePaths={revalidatePaths}
          />
        </div>
        {result ? (
          <p className="mt-2 text-xs text-neutral-700">{result.message}</p>
        ) : null}
      </div>
    );
  }

  return (
    <section className="border border-[#b8b8b4] bg-white p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-neutral-900">
            Email parser
          </h2>
          <p className="mt-1 text-neutral-700">
            Finds public business emails and records which URLs they came from.
            {hasEmail ? " This lead already has an email, but you can refresh the findings." : " This lead needs an email before outreach."}
          </p>
          {result ? (
            <p className="mt-2 text-xs text-neutral-600">
              Last run: {formatStamp(result.updatedAt)} | Status:{" "}
              {result.status.replace(/_/g, " ")}
            </p>
          ) : null}
        </div>
        <EmailEnrichmentRunButton
          targetType={targetType}
          targetId={targetId}
          revalidatePaths={revalidatePaths}
        />
      </div>

      {result ? (
        <div className="mt-4 space-y-4">
          <p className="text-neutral-800">{result.message}</p>
          <div>
            <h3 className="text-sm font-semibold">Emails found</h3>
            {checked.length > 0 ? (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-left text-xs">
                  <thead className="bg-[#ececea]">
                    <tr>
                      <th className="border border-[#d8d8d4] px-2 py-1.5">
                        URL
                      </th>
                      <th className="border border-[#d8d8d4] px-2 py-1.5">
                        Emails found
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {checked.map((item, index) => (
                      <tr key={`${item.url}-${index}`}>
                        <td className="border border-[#e0e0dc] px-2 py-1.5 align-top">
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            className="break-all underline-offset-2 hover:underline"
                          >
                            {item.url}
                          </a>
                          {item.error ? (
                            <p className="mt-1 text-neutral-500">{item.error}</p>
                          ) : null}
                        </td>
                        <td className="border border-[#e0e0dc] px-2 py-1.5 align-top font-mono">
                          {item.emails.length > 0 ? (
                            <div className="space-y-1">
                              {item.emails.map((email) => (
                                <p key={`${item.url}-${email}`}>
                                  {email}
                                  {email === selectedEmail ? (
                                    <span className="ml-2 font-sans text-neutral-600">
                                      selected
                                    </span>
                                  ) : null}
                                </p>
                              ))}
                            </div>
                          ) : (
                            <span className="font-sans text-neutral-500">
                              Nothing found
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-2 text-neutral-600">No URLs checked yet.</p>
            )}
            {findings.length === 0 && checked.length > 0 ? (
              <p className="mt-2 text-neutral-600">No usable emails found.</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
