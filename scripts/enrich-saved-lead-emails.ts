import dotenv from "dotenv";

dotenv.config({ path: ".env.local", override: true });
dotenv.config();

function argValue(name: string): string | null {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === name && args[i + 1]) return args[i + 1]!;
    if (a.startsWith(`${name}=`)) return a.slice(name.length + 1);
  }
  return null;
}

function parseLimit(): number {
  const n = Number.parseInt(argValue("--limit") ?? "25", 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 250) : 25;
}

function appBaseUrl(): string {
  return (
    argValue("--base-url") ??
    process.env.CCC_SCANNER_BASE_URL ??
    "http://127.0.0.1:3020"
  ).replace(/\/$/, "");
}

async function main(): Promise<void> {
  const limit = parseLimit();
  const url = new URL(`${appBaseUrl()}/api/scanner/email-enrichment/run-saved`);
  url.searchParams.set("limit", String(limit));

  console.log(`[email-enrichment] Requesting saved lead enrichment: ${url}`);
  const response = await fetch(url, { method: "POST" });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`CCC Scanner returned ${response.status}: ${text.slice(0, 500)}`);
  }
  console.log(text);
}

main().catch((e) => {
  console.error("[email-enrichment] Run failed", e);
  process.exitCode = 1;
});
