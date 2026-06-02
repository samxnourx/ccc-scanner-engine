import { ScannerSearchForm } from "@/components/ScannerSearchForm";

export default function ScannerPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Scanner search</h1>
      </div>
      <div className="border border-[#b8b8b4] bg-white p-4">
        <ScannerSearchForm />
      </div>
    </div>
  );
}
