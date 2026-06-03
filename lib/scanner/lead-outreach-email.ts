import "server-only";

import { formatUsdTotal, sumAmountFields } from "@/lib/scanner/amounts";
import { displayLeadOutreachSourceName } from "@/lib/scanner/lead-source-display";

export type LeadOutreachEmailMatch = {
  sourceName: string;
  reportedOwnerName: string;
  holderName: string;
  propertyId: string;
  amount: string | null;
  reportedAddress: string;
  accountType?: string | null;
  confidence: string;
};

type LeadOutreachEmailInput = {
  businessName: string;
  recipientEmail: string;
  matches: LeadOutreachEmailMatch[];
  confirmUrl?: string;
};

const PRIVATE_FIRM_DISCLOSURE =
  "Sami Nouri Law Firm is a private law firm and is not affiliated with, approved by, or endorsed by the California State Controller's Office or any other government agency. You may search for and claim unclaimed property directly through the applicable government agency without using our services.";
const GOVERNMENT_AGENCY_CONTACT_TEXT =
  "California State Controller's Office Unclaimed Property Division\nPhone: (800) 992-4647 Nationwide; (916) 323-2827 Outside of U.S.\nMailing claims and general information: P.O. Box 942850, Sacramento, CA 94250-5873";
const FIRM_FOOTER_CONTACT_TEXT =
  "677 S Magnolia Ave\nEl Cajon, CA 92020\nPhone: 833-844-7700\nFax: 833-962-6175\nwww.SamiNouriLawFirm.com";
const CLAIM_ESCALATION_TEXT =
  "If a claim is unreasonably delayed, denied, or handled inconsistently with the supporting records, our role includes reviewing the agency's position, organizing the evidence, responding to follow-up requests, and escalating the matter when appropriate, including by bringing an action in Superior Court when legally warranted.";
const UNCLAIMED_PROPERTY_EXPLANATION =
  "Unclaimed property is usually money being held by a state or other government agency because it never reached the intended owner. Under unclaimed property laws, businesses and institutions must report and transfer certain unpaid funds to the government when they cannot deliver them. These records can include insurance payments, refunds, wage checks, bank balances, or other funds that people and businesses often never learn are waiting for them.";

