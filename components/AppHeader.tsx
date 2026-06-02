import Link from "next/link";

export function AppHeader() {
  return (
    <header className="app-site-header border-b border-[#b8b8b4] bg-[#f1e4bd]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-2">
        <Link
          href="/scanner"
          className="text-sm font-semibold tracking-tight text-neutral-900 no-underline hover:underline"
        >
          Sami Nouri Law Firm | Unclaimed Property Database
        </Link>
        <nav className="flex flex-wrap gap-4 text-sm">
          <Link
            href="/scanner"
            className="text-neutral-800 underline-offset-2 hover:underline"
          >
            Scanner search
          </Link>
          <Link
            href="/scanner/queue"
            className="text-neutral-800 underline-offset-2 hover:underline"
          >
            Scan Queue
          </Link>
          <Link
            href="/scanner/leads"
            className="text-neutral-800 underline-offset-2 hover:underline"
          >
            Lead Dashboard
          </Link>
          <Link
            href="/scanner/prospects/candidates"
            className="text-neutral-800 underline-offset-2 hover:underline"
          >
            Candidate Database
          </Link>
          <Link
            href="/scanner/database"
            className="text-neutral-800 underline-offset-2 hover:underline"
          >
            Database Status
          </Link>
        </nav>
      </div>
    </header>
  );
}
