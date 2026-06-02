import type { Metadata } from "next";
import "./globals.css";
import { AppHeader } from "@/components/AppHeader";

export const metadata: Metadata = {
  title: "Sami Nouri Law Firm | Unclaimed Property Database",
  description: "Sami Nouri Law Firm unclaimed property database",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full antialiased">
        <div className="app-root-shell min-h-full bg-[#e8e8e6] text-neutral-900">
          <AppHeader />
          <div className="app-content-shell mx-auto max-w-6xl px-4 py-6">
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
