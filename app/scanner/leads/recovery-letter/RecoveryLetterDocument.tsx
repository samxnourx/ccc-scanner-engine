import { formatUsdTotal, sumAmountFields } from "@/lib/scanner/amounts";
import { displayLeadOutreachSourceName } from "@/lib/scanner/lead-source-display";
import { PrintLetterButton } from "./PrintLetterButton";

export type RecoveryLetterMatch = {
  sourceName: string;
  reportedOwnerName: string;
  holderName: string;
  propertyId: string;
  amount: string | null;
  reportedAddress: string;
  accountType?: string | null;
};

type Props = {
  logoDataUrl: string;
  recipientName: string;
  recipientAddress: string | null;
  matches: RecoveryLetterMatch[];
};

const UNCLAIMED_PROPERTY_EXPLANATION =
  "Unclaimed property is usually money being held by a state or other government agency because it never reached the intended owner. Under unclaimed property laws, businesses and institutions must report and transfer certain unpaid funds to the government when they cannot deliver them. These records can include insurance payments, refunds, wage checks, bank balances, or other funds that people and businesses often never learn are waiting for them.";

const CLAIM_ESCALATION_TEXT =
  "If a claim is unreasonably delayed, denied, or handled inconsistently with the supporting records, our role includes reviewing the agency's position, organizing the evidence, responding to follow-up requests, and escalating the matter when appropriate, including by bringing an action in Superior Court when legally warranted.";

const SCO_CONTACT = {
  agency: "California State Controller's Office",
  division: "Unclaimed Property Division",
  mailing: "P.O. Box 942850, Sacramento, CA 94250-5873",
  phone: "(800) 992-4647",
  website: "claimit.ca.gov",
};

function formatDate(): string {
  return new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function addressLines(address: string | null): string[] {
  return (address ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function compactSourceName(sourceName: string): string {
  const display = displayLeadOutreachSourceName(sourceName);
  return display === "California State Controller's Office" ? "CA SCO" : display;
}

export function RecoveryLetterDocument({
  logoDataUrl,
  recipientName,
  recipientAddress,
  matches,
}: Props) {
  const selectedTotal = sumAmountFields(matches.map((match) => match.amount));
  const totalText = formatUsdTotal(selectedTotal);
  const lines = addressLines(recipientAddress);

  return (
    <>
      <div className="print-toolbar no-print">
        <PrintLetterButton />
      </div>

    <article className="print-letter-root">
      <header className="letterhead">
        {/* eslint-disable-next-line @next/next/no-img-element -- Print letter embeds a local letterhead asset as a data URL. */}
        <img src={logoDataUrl} alt="Sami Nouri Law Firm Unclaimed Property Attorneys" />
        <div className="letterhead-contact">
          <div>Sami Nouri Law Firm |</div>
          <div>Unclaimed Property Attorneys</div>
          <div>677 S Magnolia Ave</div>
          <div>El Cajon, CA 92020</div>
          <div>Phone: 833-844-7700</div>
          <div>Fax: 833-962-6175</div>
          <div>www.SamiNouriLawFirm.com</div>
        </div>
      </header>

      <p className="letter-date">{formatDate()}</p>

      <section className="recipient-block">
        <div>{recipientName}</div>
        {lines.length > 0 ? (
          lines.map((line) => <div key={line}>{line}</div>)
        ) : (
          <div className="missing-address">[Add mailing address before printing]</div>
        )}
      </section>

      <p className="letter-subject">
        Re: Possible unclaimed property records totaling {totalText}
      </p>

      <p>Hello,</p>

      <p>
        This letter is to let you know that Sami Nouri Law Firm identified possible
        unclaimed property records that may relate to {recipientName}. Sami Nouri
        Law Firm is a private law firm that handles unclaimed property recovery
        matters.
      </p>

      <p>
        <strong>What is unclaimed property?</strong> {UNCLAIMED_PROPERTY_EXPLANATION}
      </p>

      <p>
        <strong>How we help.</strong> Our team reviews public datasets across
        state, county, and municipal agencies, identifies possible matches,
        confirms claim requirements, coordinates document collection, prepares
        claim materials when authorized, and tracks follow-up with the agency.
        Some claims may require original documents, wet signatures, notarization,
        or agency-specific forms before submission. {CLAIM_ESCALATION_TEXT}
      </p>

      <p>
        Sami Nouri Law Firm handles this service for a 10% processing fee from
        recovered funds.
      </p>

      <p>
        Our records review identified {matches.length.toLocaleString("en-US")}{" "}
        possible listing{matches.length === 1 ? "" : "s"} for review:
      </p>

      <table className="property-table">
        <colgroup>
          <col className="source-col" />
          <col className="owner-col" />
          <col className="address-col" />
          <col className="holder-col" />
          <col className="property-id-col" />
          <col className="amount-col" />
        </colgroup>
        <thead>
          <tr>
            <th>Source</th>
            <th>Reported owner</th>
            <th>Reported address</th>
            <th>Holder</th>
            <th>Property ID</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((match) => (
            <tr key={`${match.sourceName}-${match.propertyId}`}>
              <td>{compactSourceName(match.sourceName)}</td>
              <td>{match.reportedOwnerName}</td>
              <td>{match.reportedAddress || "-"}</td>
              <td>{match.holderName || "-"}</td>
              <td>{match.propertyId || "-"}</td>
              <td>{match.amount || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p>
        If you would like to discuss this matter, please contact us at
        claims@saminourilawfirm.com or call 833-844-7700 and leave a message with
        your name and the reason for your call. A member of our team will follow
        up.
      </p>

      <p className="private-firm-disclosure">
        Sami Nouri Law Firm is a private law firm and is not affiliated with,
        approved by, or endorsed by the California State Controller&apos;s Office
        or any other government agency. You may search for and claim unclaimed
        property directly through the applicable government agency without using
        our services.
      </p>

      <p>
        Thank you,
        <br />
        <br />
        Sami Nouri Law Firm
        <br />
        Unclaimed Property Attorneys
      </p>

      <section className="agency-contact-notice">
        <p>
          <strong>Government agency contact information referenced:</strong>
        </p>
        <div>{SCO_CONTACT.agency}</div>
        <div>{SCO_CONTACT.division}</div>
        <div>Mailing claims and general information: {SCO_CONTACT.mailing}</div>
        <div>Phone: {SCO_CONTACT.phone}</div>
        <div>Website: {SCO_CONTACT.website}</div>
      </section>
    </article>
    </>
  );
}
