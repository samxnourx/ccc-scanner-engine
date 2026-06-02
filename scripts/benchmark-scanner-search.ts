const baseUrl = process.env.SCANNER_BENCH_BASE_URL || "http://localhost:3020";
const queries =
  process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : [
        "John Smith",
        "Maria Garcia",
        "David Johnson",
        "Advanced Clinical",
        "Dental Arts San Diego",
        "Perlman Clinic",
      ];

function matchSummary(html: string): string {
  const match = html.match(/(?:No|[0-9,]+) matches? found/);
  return match?.[0] ?? "(summary not found)";
}

async function main(): Promise<void> {
  for (const query of queries) {
    const url = `${baseUrl.replace(/\/$/, "")}/scanner/results?name=${encodeURIComponent(query)}`;
    const started = Date.now();
    try {
      const res = await fetch(url, { cache: "no-store" });
      const html = await res.text();
      const ms = Date.now() - started;
      console.log(
        JSON.stringify({
          query,
          status: res.status,
          ms,
          seconds: Number((ms / 1000).toFixed(2)),
          summary: matchSummary(html),
        }),
      );
    } catch (e) {
      const ms = Date.now() - started;
      console.log(
        JSON.stringify({
          query,
          status: "ERR",
          ms,
          seconds: Number((ms / 1000).toFixed(2)),
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

export {};
