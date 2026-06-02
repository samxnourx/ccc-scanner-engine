import "../lib/scanner/importers/load-importer-env";

import { prisma } from "../lib/scanner/db/client";

async function main() {
  await prisma.$executeRawUnsafe(`
    UPDATE lead_scan_batches
    SET status = CASE
      WHEN scanned_count > 0 THEN 'review_needed'
      ELSE 'imported'
    END
    WHERE status = 'scanning'
  `);

  const rows = await prisma.leadScanBatch.findMany({
    orderBy: { id: "asc" },
    select: {
      id: true,
      name: true,
      status: true,
      scannedCount: true,
      totalBusinesses: true,
      matchesFoundCount: true,
    },
  });
  console.log(JSON.stringify(rows, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
