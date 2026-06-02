/**
 * Conservative outreach copy for Lead Scanner to business email.
 * Staff review is still expected before sending.
 */

export function leadOutreachEmailSubject(businessName: string): string {
  const t = businessName.trim() || "your organization";
  return `Possible unclaimed property notice - ${t}`;
}

export function leadOutreachEmailBody(input: {
  businessName: string;
  matchSummaryLines: string[];
}): string {
  const name = input.businessName.trim() || "your organization";
  const lines = input.matchSummaryLines.length
    ? input.matchSummaryLines.slice(0, 8).map((l) => `  - ${l}`)
    : ["  - No catalog lines captured. Review the scanner batch in CCC Scanner."];

  return `Hello,

We are contacting ${name} because our internal research identified possible unclaimed property listings that may relate to your organization.

Sami Nouri Law Firm is a private law firm and is not affiliated with, approved by, or endorsed by the California State Controller's Office or any other government agency. You may search for and claim unclaimed property directly through the applicable government agency without using our services.

Possible listings:
${lines.join("\n")}

Nothing in this email guarantees that funds exist, that you are entitled to them, or that recovery will succeed.

If you prefer not to be contacted, reply asking us to stop and we will honor that request.

Sami Nouri Law Firm
Unclaimed Property Attorneys

677 S Magnolia Ave
El Cajon, CA 92020
Phone: 833-844-7700
Fax: 833-962-6175
www.SamiNouriLawFirm.com
`;
}
