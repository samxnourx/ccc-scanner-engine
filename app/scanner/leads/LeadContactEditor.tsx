"use client";

import { type ReactNode, useState, useTransition } from "react";

import { updateLeadDiscoveryContactAction } from "@/app/actions/lead-discovery-actions";
import { updateLeadBusinessContactAction } from "@/app/scanner/leads/lead-batch-actions";
import { updateProspectContactAction } from "@/app/scanner/prospects/prospect-actions";

type BatchLeadInput = {
  kind: "batch";
  batchId: number;
  businessId: number;
  name: string;
  emails: string[];
  phone: string;
  website: string;
  mailingAddress: string;
  notes: string;
};

type DiscoveryLeadInput = {
  kind: "discovery";
  leadDiscoveryId: string;
  name: string;
  emails: string[];
  mailingAddress: string;
  phone: string;
  website: string;
  notes: string;
};

type ProspectLeadInput = {
  kind: "prospect";
  prospectId: number;
  name: string;
  emails: string[];
  phone: string;
  website: string;
  mailingAddress: string;
  notes: string;
};

type Props = {
  lead: BatchLeadInput | DiscoveryLeadInput | ProspectLeadInput;
  leadNameAddon?: ReactNode;
};

export function LeadContactEditor({ lead, leadNameAddon }: Props) {
  const [name, setName] = useState(lead.name);
  const [emails, setEmails] = useState(lead.emails.join("\n"));
  const [phone, setPhone] = useState(lead.phone);
  const [website, setWebsite] = useState(lead.website);
  const [mailingAddress, setMailingAddress] = useState(lead.mailingAddress);
  const [notes, setNotes] = useState(lead.notes);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(): void {
    setMessage(null);
    startTransition(async () => {
      const result =
        lead.kind === "batch"
          ? await updateLeadBusinessContactAction({
              batchId: lead.batchId,
              businessId: lead.businessId,
              businessName: name,
              emails,
              phone,
              website,
              mailingAddress,
              notes,
            })
          : lead.kind === "prospect"
            ? await updateProspectContactAction({
                prospectId: lead.prospectId,
                businessName: name,
                emails,
                phone,
                website,
                mailingAddress,
                notes,
              })
            : await updateLeadDiscoveryContactAction({
                id: lead.leadDiscoveryId,
                targetName: name,
                email: emails,
                phone,
                website,
                mailingAddress,
                notes,
              });
      setMessage(result.ok ? result.message : result.error);
    });
  }

  return (
    <div className="border border-[#b8b8b4] bg-white p-4 text-sm">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs uppercase text-neutral-600">
            Lead name
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border border-[#b8b8b4] bg-white px-3 py-2 text-sm"
          />
          {leadNameAddon}
        </label>
        <label className="block">
          <span className="mb-1 block text-xs uppercase text-neutral-600">
            Email addresses
          </span>
          <textarea
            value={emails}
            onChange={(e) => setEmails(e.target.value)}
            rows={3}
            placeholder="name@example.com"
            className="w-full resize-y border border-[#b8b8b4] bg-white px-3 py-2 font-mono text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs uppercase text-neutral-600">
            Phone
          </span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full border border-[#b8b8b4] bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs uppercase text-neutral-600">
            Website
          </span>
          <input
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            className="w-full border border-[#b8b8b4] bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="block md:col-span-2">
          <span className="mb-1 block text-xs uppercase text-neutral-600">
            Mailing address for letter
          </span>
          <textarea
            value={mailingAddress}
            onChange={(e) => setMailingAddress(e.target.value)}
            rows={3}
            placeholder={"Business Name\nStreet Address\nCity, ST ZIP"}
            className="w-full resize-y border border-[#b8b8b4] bg-white px-3 py-2 font-mono text-sm"
          />
        </label>
        <label className="block md:col-span-2">
          <span className="mb-1 block text-xs uppercase text-neutral-600">
            Notes
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="Internal notes about address source, entity status, contact attempts, or follow-up."
            className="w-full resize-y border border-[#b8b8b4] bg-white px-3 py-2 text-sm"
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={save}
          className="border border-[#6d6d68] bg-[#ececea] px-4 py-2 text-sm font-medium hover:bg-[#e0e0dc] disabled:opacity-50"
        >
          {pending ? "Saving..." : "Save lead info"}
        </button>
        {message ? (
          <span className="text-sm text-neutral-700" role="status">
            {message}
          </span>
        ) : null}
      </div>
    </div>
  );
}
