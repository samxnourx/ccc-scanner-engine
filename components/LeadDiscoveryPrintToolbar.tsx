"use client";

/**
 * Browser print / “Save as PDF” (destination in the system print dialog).
 */
export function LeadDiscoveryPrintToolbar() {
  return (
    <div className="print-toolbar no-print mb-6 flex flex-wrap items-center gap-3 border border-[#b8b8b4] bg-[#ececea] p-3">
      <button
        type="button"
        onClick={() => window.print()}
        className="border border-[#6d6d68] bg-white px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-[#f5f5f3]"
      >
        Print / Save as PDF
      </button>
      <p className="max-w-xl text-xs text-neutral-700">
        Use your browser print dialog. Choose &quot;Save as PDF&quot; or
        &quot;Microsoft Print to PDF&quot; to generate a PDF file.
      </p>
    </div>
  );
}
