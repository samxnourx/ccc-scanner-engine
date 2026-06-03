"use client";

import { useMemo, useState } from "react";
import { useTransition } from "react";

import {
  saveLeadDiscoveryEmailAction,
  sendLeadDiscoveryTestEmailAction,
} from "@/app/actions/lead-discovery-actions";
import { sendLeadBusinessTestEmailAction } from "@/app/scanner/leads/lead-batch-actions";
import {
  searchProspectRelatedPropertiesAction,
  sendProspectEmailAction,
} from "@/app/scanner/prospects/prospect-actions";
import { formatUsdTotal, sumAmountFields } from "@/lib/scanner/amounts";
import { displayLeadOutreachSourceName } from "@/lib/scanner/lead-source-display";

export type LeadBusinessMatchVm = {
  id: number | string;
  sourceName: string;
  reportedOwnerName: string;
  holderName: string;
  propertyId: string;
  amount: string | null;
  reportedAddress: string;
  accountType: string | null;
  confidence: string;
  matchScore: number | null;
  notes: string;
};

type Props = {
  batchId?: number;
  businessId?: number;
  leadDiscoveryId?: string;
  prospectId?: number;
  businessName: string;
  emails: string[];
  matches: LeadBusinessMatchVm[];
};

const PRIVATE_FIRM_DISCLOSURE =
  "Sami Nouri Law Firm is a private law firm and is not affiliated with, approved by, or endorsed by the California State Controller's Office or any other government agency. You may search for and claim unclaimed property directly through the applicable government agency without using our services.";
const GOVERNMENT_AGENCY_CONTACT_TEXT =
  "California State Controller's Office Unclaimed Property Division\nPhone: (800) 992-4647 Nationwide; (916) 323-2827 Outside of U.S.\nMailing claims and general information: P.O. Box 942850, Sacramento, CA 94250-5873";
const FIRM_FOOTER_CONTACT_TEXT =
  "677 S Magnolia Ave\nEl Cajon, CA 92020\nPhone: 833-844-7700\nFax: 833-962-6175\nwww.SamiNouriLawFirm.com";
const CLAIM_ESCALATION_TEXT =
  "If a claim is unreasonably delayed, denied, or handled inconsistently with the supporting records, our role includes reviewing the agency's position, organizing the evidence, responding to follow-up requests, and escalating the matter when appropriate, including by bringing an action in Superior Court when legally warranted.";

