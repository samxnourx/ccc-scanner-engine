import Link from "next/link";

import { submitScannerOutreachConfirmationAction } from "@/app/outreach/confirm/actions";
import { getPendingOutreachLeadByToken } from "@/lib/scanner/pending-outreach-store";

export const dynamic = "force-dynamic";

function cell(value: string | null | undefined): string {
  const v = String(value ?? "").trim();
  return v || "-";
}

function resultCopy(result: string, lead: Awaited<ReturnType<typeof getPendingOutreachLeadByToken>>) {
  if (!lead) return null;
  if (result === "converted") {
    return {
      title: "Property confirmation received",
      body: "Thank you. Your confirmed properties were sent to Sami Nouri Law Firm for next steps.",
    };
  }
  if (result === "no_confirmed") {
    return {
      title: "Property confirmation received",
      body: "Thank you. You did not confirm any of the listed properties, so no claim file was opened.",
    };
  }
  return null;
}

export default async function ScannerOutreachConfirmationPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ err?: string; result?: string }>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const lead = await getPendingOutreachLeadByToken(token);

  if (!lead) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold text-neutral-950">
          Link not found
        </h1>
        <p className="mt-3 text-sm text-neutral-700">
          This confirmation link is invalid or has expired.
        </p>
      </main>
    );
  }

  const done = resultCopy(query.result ?? "", lead);
  if (done || lead.status === "converted" || lead.status === "submitted_no_confirmed") {
    return (
      <main className="mx-auto max-w-xl px-4 py-16">
        <h1 className="text-2xl font-semibold text-neutral-950">
          {done?.title ?? "Property confirmation already received"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-neutral-700">
          {done?.body ??
            "This property confirmation has already been submitted."}
        </p>
        {lead.cmsDashboardUrl ? (
          <p className="mt-6 text-sm">
            <Link className="underline" href={lead.cmsDashboardUrl}>
              Open client dashboard
            </Link>
          </p>
        ) : null}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-neutral-950">
        Confirm possible unclaimed property
      </h1>
      <p className="mt-3 text-sm leading-6 text-neutral-700">
        Sami Nouri Law Firm identified possible unclaimed property records for{" "}
        <span className="font-medium text-neutral-950">{lead.businessName}</span>.
        Please review each item and mark whether it appears to belong to you or
        your organization.
      </p>

      {query.err === "incomplete" ? (
        <p className="mt-5 border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          Please answer every property before submitting.
        </p>
      ) : null}
      {query.err === "conversion" ? (
        <p className="mt-5 border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          Your responses were saved, but the claim file could not be opened
          automatically. Sami Nouri Law Firm can still review this submission.
        </p>
      ) : null}

      <form
        action={submitScannerOutreachConfirmationAction}
        className="mt-8 space-y-8"
      >
        <input type="hidden" name="token" value={lead.token} />

        {lead.selectedMatches.map((match) => (
          <section
            key={match.matchKey}
            className="border border-neutral-300 bg-white p-4"
          >
            <h2 className="text-base font-semibold text-neutral-950">
              Property ID {cell(match.propertyId)}
            </h2>
            <dl className="mt-4 grid gap-3 text-sm text-neutral-800 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <dt className="text-neutral-600">Reported owner</dt>
                <dd className="font-medium">{cell(match.reportedOwnerName)}</dd>
              </div>
              <div>
                <dt className="text-neutral-600">Holder</dt>
                <dd>{cell(match.holderName)}</dd>
              </div>
              <div>
                <dt className="text-neutral-600">Amount</dt>
                <dd>{cell(match.amount)}</dd>
              </div>
              <div>
                <dt className="text-neutral-600">Account type</dt>
                <dd>{cell(match.accountType)}</dd>
              </div>
              <div>
                <dt className="text-neutral-600">Source</dt>
                <dd>{cell(match.sourceName)}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-neutral-600">Reported address</dt>
                <dd>{cell(match.reportedAddress)}</dd>
              </div>
            </dl>

            <fieldset className="mt-5 space-y-2">
              <legend className="text-sm font-medium text-neutral-950">
                Does this appear to be yours?
              </legend>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`response_${match.matchKey}`}
                  value="confirmed"
                  required
                />
                Yes, this appears to be mine
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`response_${match.matchKey}`}
                  value="rejected"
                />
                No, this is not mine
              </label>
            </fieldset>
          </section>
        ))}

        <button
          type="submit"
          className="border border-neutral-900 bg-neutral-950 px-5 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Submit confirmation
        </button>
      </form>
    </main>
  );
}
