"use client";

import { usePathname } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPublicOutreachPage = pathname.startsWith("/outreach/confirm/");

  if (isPublicOutreachPage) {
    return (
      <div className="min-h-full bg-[#f6f6f3] text-neutral-900">
        {children}
      </div>
    );
  }

  return (
    <div className="app-root-shell min-h-full bg-[#e8e8e6] text-neutral-900">
      <AppHeader />
      <div className="app-content-shell mx-auto max-w-6xl px-4 py-6">
        {children}
      </div>
    </div>
  );
}