function clean(value: string | null | undefined, fallback = ""): string {
  const v = String(value ?? "").trim();
  return v || fallback;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

function logoHtml(): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 26px;">
    <tr>
      <td class="header-logo" style="vertical-align:middle;padding-top:6px;">
        <img class="logo-light" src="cid:ccc-email-logo-light" width="340" alt="Sami Nouri Law Firm - Unclaimed Property Attorneys" style="display:block;width:340px;max-width:100%;height:auto;border:0;">
        <img class="logo-dark" src="cid:ccc-email-logo-dark" width="340" alt="Sami Nouri Law Firm - Unclaimed Property Attorneys" style="display:none;width:340px;max-width:100%;height:auto;border:0;max-height:0;overflow:hidden;mso-hide:all;">
      </td>
      <td class="header-contact" align="right" style="vertical-align:top;padding-top:12px;font-size:13px;line-height:1.45;color:#444;white-space:nowrap;">
        Sami Nouri Law Firm |<br>
        Unclaimed Property Attorneys<br>
        677 S Magnolia Ave<br>
        El Cajon, CA 92020<br>
        Phone: 833-844-7700<br>
        Fax: 833-962-6175<br>
        <a href="https://www.saminourilawfirm.com" style="color:#444;text-decoration:none;">www.SamiNouriLawFirm.com</a>
      </td>
    </tr>
  </table>`;
}

function governmentAgencyContactHtml(options: { includeWebsite?: boolean } = {}): string {
  return `<div style="margin:0 0 18px;padding:12px 14px;border:1px solid #d8d8d4;background-color:#fbfbfa;font-size:13px;line-height:1.45;color:#333;">
    <p style="margin:0 0 6px;font-weight:600;color:#1a1a1a;">Government agency contact information referenced:</p>
    <p style="margin:0;">California State Controller's Office Unclaimed Property Division</p>
    <p style="margin:0;">Phone: (800) 992-4647 Nationwide; (916) 323-2827 Outside of U.S.</p>
    <p style="margin:0;">Mailing claims and general information: P.O. Box 942850, Sacramento, CA 94250-5873</p>
    ${options.includeWebsite ? `<p style="margin:0;">Website: <a href="https://claimit.ca.gov" style="color:#333;text-decoration:underline;">claimit.ca.gov</a></p>` : ""}
  </div>`;
}

function firmFooterContactHtml(): string {
  return `<p style="margin:14px 0 18px;font-size:13px;line-height:1.45;color:#444;">
    677 S Magnolia Ave<br>
    El Cajon, CA 92020<br>
    Phone: 833-844-7700<br>
    Fax: 833-962-6175<br>
    <a href="https://www.saminourilawfirm.com" style="color:#444;text-decoration:none;">www.SamiNouriLawFirm.com</a>
  </p>`;
}

function textMatchLine(match: LeadOutreachEmailMatch): string {
  return [
    displayLeadOutreachSourceName(match.sourceName),
    clean(match.reportedOwnerName, "Reported owner not listed"),
    clean(match.amount, "Amount not listed"),
    `Property ID ${clean(match.propertyId, "not listed")}`,
    clean(match.holderName) ? `Holder: ${clean(match.holderName)}` : "",
    clean(match.reportedAddress) ? `Address: ${clean(match.reportedAddress)}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

function propertyRows(matches: LeadOutreachEmailMatch[]): string {
  return matches
    .map((match) => {
      const owner = escapeHtml(clean(match.reportedOwnerName, "Reported owner not listed"));
      const amount = escapeHtml(clean(match.amount, "Amount not listed"));
      const holder = escapeHtml(clean(match.holderName, "Holder not listed"));
      const propertyId = escapeHtml(clean(match.propertyId, "Not listed"));
      const address = escapeHtml(clean(match.reportedAddress, "Address not listed"));
      const source = escapeHtml(displayLeadOutreachSourceName(match.sourceName));
      const confidence = escapeHtml(clean(match.confidence, "possible"));

      return `<tr>
  <td style="padding:12px 0;border-top:1px solid #e6e6e2;">
    <p style="margin:0 0 4px;font-weight:600;color:#1a1a1a;">${owner}</p>
    <p style="margin:0 0 4px;color:#333;">${amount} &middot; ${holder}</p>
    <p style="margin:0 0 4px;font-size:13px;color:#555;">Property ID: ${propertyId}</p>
    <p style="margin:0 0 4px;font-size:13px;color:#555;">Address: ${address}</p>
    <p style="margin:0;font-size:12px;color:#666;">${source} &middot; Match confidence: ${confidence}</p>
  </td>
</tr>`;
    })
    .join("\n");
}

function nextStepsHtml(): string {
  const steps = [
    "Confirm properties and business information",
    "Complete the agreement",
    "We initiate the claim with the agency",
    "Upload requested documents in the client dashboard",
    "Complete any required wet signature or notarization",
    "We submit the claim package and track agency review",
    "Approved funds are mailed by the agency to your verified mailing address",
  ];

  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 22px;border:1px solid #deded9;background-color:#fbfbfa;">
    <tr>
      <td style="padding:14px 16px;">
        <p style="margin:0 0 10px;font-weight:600;color:#1a1a1a;">What happens next</p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
          ${steps
            .map(
              (step, index) => `<tr>
            <td width="30" style="padding:6px 10px 6px 0;vertical-align:top;">
              <span style="display:inline-block;width:22px;height:22px;border-radius:11px;background-color:#3d3d38;color:#ffffff;font-size:12px;line-height:22px;text-align:center;font-weight:600;">${index + 1}</span>
            </td>
            <td style="padding:6px 0;vertical-align:top;font-size:14px;line-height:1.4;color:#333;">${escapeHtml(step)}</td>
          </tr>`,
            )
            .join("\n")}
        </table>
      </td>
    </tr>
  </table>`;
}

export function buildLeadOutreachEmailPayload(
  input: LeadOutreachEmailInput,
): { subject: string; text: string; html: string } {
  const businessName = clean(input.businessName, "your organization");
  const recipient = clean(input.recipientEmail);
  const selectedTotal = sumAmountFields(input.matches.map((match) => match.amount));
  const selectedTotalText = formatUsdTotal(selectedTotal);
  const subject = `${selectedTotalText} - Possible unclaimed property records for ${businessName}`;
  const confirmUrl = clean(input.confirmUrl);
  const safeBusinessName = escapeHtml(businessName);
  const selectedCount = input.matches.length;

  const listingsText =
    selectedCount > 0
      ? input.matches.map((match) => `- ${textMatchLine(match)}`).join("\n")
      : "- No property rows were selected.";

  const nextStepText = confirmUrl
    ? [
        "Please use the secure link below to review the possible properties, confirm whether any belong to your organization, and provide the basic business information needed for our review team to evaluate next steps:",
        "",
        "Confirm your properties:",
        confirmUrl,
      ].join("\n")
    : "If any listing appears to relate to your organization, please reply to this email and our unclaimed property team can provide next steps.";

  const text = [
    `Hello,`,
    "",
    `Sami Nouri Law Firm is contacting ${businessName} because our internal research identified possible unclaimed property records totaling ${selectedTotalText} that may relate to your organization.`,
    "",
    "What is unclaimed property?",
    UNCLAIMED_PROPERTY_EXPLANATION,
    "",
    "How we help:",
    "Our team reviews public datasets across state, county, and municipal agencies, identifies possible matches, confirms the correct claim requirements, coordinates document collection through a secure client dashboard, prepares claim materials when authorized, and tracks follow-up with the agency. Some claims may require original documents, wet signatures, or agency-specific forms before submission.",
    CLAIM_ESCALATION_TEXT,
    "Sami Nouri Law Firm handles this service for a 10% processing fee from recovered funds.",
    "",
    `Possible listings for review (${selectedCount}, totaling ${selectedTotalText}):`,
    listingsText,
    "",
    "What happens next:",
    "1. Confirm properties and business information",
    "2. Complete the agreement",
    "3. We initiate the claim with the agency",
    "4. Upload requested documents in the client dashboard",
    "5. Complete any required wet signature or notarization",
    "6. We submit the claim package and track agency review",
    "7. Approved funds are mailed by the agency to your verified mailing address",
    "",
    nextStepText,
    "",
    PRIVATE_FIRM_DISCLOSURE,
    "",
    "Government agency contact information referenced:",
    GOVERNMENT_AGENCY_CONTACT_TEXT,
    "",
    "If you prefer not to be contacted, reply asking us to stop and we will honor that request.",
    "",
    "Thank you,",
    "",
    "Sami Nouri Law Firm",
    "Unclaimed Property Attorneys",
    "",
    FIRM_FOOTER_CONTACT_TEXT,
  ].join("\n");

  const buttonHtml = confirmUrl
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 16px;">
        <tr>
          <td style="border-radius:2px;background-color:#3d3d38;">
            <a href="${escapeAttr(confirmUrl)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;">Confirm your properties</a>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 6px;font-size:13px;color:#555;">Secure review link:</p>
      <p style="margin:0 0 20px;word-break:break-all;font-size:13px;color:#444;"><a href="${escapeAttr(confirmUrl)}" style="color:#333;text-decoration:underline;">${escapeHtml(confirmUrl)}</a></p>`
    : `<p style="margin:0 0 20px;">If any listing appears to relate to your organization, please reply to this email and our unclaimed property team can provide next steps.</p>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(subject)}</title>
<style>
  .logo-dark { display: none !important; max-height: 0 !important; overflow: hidden !important; mso-hide: all !important; }
  @media (prefers-color-scheme: dark) {
    .logo-light { display: none !important; max-height: 0 !important; overflow: hidden !important; }
    .logo-dark { display: block !important; max-height: none !important; overflow: visible !important; }
  }
  [data-ogsc] .logo-light { display: none !important; max-height: 0 !important; overflow: hidden !important; }
  [data-ogsc] .logo-dark { display: block !important; max-height: none !important; overflow: visible !important; }
  @media screen and (max-width: 640px) {
    .header-logo, .header-contact {
      display: block !important;
      width: 100% !important;
      text-align: left !important;
    }
    .header-contact {
      padding-top: 12px !important;
      white-space: normal !important;
    }
    .logo-light, .logo-dark {
      width: 100% !important;
      max-width: 430px !important;
      height: auto !important;
    }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f2;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#1a1a1a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f4f4f2;padding:28px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background-color:#ffffff;border:1px solid #d8d8d4;">
          <tr>
            <td style="padding:40px 26px 32px;">
              ${logoHtml()}
              <p style="margin:0 0 14px;">Hello,</p>
              <p style="margin:0 0 14px;">Sami Nouri Law Firm is contacting <strong>${safeBusinessName}</strong> because our internal research identified possible unclaimed property records totaling <strong>${escapeHtml(selectedTotalText)}</strong> that may relate to your organization.</p>
              <p style="margin:0 0 8px;font-weight:600;">What is unclaimed property?</p>
              <p style="margin:0 0 14px;">${escapeHtml(UNCLAIMED_PROPERTY_EXPLANATION)}</p>
              <p style="margin:0 0 8px;font-weight:600;">How Sami Nouri Law Firm helps</p>
              <p style="margin:0 0 10px;">Our team reviews public datasets across state, county, and municipal agencies, identifies possible matches, confirms the correct claim requirements, coordinates document collection through a secure client dashboard, prepares claim materials when authorized, and tracks follow-up with the agency. Some claims may require original documents, wet signatures, or agency-specific forms before submission.</p>
              <p style="margin:0 0 10px;">${escapeHtml(CLAIM_ESCALATION_TEXT)}</p>
              <p style="margin:0 0 18px;">Sami Nouri Law Firm handles this service for a <strong>10% processing fee</strong> from recovered funds.</p>
              <p style="margin:0 0 12px;">Our records review team identified ${selectedCount.toLocaleString("en-US")} possible listing${selectedCount === 1 ? "" : "s"} for review, totaling <strong>${escapeHtml(selectedTotalText)}</strong>:</p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px;border-bottom:1px solid #e6e6e2;">
                ${propertyRows(input.matches)}
              </table>
              ${nextStepsHtml()}
              ${buttonHtml}
              <p style="margin:0 0 14px;font-size:14px;color:#333;">${escapeHtml(PRIVATE_FIRM_DISCLOSURE)}</p>
              <p style="margin:0 0 22px;font-size:14px;color:#333;">If you prefer not to be contacted, reply asking us to stop and we will honor that request.</p>
              <p style="margin:0 0 4px;">Thank you,</p>
              <p style="margin:0 0 2px;font-weight:600;">Sami Nouri Law Firm</p>
              <p style="margin:0 0 2px;font-size:14px;color:#444;">Unclaimed Property Attorneys</p>
              ${firmFooterContactHtml()}
              ${governmentAgencyContactHtml()}
              ${recipient ? `<p style="margin:22px 0 0;padding-top:16px;border-top:1px solid #e6e6e2;font-size:12px;color:#666;">Sent to: ${escapeHtml(recipient)}</p>` : ""}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}

