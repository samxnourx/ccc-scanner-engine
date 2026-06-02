/**
 * One-off: print source_records totals (all rows + CA SCO only).
 * Run: npm run db:count-source-records
 */

import "../importers/load-importer-env";
import { CA_SCO_SOURCE_KEY } from "../ca-sco-keys";
import { prisma } from "../db/client";

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("DATABASE_URL is not set.");
    process.exitCode = 1;
    return;
  }

  const [total, caSco] = await Promise.all([
    prisma.sourceRecord.count(),
    prisma.sourceRecord.count({ where: { source: CA_SCO_SOURCE_KEY } }),
  ]);

  console.log(`source_records total:     ${total.toLocaleString()}`);
  console.log(`source_records ca_sco:    ${caSco.toLocaleString()}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