function matchLine(m: LeadBusinessMatchVm): string {
  return [
    displayLeadOutreachSourceName(m.sourceName),
    m.reportedOwnerName,
    m.amount || "amount not listed",
    `Property ID ${m.propertyId}`,
    m.holderName ? `Holder: ${m.holderName}` : "",
    m.reportedAddress ? `Address: ${m.reportedAddress}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

function buildSubject(businessName: string, selectedTotal: number): string {
  return `${formatUsdTotal(selectedTotal)} - Possible unclaimed property records for ${businessName}`;
}

function buildDraft(input: {
  businessName: string;
  to: string;
  selectedMatches: LeadBusinessMatchVm[];
  selectedTotal: number;
}): string {
  const selectedTotalText = formatUsdTotal(input.selectedTotal);
  const lines =
    input.selectedMatches.length > 0
      ? input.selectedMatches.map((m) => `  - ${matchLine(m)}`).join("\n")
      : "  - Select one or more matches before sending.";

  return `Hello,

Sami Nouri Law Firm is contacting ${input.businessName} because our internal research identified possible unclaimed property records totaling ${selectedTotalText} that may relate to your organization.

What is unclaimed property?
Unclaimed property generally refers to funds or other property held by a business, agency, or institution that could not be delivered to the owner and was later reported to a public agency.

How we help:
Our team reviews public datasets across state, county, and municipal agencies, identifies possible matches, confirms the correct claim requirements, coordinates document collection through a secure client dashboard, prepares claim materials when authorized, and tracks follow-up with the agency. Some claims may require original documents, wet signatures, or agency-specific forms before submission.
${CLAIM_ESCALATION_TEXT}
Sami Nouri Law Firm handles this service for a 10% processing fee from recovered funds.

Possible listings for review (${input.selectedMatches.length.toLocaleString("en-US")}, totaling ${selectedTotalText}):
${lines}

If any listing appears to relate to your organization, please reply to this email and our unclaimed property team can provide next steps.

${PRIVATE_FIRM_DISCLOSURE}

Government agency contact information referenced:
${GOVERNMENT_AGENCY_CONTACT_TEXT}

If you prefer not to be contacted, reply asking us to stop and we will honor that request.

Thank you,

Sami Nouri Law Firm
Unclaimed Property Attorneys

${FIRM_FOOTER_CONTACT_TEXT}`;
}

export function MatchEmailDraftPanel({
  batchId,
  businessId,
  leadDiscoveryId,
  prospectId,
  businessName,
  emails,
  matches,
}: Props) {
  const [availableMatches, setAvailableMatches] =
    useState<LeadBusinessMatchVm[]>(matches);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [pending, startTransition] = useTransition();
  const [savePending, startSaveTransition] = useTransition();
  const [relatedPending, startRelatedTransition] = useTransition();
  const [sendMessage, setSendMessage] = useState<string | null>(null);
  const [emailMessage, setEmailMessage] = useState<string | null>(null);
  const [relatedQuery, setRelatedQuery] = useState("");
  const [relatedMessage, setRelatedMessage] = useState<string | null>(null);
  const [relatedResults, setRelatedResults] = useState<LeadBusinessMatchVm[]>([]);
  const [selectedRelated, setSelectedRelated] = useState<Record<string, boolean>>({});
  const primaryEmail = emails[0] ?? "";
  const [recipientEmail, setRecipientEmail] = useState(emails.join("\n"));

  const selectedMatches = useMemo(
    () => availableMatches.filter((m) => selected[String(m.id)]),
    [availableMatches, selected],
  );
  const listedTotal = useMemo(
    () => sumAmountFields(availableMatches.map((m) => m.amount)),
    [availableMatches],
  );
  const selectedTotal = useMemo(
    () => sumAmountFields(selectedMatches.map((m) => m.amount)),
    [selectedMatches],
  );

  const draft = useMemo(
    () =>
      buildDraft({
        businessName,
        to: recipientEmail.trim(),
        selectedMatches,
        selectedTotal,
      }),
    [businessName, recipientEmail, selectedMatches, selectedTotal],
  );
  const subject = useMemo(
    () => buildSubject(businessName, selectedTotal),
    [businessName, selectedTotal],
  );

  function toggle(id: number | string): void {
    const key = String(id);
    setSelected((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function setAll(value: boolean): void {
    const next: Record<string, boolean> = {};
    if (value) {
      for (const m of availableMatches) next[String(m.id)] = true;
    }
    setSelected(next);
  }

  function searchRelatedProperties(): void {
    if (prospectId == null) return;
    setRelatedMessage(null);
    startRelatedTransition(async () => {
      const result = await searchProspectRelatedPropertiesAction({
        prospectId,
        query: relatedQuery,
        excludeSourceRecordIds: availableMatches.map((match) => String(match.id)),
      });
      if (!result.ok) {
        setRelatedMessage(result.error);
        setRelatedResults([]);
        setSelectedRelated({});
        return;
      }
      setRelatedResults(result.matches);
      setSelectedRelated({});
      setRelatedMessage(
        result.matches.length === 0
          ? "No related properties found for that owner name."
          : `${result.matches.length.toLocaleString("en-US")} related properties found.`,
      );
    });
  }

  function toggleRelated(id: number | string): void {
    const key = String(id);
    setSelectedRelated((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function addSelectedRelated(): void {
    const additions = relatedResults.filter((match) => selectedRelated[String(match.id)]);
    if (additions.length === 0) {
      setRelatedMessage("Select at least one related property to add.");
      return;
    }
    const existingIds = new Set(availableMatches.map((match) => String(match.id)));
    const uniqueAdditions = additions.filter((match) => !existingIds.has(String(match.id)));
    setAvailableMatches((prev) => [...prev, ...uniqueAdditions]);
    setSelected((prev) => {
      const next = { ...prev };
      for (const match of uniqueAdditions) next[String(match.id)] = true;
      return next;
    });
    setRelatedResults((prev) =>
      prev.filter((match) => !uniqueAdditions.some((added) => String(added.id) === String(match.id))),
    );
    setSelectedRelated({});
    setRelatedMessage(
      `${uniqueAdditions.length.toLocaleString("en-US")} related properties added to this outreach package.`,
    );
  }

  function saveRecipientEmail(): void {
    if (!leadDiscoveryId) return;
    setEmailMessage(null);
    startSaveTransition(async () => {
      const result = await saveLeadDiscoveryEmailAction({
        id: leadDiscoveryId,
        email: recipientEmail,
      });
      setEmailMessage(result.ok ? result.message : result.error);
    });
  }

  function sendRecoveryEmail(): void {
    setSendMessage(null);
    startTransition(async () => {
      const result = leadDiscoveryId
        ? await sendLeadDiscoveryTestEmailAction({
            leadDiscoveryId,
            matchIds: selectedMatches.map((m) => String(m.id)),
            recipientEmail,
          })
        : prospectId != null
          ? await sendProspectEmailAction({
              prospectId,
              matchIds: selectedMatches.map((m) => String(m.id)),
              recipientEmail,
            })
          : batchId != null && businessId != null
          ? await sendLeadBusinessTestEmailAction({
              batchId,
              businessId,
              matchIds: selectedMatches
                .map((m) => Number(m.id))
                .filter((id) => Number.isFinite(id)),
              recipientEmail,
            })
          : { ok: false as const, error: "Lead context is missing." };
      setSendMessage(result.ok ? result.message : result.error);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border border-[#b8b8b4] bg-white p-4">
        <div className="text-sm text-neutral-800">
          <div>
            Imported email:{" "}
            {primaryEmail ? (
              <span className="font-mono text-xs">{primaryEmail}</span>
            ) : (
              <strong>no usable email imported</strong>
            )}
          </div>
          <label className="mt-3 block">
            <span className="mb-1 block text-xs uppercase text-neutral-600">
              Draft recipients
            </span>
            <textarea
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              rows={Math.max(2, Math.min(5, emails.length || 2))}
              placeholder="test@example.com"
              className="w-full min-w-[22rem] max-w-xl resize-y border border-[#b8b8b4] bg-white px-3 py-2 font-mono text-sm"
            />
          </label>
          {leadDiscoveryId ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={savePending}
                onClick={saveRecipientEmail}
                className="border border-[#6d6d68] bg-white px-3 py-1.5 text-xs font-medium hover:bg-[#ececea] disabled:opacity-50"
              >
                {savePending ? "Saving..." : "Save email"}
              </button>
              {emailMessage ? (
                <span className="text-xs text-neutral-700" role="status">
                  {emailMessage}
                </span>
              ) : null}
            </div>
          ) : null}
          <div className="mt-2 text-neutral-700">
            Select the matching property rows that should be grouped into the
            same outreach email.
          </div>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>
              Listed total:{" "}
              <strong className="text-neutral-950">
                {formatUsdTotal(listedTotal)}
              </strong>
            </span>
            <span>
              Selected total:{" "}
              <strong className="text-neutral-950">
                {formatUsdTotal(selectedTotal)}
              </strong>
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setAll(true)}
            className="border border-[#6d6d68] bg-[#ececea] px-3 py-2 text-sm font-medium hover:bg-[#e0e0dc]"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={() => setAll(false)}
            className="border border-[#6d6d68] bg-white px-3 py-2 text-sm font-medium hover:bg-[#ececea]"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="overflow-x-auto border border-[#b8b8b4] bg-white">
        <table className="w-full min-w-[1100px] border-collapse text-left text-sm">
          <thead className="bg-[#ececea] text-neutral-800">
            <tr>
              <th className="w-24 border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                Select
              </th>
              <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                Reported owner
              </th>
              <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                Amount
              </th>
              <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                Holder
              </th>
              <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                Property ID
              </th>
              <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                Address
              </th>
              <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                Confidence
              </th>
            </tr>
          </thead>
          <tbody>
            {availableMatches.map((m) => (
              <tr key={m.id}>
                <td className="border-b border-[#e0e0dc] px-3 py-2 align-top">
                  <input
                    type="checkbox"
                    checked={!!selected[String(m.id)]}
                    onChange={() => toggle(m.id)}
                    aria-label={`Select match ${m.propertyId}`}
                  />
                </td>
                <td className="border-b border-[#e0e0dc] px-3 py-2 align-top font-medium">
                  {m.reportedOwnerName}
                </td>
                <td className="border-b border-[#e0e0dc] px-3 py-2 align-top">
                  {m.amount || "-"}
                </td>
                <td className="border-b border-[#e0e0dc] px-3 py-2 align-top">
                  {m.holderName || "-"}
                </td>
                <td className="border-b border-[#e0e0dc] px-3 py-2 align-top font-mono text-xs">
                  {m.propertyId}
                </td>
                <td className="border-b border-[#e0e0dc] px-3 py-2 align-top">
                  {m.reportedAddress}
                </td>
                <td className="border-b border-[#e0e0dc] px-3 py-2 align-top">
                  {m.confidence}
                  {m.matchScore != null ? ` (${m.matchScore.toFixed(2)})` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {prospectId != null ? (
        <section className="border border-[#b8b8b4] bg-white p-4">
          <h2 className="text-base font-semibold text-neutral-950">
            Add related properties
          </h2>
          <p className="mt-1 text-sm text-neutral-700">
            Search another reported owner name, DBA, abbreviation, or old firm
            name, then add any matching rows to this same recovery offer.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="block min-w-[18rem] max-w-xl flex-1">
              <span className="mb-1 block text-xs uppercase text-neutral-600">
                Alternate owner name
              </span>
              <input
                type="text"
                value={relatedQuery}
                onChange={(event) => setRelatedQuery(event.target.value)}
                placeholder="DTLA Law Group"
                className="w-full border border-[#b8b8b4] bg-white px-3 py-2 text-sm"
              />
            </label>
            <button
              type="button"
              disabled={relatedPending || relatedQuery.trim().length < 2}
              onClick={searchRelatedProperties}
              className="border border-[#6d6d68] bg-[#ececea] px-3 py-2 text-sm font-medium hover:bg-[#e0e0dc] disabled:opacity-50"
            >
              {relatedPending ? "Searching..." : "Search related"}
            </button>
            <button
              type="button"
              disabled={relatedResults.length === 0}
              onClick={addSelectedRelated}
              className="border border-[#6d6d68] bg-white px-3 py-2 text-sm font-medium hover:bg-[#ececea] disabled:opacity-50"
            >
              Add selected
            </button>
          </div>
          {relatedMessage ? (
            <p className="mt-3 text-sm text-neutral-700" role="status">
              {relatedMessage}
            </p>
          ) : null}
          {relatedResults.length > 0 ? (
            <div className="mt-4 overflow-x-auto border border-[#b8b8b4]">
              <table className="w-full min-w-[960px] border-collapse text-left text-sm">
                <thead className="bg-[#ececea] text-neutral-800">
                  <tr>
                    <th className="w-24 border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                      Add
                    </th>
                    <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                      Reported owner
                    </th>
                    <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                      Amount
                    </th>
                    <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                      Holder
                    </th>
                    <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                      Property ID
                    </th>
                    <th className="border-b border-[#b8b8b4] px-3 py-2 font-semibold">
                      Address
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {relatedResults.map((m) => (
                    <tr key={m.id}>
                      <td className="border-b border-[#e0e0dc] px-3 py-2 align-top">
                        <input
                          type="checkbox"
                          checked={!!selectedRelated[String(m.id)]}
                          onChange={() => toggleRelated(m.id)}
                          aria-label={`Add related match ${m.propertyId}`}
                        />
                      </td>
                      <td className="border-b border-[#e0e0dc] px-3 py-2 align-top font-medium">
                        {m.reportedOwnerName}
                      </td>
                      <td className="border-b border-[#e0e0dc] px-3 py-2 align-top">
                        {m.amount || "-"}
                      </td>
                      <td className="border-b border-[#e0e0dc] px-3 py-2 align-top">
                        {m.holderName || "-"}
                      </td>
                      <td className="border-b border-[#e0e0dc] px-3 py-2 align-top font-mono text-xs">
                        {m.propertyId}
                      </td>
                      <td className="border-b border-[#e0e0dc] px-3 py-2 align-top">
                        {m.reportedAddress}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="grid gap-4">
        <div className="border border-[#b8b8b4] bg-white p-4">
          <div className="mb-2 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">
                Recovery offer ({selectedMatches.length.toLocaleString("en-US")} selected
                {" | "}
                {formatUsdTotal(selectedTotal)})
              </h2>
              <p className="mt-1 text-xs text-neutral-700">Subject: {subject}</p>
              <p className="mt-1 text-xs text-neutral-700">
                Sends a scanner-hosted confirmation link and offers SNLF help
                for a processing fee. The CMS claim is created only after the
                recipient confirms at least one property.
              </p>
            </div>
            <button
              type="button"
              disabled={pending || selectedMatches.length === 0 || !recipientEmail.trim()}
              onClick={sendRecoveryEmail}
              className="shrink-0 border border-[#6d6d68] bg-[#ececea] px-4 py-2 text-sm font-medium hover:bg-[#e0e0dc] disabled:opacity-50"
            >
              {pending ? "Sending..." : "Send recovery email"}
            </button>
          </div>
          <textarea
            value={`To: ${recipientEmail || "(add recipient)"}\nSubject: ${subject}\n\n${draft}`}
            readOnly
            className="h-80 w-full resize-y border border-[#b8b8b4] bg-[#fbfbfa] p-3 font-mono text-xs leading-5 text-neutral-900"
          />
        </div>

        {sendMessage ? (
          <p className="text-sm text-neutral-800" role="status">
            {sendMessage}
          </p>
        ) : null}
      </div>
    </div>
  );
}
