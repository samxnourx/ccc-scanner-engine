/**
 * Recipient-facing Recovery Opportunity Report copy (print + preview).
 * Keep internal and staff-only language out of this module.
 */

export const ROR_ORG_PRIMARY = "Sami Nouri Law Firm";

export const ROR_TITLE = "Potential Recovery Opportunity Report";

/** Identifies SNLF as a private law-firm service; not government. */
export const ROR_IDENTITY_LINE =
  "Sami Nouri Law Firm provides private unclaimed property recovery assistance through The Legal Claims Center.";

export const ROR_ABOUT_TITLE = "About this report";

export const ROR_ABOUT_PARAS: readonly string[] = [
  "Government agencies and financial institutions sometimes transfer unclaimed funds or property to public agencies after periods of inactivity or unsuccessful contact attempts.",
  "Sami Nouri Law Firm reviewed publicly available unclaimed property records and identified potential matches that may relate to the individual or business listed in this report.",
  "This report is provided for informational purposes only. Recovery services are optional, and property owners may contact the applicable governmental agency directly without using any third-party service.",
];

export const ROR_MATCH_DETAIL_HEADING = "Match detail";

export const ROR_NEXT_STEPS_TITLE = "Next Steps";

export const ROR_NEXT_STEPS: readonly string[] = [
  "Review the potential matches listed in this report.",
  "Compare the reported owner, holder, property ID, amount, and address information with your records.",
  "Contact the applicable governmental agency directly if you wish to pursue the claim on your own.",
  "If you prefer assistance, Sami Nouri Law Firm can help evaluate the potential claim and coordinate the recovery process.",
];

export const ROR_HOW_CCC_ASSISTS_TITLE =
  "How Sami Nouri Law Firm Can Assist";

export const ROR_HOW_CCC_ASSISTS_PARAS: readonly string[] = [
  "Sami Nouri Law Firm assists with end-to-end unclaimed property recovery processing through The Legal Claims Center. This may include reviewing potential matches, identifying required claim documents, coordinating document collection, preparing claim materials, submitting claim packets when authorized, tracking agency responses, and assisting with follow-up until the matter is resolved.",
  "Recovery services are optional and subject to a separate written agreement.",
];

export const ROR_FILE_DIRECTLY_TITLE = "How to File Directly";

export const ROR_FILE_DIRECTLY_PARA =
  "You may also contact the applicable agency directly and pursue recovery without using Sami Nouri Law Firm or any third-party service. Agency contact information is listed below for convenience.";

export const ROR_AGENCY_CONTACT_SECTION_TITLE = "Agency Contact Information";

export const ROR_REQUIRED_DISCLOSURES_TITLE = "Required Disclosures";

export const ROR_REQUIRED_DISCLOSURES: readonly string[] = [
  "THIS PRODUCT OR SERVICE HAS NOT BEEN APPROVED OR ENDORSED BY ANY GOVERNMENTAL AGENCY, AND THIS OFFER IS NOT BEING MADE BY AN AGENCY OF THE GOVERNMENT.",
  "Sami Nouri Law Firm is a private law firm and is not a governmental agency. Sami Nouri Law Firm is not associated with any governmental agency referenced in this report.",
  "Property owners may contact the applicable governmental agency directly and may file claims without using any third-party service.",
];

export function plannedRecoveryReportEmailSubject(reportNumber: string): string {
  return `Sami Nouri Law Firm - Recovery Opportunity Report - ${reportNumber}`;
}

export const ROR_PLANNED_EMAIL_BODY =
  "Sami Nouri Law Firm identified public unclaimed property records that may match your name or organization. The attached report is provided for review. Sami Nouri Law Firm is not a governmental agency and is not associated with any governmental agency referenced in the report. You may contact the relevant agency directly if you wish to pursue the matter without using a third-party service.";
