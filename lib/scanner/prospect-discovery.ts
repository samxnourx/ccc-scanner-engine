import "server-only";

import { prisma } from "@/lib/scanner/db/client";

export type ProspectStatus = "new" | "saved" | "dismissed" | "email_sent";

export type ScannerProspect = {
  id: number;
  source: string;
  ownerNameNormalized: string;
  displayName: string;
  totalAmount: number;
  propertyCount: number;
  cityCount: number;
  addressCount: number;
  citiesJson: string;
  addressesJson: string;
  sampleMatchesJson: string;
  status: string;
  builtAt: string;
  contactEmailsJson: string | null;
  contactPhone: string | null;
  contactWebsite: string | null;
  outreachEmailTo: string | null;
  outreachEmailSubject: string | null;
  outreachEmailText: string | null;
  outreachPortalUrl: string | null;
  outreachIntakeId: string | null;
  outreachSentAt: string | null;
};

export type ProspectSampleMatch = {
  sourceName: string;
  reportedOwnerName: string;
  holderName: string;
  propertyId: string;
  amount: string | null;
  reportedAddress: string;
  accountType: string | null;
  confidence: string;
};

export type ProspectPropertyRow = ProspectSampleMatch & {
  sourceRecordId: number;
  city: string | null;
  address: string | null;
};

export type BusinessCandidateGroup = {
  source: string;
  ownerNameNormalized: string;
  displayName: string;
  totalAmount: number;
  propertyCount: number;
  cityCount: number;
  addressCount: number;
  citiesCsv: string | null;
  addressesCsv: string | null;
  topHolder: string | null;
  topAmount: number | null;
};

export type BusinessCandidateSort =
  | "total"
  | "business"
  | "properties"
  | "cities"
  | "top";

function candidateSearchQuery(...values: Array<string | undefined>): string {
  const tokens = values
    .flatMap((value) => (value ?? "").match(/[A-Za-z0-9]+/g) ?? [])
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 2)
    .slice(0, 12);
  return [...new Set(tokens)].join(" AND ");
}

async function hasCandidateFtsIndex(): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ name: string }[]>(
    `SELECT name FROM sqlite_master
     WHERE type='table' AND name='source_record_business_candidates_fts'
     LIMIT 1`,
  );
  if (rows.length === 0) return false;
  const countRows = await prisma.$queryRawUnsafe<{ count: number | bigint }[]>(
    `SELECT COUNT(*) AS count FROM source_record_business_candidates_fts`,
  );
  return Number(countRows[0]?.count ?? 0) > 0;
}

export type ProspectIndexStats = {
  exists: boolean;
  totalProspects: number;
  newProspects: number;
  builtAt: string | null;
};

export type BusinessCandidateIndexStats = {
  exists: boolean;
  status: string;
  lastSourceRecordId: number;
  candidateCount: number;
  sourceRecordCount: number;
  sourceRecordTotalAmount: number;
  sourceRecordValueLastId: number;
  sourceValueStatsStatus: string;
  sourceValueStatsUpdatedAt: string | null;
  candidateTotalAmount: number;
  updatedAt: string | null;
  completedAt: string | null;
};

export async function ensureScannerProspectsTable(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS scanner_prospects (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      owner_name_normalized TEXT NOT NULL,
      display_name TEXT NOT NULL,
      total_amount REAL NOT NULL,
      property_count INTEGER NOT NULL,
      city_count INTEGER NOT NULL,
      address_count INTEGER NOT NULL,
      cities_json TEXT NOT NULL,
      addresses_json TEXT NOT NULL,
      sample_matches_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      built_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source, owner_name_normalized)
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS scanner_prospects_total_amount_idx
    ON scanner_prospects(total_amount DESC)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS scanner_prospects_status_total_idx
    ON scanner_prospects(status, total_amount DESC)
  `);

  const columns = await prisma.$queryRawUnsafe<{ name: string }[]>(
    `PRAGMA table_info(scanner_prospects)`,
  );
  const existing = new Set(columns.map((column) => column.name));
  const additions: Array<[string, string]> = [
    ["contact_emails_json", "TEXT"],
    ["contact_phone", "TEXT"],
    ["contact_website", "TEXT"],
    ["outreach_email_to", "TEXT"],
    ["outreach_email_subject", "TEXT"],
    ["outreach_email_text", "TEXT"],
    ["outreach_portal_url", "TEXT"],
    ["outreach_intake_id", "TEXT"],
    ["outreach_sent_at", "DATETIME"],
  ];

  for (const [name, type] of additions) {
    if (!existing.has(name)) {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE scanner_prospects ADD COLUMN ${name} ${type}`,
      );
    }
  }
}

export async function getProspectIndexStats(): Promise<ProspectIndexStats> {
  const existsRows = await prisma.$queryRawUnsafe<{ name: string }[]>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='scanner_prospects'`,
  );
  if (existsRows.length === 0) {
    return {
      exists: false,
      totalProspects: 0,
      newProspects: 0,
      builtAt: null,
    };
  }
  const rows = await prisma.$queryRawUnsafe<
    { totalProspects: bigint | number; newProspects: bigint | number; builtAt: string | null }[]
  >(
    `SELECT
       COUNT(*) AS totalProspects,
       SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS newProspects,
       MAX(built_at) AS builtAt
     FROM scanner_prospects`,
  );
  const row = rows[0];
  return {
    exists: true,
    totalProspects: Number(row?.totalProspects ?? 0),
    newProspects: Number(row?.newProspects ?? 0),
    builtAt: row?.builtAt ?? null,
  };
}

export async function getBusinessCandidateIndexStats(): Promise<BusinessCandidateIndexStats> {
  const existsRows = await prisma.$queryRawUnsafe<{ name: string }[]>(
    `SELECT name FROM sqlite_master
     WHERE type='table' AND name='source_record_business_candidate_index_state'`,
  );
  if (existsRows.length === 0) {
    return {
      exists: false,
      status: "not started",
      lastSourceRecordId: 0,
      candidateCount: 0,
      sourceRecordCount: 0,
      sourceRecordTotalAmount: 0,
      sourceRecordValueLastId: 0,
      sourceValueStatsStatus: "not started",
      sourceValueStatsUpdatedAt: null,
      candidateTotalAmount: 0,
      updatedAt: null,
      completedAt: null,
    };
  }
  const rows = await prisma.$queryRawUnsafe<
    {
      status: string;
      lastSourceRecordId: number | bigint;
      candidateCount: number | bigint;
      updatedAt: string | null;
      completedAt: string | null;
    }[]
  >(
    `SELECT
       status,
       last_source_record_id AS lastSourceRecordId,
       candidate_count AS candidateCount,
       updated_at AS updatedAt,
       completed_at AS completedAt
     FROM source_record_business_candidate_index_state
     WHERE source = 'ca_sco'
     LIMIT 1`,
  );
  const row = rows[0];
  if (!row) {
    return {
      exists: true,
      status: "not started",
      lastSourceRecordId: 0,
      candidateCount: 0,
      sourceRecordCount: 0,
      sourceRecordTotalAmount: 0,
      sourceRecordValueLastId: 0,
      sourceValueStatsStatus: "not started",
      sourceValueStatsUpdatedAt: null,
      candidateTotalAmount: 0,
      updatedAt: null,
      completedAt: null,
    };
  }
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS source_record_value_stats (
      source TEXT NOT NULL PRIMARY KEY,
      last_source_record_id INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'not_started',
      source_record_count INTEGER NOT NULL DEFAULT 0,
      source_record_total_amount REAL NOT NULL DEFAULT 0,
      candidate_record_count INTEGER NOT NULL DEFAULT 0,
      candidate_total_amount REAL NOT NULL DEFAULT 0,
      computed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  const valueStatsColumns = await prisma.$queryRawUnsafe<{ name: string }[]>(
    `PRAGMA table_info(source_record_value_stats)`,
  );
  const valueStatsColumnNames = new Set(
    valueStatsColumns.map((column) => column.name),
  );
  if (!valueStatsColumnNames.has("last_source_record_id")) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE source_record_value_stats ADD COLUMN last_source_record_id INTEGER NOT NULL DEFAULT 0`,
    );
  }
  if (!valueStatsColumnNames.has("status")) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE source_record_value_stats ADD COLUMN status TEXT NOT NULL DEFAULT 'not_started'`,
    );
  }
  const sourceTotalRows = await prisma.$queryRawUnsafe<
    {
      sourceRecordCount: number | bigint;
      sourceRecordTotalAmount: number | bigint | null;
      sourceRecordValueLastId: number | bigint;
      sourceValueStatsStatus: string | null;
      sourceValueStatsUpdatedAt: string | null;
      candidateTotalAmount: number | bigint | null;
    }[]
  >(
    `SELECT
       source_record_count AS sourceRecordCount,
       source_record_total_amount AS sourceRecordTotalAmount,
       last_source_record_id AS sourceRecordValueLastId,
       status AS sourceValueStatsStatus,
       computed_at AS sourceValueStatsUpdatedAt,
       candidate_total_amount AS candidateTotalAmount
     FROM source_record_value_stats
     WHERE source = 'ca_sco'
     LIMIT 1`,
  );
  const sourceTotal = sourceTotalRows[0];
  return {
    exists: true,
    status: row.status,
    lastSourceRecordId: Number(row.lastSourceRecordId ?? 0),
    candidateCount: Number(row.candidateCount ?? 0),
    sourceRecordCount: Number(sourceTotal?.sourceRecordCount ?? 0),
    sourceRecordTotalAmount: Number(sourceTotal?.sourceRecordTotalAmount ?? 0),
    sourceRecordValueLastId: Number(sourceTotal?.sourceRecordValueLastId ?? 0),
    sourceValueStatsStatus:
      sourceTotal?.sourceValueStatsStatus ?? "not started",
    sourceValueStatsUpdatedAt: sourceTotal?.sourceValueStatsUpdatedAt ?? null,
    candidateTotalAmount: Number(sourceTotal?.candidateTotalAmount ?? 0),
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
  };
}

export async function listScannerProspects(input?: {
  minAmount?: number;
  status?: string;
  limit?: number;
  name?: string;
  city?: string;
}): Promise<ScannerProspect[]> {
  await ensureScannerProspectsTable();
  const minAmount = input?.minAmount ?? 5000;
  const status = input?.status?.trim() || "new";
  const limit = Math.min(Math.max(input?.limit ?? 100, 1), 500);
  const nameLike = `%${(input?.name ?? "").trim()}%`;
  const cityLike = `%${(input?.city ?? "").trim()}%`;
  return prisma.$queryRawUnsafe<ScannerProspect[]>(
    `SELECT
       id,
       source,
       owner_name_normalized AS ownerNameNormalized,
       display_name AS displayName,
       total_amount AS totalAmount,
       property_count AS propertyCount,
       city_count AS cityCount,
       address_count AS addressCount,
       cities_json AS citiesJson,
       addresses_json AS addressesJson,
       sample_matches_json AS sampleMatchesJson,
       status,
       built_at AS builtAt,
       contact_emails_json AS contactEmailsJson,
       contact_phone AS contactPhone,
       contact_website AS contactWebsite,
       outreach_email_to AS outreachEmailTo,
       outreach_email_subject AS outreachEmailSubject,
       outreach_email_text AS outreachEmailText,
       outreach_portal_url AS outreachPortalUrl,
       outreach_intake_id AS outreachIntakeId,
       outreach_sent_at AS outreachSentAt
     FROM scanner_prospects
     WHERE total_amount >= ?
       AND (? = 'all' OR status = ?)
       AND (? = '%%' OR display_name LIKE ? OR owner_name_normalized LIKE ?)
       AND (? = '%%' OR cities_json LIKE ? OR addresses_json LIKE ?)
     ORDER BY total_amount DESC, property_count DESC
     LIMIT ?`,
    minAmount,
    status,
    status,
    nameLike,
    nameLike,
    nameLike.toLowerCase(),
    cityLike,
    cityLike,
    cityLike,
    limit,
  );
}

export async function listBusinessCandidateGroups(input?: {
  name?: string;
  city?: string;
  holder?: string;
  address?: string;
  minAmount?: number;
  maxAmount?: number;
  limit?: number;
  offset?: number;
  sort?: BusinessCandidateSort;
  direction?: "asc" | "desc";
}): Promise<BusinessCandidateGroup[]> {
  const name = (input?.name ?? "").trim();
  const city = (input?.city ?? "").trim();
  const holder = (input?.holder ?? "").trim();
  const address = (input?.address ?? "").trim();
  const minAmount = Math.max(input?.minAmount ?? 0, 0);
  const maxAmount =
    input?.maxAmount != null && input.maxAmount > 0 ? input.maxAmount : null;
  const limit = Math.min(Math.max(input?.limit ?? 250, 1), 1000);
  const nameLike = `%${name.toUpperCase()}%`;
  const cityLike = `%${city.toUpperCase()}%`;
  const holderLike = `%${holder.toUpperCase()}%`;
  const addressLike = `%${address.toUpperCase()}%`;
  const offset = Math.max(input?.offset ?? 0, 0);
  const direction = input?.direction === "asc" ? "ASC" : "DESC";
  const sort = input?.sort ?? "total";
  const groupTableRows = await prisma.$queryRawUnsafe<{ name: string }[]>(
    `SELECT name FROM sqlite_master
     WHERE type='table' AND name='source_record_business_candidate_groups'
     LIMIT 1`,
  );

  if (groupTableRows.length > 0) {
    const orderBy =
      sort === "business"
        ? `display_name ${direction}, total_amount DESC`
        : sort === "properties"
          ? `property_count ${direction}, total_amount DESC`
          : sort === "cities"
            ? `city_count ${direction}, total_amount DESC`
            : sort === "top"
              ? `top_amount ${direction}, total_amount DESC`
              : `total_amount ${direction}, property_count DESC`;

    const clauses = [`source = 'ca_sco'`, `total_amount >= ?`];
    const params: Array<string | number | null> = [minAmount];
    if (maxAmount != null) {
      clauses.push(`total_amount <= ?`);
      params.push(maxAmount);
    }
    if (name) {
      clauses.push(`(UPPER(display_name) LIKE ? OR owner_name_normalized LIKE ?)`);
      params.push(nameLike, nameLike.toLowerCase());
    }
    if (city) {
      clauses.push(`UPPER(COALESCE(cities_csv, '')) LIKE ?`);
      params.push(cityLike);
    }
    if (holder) {
      clauses.push(`UPPER(COALESCE(top_holder, '')) LIKE ?`);
      params.push(holderLike);
    }
    if (address) {
      clauses.push(`UPPER(COALESCE(addresses_csv, '')) LIKE ?`);
      params.push(addressLike);
    }

    return prisma.$queryRawUnsafe<BusinessCandidateGroup[]>(
      `SELECT
         source,
         owner_name_normalized AS ownerNameNormalized,
         display_name AS displayName,
         total_amount AS totalAmount,
         property_count AS propertyCount,
         city_count AS cityCount,
         address_count AS addressCount,
         SUBSTR(COALESCE(cities_csv, ''), 1, 500) AS citiesCsv,
         SUBSTR(COALESCE(addresses_csv, ''), 1, 500) AS addressesCsv,
         top_holder AS topHolder,
         top_amount AS topAmount
       FROM source_record_business_candidate_groups
       WHERE ${clauses.join(" AND ")}
       ORDER BY ${orderBy}
       LIMIT ?
       OFFSET ?`,
      ...params,
      limit,
      offset,
    );
  }

  const ftsQuery = candidateSearchQuery(name, city, holder, address);
  const useFts = Boolean(ftsQuery) && (await hasCandidateFtsIndex().catch(() => false));

  return prisma.$queryRawUnsafe<BusinessCandidateGroup[]>(
    `${useFts ? "WITH matched_rows AS (SELECT rowid AS source_record_id FROM source_record_business_candidates_fts WHERE source_record_business_candidates_fts MATCH ?)" : ""}
     SELECT
       c.source,
       c.owner_name_normalized AS ownerNameNormalized,
       MIN(c.owner_name) AS displayName,
       ROUND(SUM(c.amount_num), 2) AS totalAmount,
       COUNT(*) AS propertyCount,
       COUNT(DISTINCT COALESCE(NULLIF(TRIM(c.city), ''), '(blank)')) AS cityCount,
       COUNT(DISTINCT COALESCE(NULLIF(TRIM(c.address), ''), '(blank)')) AS addressCount,
       GROUP_CONCAT(DISTINCT NULLIF(TRIM(c.city), '')) AS citiesCsv,
       GROUP_CONCAT(DISTINCT NULLIF(TRIM(c.address), '')) AS addressesCsv,
       (
         SELECT c2.holder_name
         FROM source_record_business_candidates c2
         WHERE c2.source = c.source
           AND c2.owner_name_normalized = c.owner_name_normalized
         ORDER BY c2.amount_num DESC, c2.source_record_id ASC
         LIMIT 1
       ) AS topHolder,
       (
         SELECT c2.amount_num
         FROM source_record_business_candidates c2
         WHERE c2.source = c.source
           AND c2.owner_name_normalized = c.owner_name_normalized
         ORDER BY c2.amount_num DESC, c2.source_record_id ASC
         LIMIT 1
       ) AS topAmount
     FROM source_record_business_candidates c
     WHERE c.source = 'ca_sco'
       ${useFts ? "AND c.source_record_id IN (SELECT source_record_id FROM matched_rows)" : ""}
       AND (? = '%%' OR c.owner_name_normalized LIKE ? OR c.owner_name LIKE ?)
       AND (? = '%%' OR UPPER(COALESCE(c.city, '')) LIKE ?)
       AND (? = '%%' OR UPPER(COALESCE(c.holder_name, '')) LIKE ?)
       AND (? = '%%' OR UPPER(COALESCE(c.address, '')) LIKE ?)
       AND (? IS NULL OR c.amount_num <= ?)
     GROUP BY c.source, c.owner_name_normalized
     HAVING totalAmount >= ?
     ORDER BY totalAmount DESC, propertyCount DESC
     LIMIT ?
     OFFSET ?`,
    ...(useFts ? [ftsQuery] : []),
    nameLike,
    nameLike,
    nameLike,
    cityLike,
    cityLike,
    holderLike,
    holderLike,
    addressLike,
    addressLike,
    maxAmount,
    maxAmount,
    minAmount,
    limit,
    offset,
  );
}

export async function listBusinessCandidateProperties(input: {
  source: string;
  ownerNameNormalized: string;
  city?: string;
  limit?: number;
}): Promise<ProspectPropertyRow[]> {
  const source = input.source.trim() || "ca_sco";
  const ownerNameNormalized = input.ownerNameNormalized.trim();
  const city = (input.city ?? "").trim().toUpperCase();
  const cityLike = `%${city}%`;
  const limit = Math.min(Math.max(input.limit ?? 1000, 1), 5000);

  return prisma.$queryRawUnsafe<ProspectPropertyRow[]>(
    `SELECT
       source_record_id AS sourceRecordId,
       'California SCO' AS sourceName,
       owner_name AS reportedOwnerName,
       holder_name AS holderName,
       property_id AS propertyId,
       printf('%.2f', amount_num) AS amount,
       TRIM(COALESCE(address, '') || CASE WHEN city IS NOT NULL AND city <> '' THEN ', ' || city ELSE '' END || CASE WHEN state IS NOT NULL AND state <> '' THEN ', ' || state ELSE '' END || CASE WHEN zip_code IS NOT NULL AND zip_code <> '' THEN ', ' || zip_code ELSE '' END) AS reportedAddress,
       property_type AS accountType,
       'high' AS confidence,
       city,
       address
     FROM source_record_business_candidates
     WHERE source = ?
       AND owner_name_normalized = ?
       AND (? = '%%' OR UPPER(COALESCE(city, '')) LIKE ?)
     ORDER BY amount_num DESC, source_record_id ASC
     LIMIT ?`,
    source,
    ownerNameNormalized,
    cityLike,
    cityLike,
    limit,
  );
}

export async function getOrCreateScannerProspectFromCandidate(input: {
  source: string;
  ownerNameNormalized: string;
}): Promise<ScannerProspect | null> {
  await ensureScannerProspectsTable();
  const source = input.source.trim() || "ca_sco";
  const ownerNameNormalized = input.ownerNameNormalized.trim();
  if (!ownerNameNormalized) return null;

  const properties = await listBusinessCandidateProperties({
    source,
    ownerNameNormalized,
    limit: 5000,
  });
  if (properties.length === 0) return null;

  const displayName = properties[0]?.reportedOwnerName || ownerNameNormalized;
  const totalAmount = properties.reduce((sum, row) => {
    const n = Number.parseFloat(String(row.amount ?? "").replace(/[$,]/g, ""));
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
  const cities = [
    ...new Set(properties.map((row) => row.city?.trim()).filter(Boolean)),
  ];
  const addresses = [
    ...new Set(properties.map((row) => row.address?.trim()).filter(Boolean)),
  ];
  const sampleMatches: ProspectSampleMatch[] = properties
    .slice(0, 10)
    .map((row) => ({
      sourceName: row.sourceName,
      reportedOwnerName: row.reportedOwnerName,
      holderName: row.holderName,
      propertyId: row.propertyId,
      amount: row.amount,
      reportedAddress: row.reportedAddress,
      accountType: row.accountType,
      confidence: row.confidence,
    }));

  await prisma.$executeRawUnsafe(
    `INSERT INTO scanner_prospects (
       source,
       owner_name_normalized,
       display_name,
       total_amount,
       property_count,
       city_count,
       address_count,
       cities_json,
       addresses_json,
       sample_matches_json,
       status,
       built_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', CURRENT_TIMESTAMP)
     ON CONFLICT(source, owner_name_normalized) DO UPDATE SET
       display_name = excluded.display_name,
       total_amount = excluded.total_amount,
       property_count = excluded.property_count,
       city_count = excluded.city_count,
       address_count = excluded.address_count,
       cities_json = excluded.cities_json,
       addresses_json = excluded.addresses_json,
       sample_matches_json = excluded.sample_matches_json`,
    source,
    ownerNameNormalized,
    displayName,
    Number(totalAmount.toFixed(2)),
    properties.length,
    cities.length,
    addresses.length,
    JSON.stringify(cities),
    JSON.stringify(addresses),
    JSON.stringify(sampleMatches),
  );

  const rows = await prisma.$queryRawUnsafe<ScannerProspect[]>(
    `SELECT
       id,
       source,
       owner_name_normalized AS ownerNameNormalized,
       display_name AS displayName,
       total_amount AS totalAmount,
       property_count AS propertyCount,
       city_count AS cityCount,
       address_count AS addressCount,
       cities_json AS citiesJson,
       addresses_json AS addressesJson,
       sample_matches_json AS sampleMatchesJson,
       status,
       built_at AS builtAt,
       contact_emails_json AS contactEmailsJson,
       contact_phone AS contactPhone,
       contact_website AS contactWebsite,
       outreach_email_to AS outreachEmailTo,
       outreach_email_subject AS outreachEmailSubject,
       outreach_email_text AS outreachEmailText,
       outreach_portal_url AS outreachPortalUrl,
       outreach_intake_id AS outreachIntakeId,
       outreach_sent_at AS outreachSentAt
     FROM scanner_prospects
     WHERE source = ?
       AND owner_name_normalized = ?
     LIMIT 1`,
    source,
    ownerNameNormalized,
  );
  return rows[0] ?? null;
}

export async function getScannerProspect(
  id: number,
): Promise<ScannerProspect | null> {
  await ensureScannerProspectsTable();
  const rows = await prisma.$queryRawUnsafe<ScannerProspect[]>(
    `SELECT
       id,
       source,
       owner_name_normalized AS ownerNameNormalized,
       display_name AS displayName,
       total_amount AS totalAmount,
       property_count AS propertyCount,
       city_count AS cityCount,
       address_count AS addressCount,
       cities_json AS citiesJson,
       addresses_json AS addressesJson,
       sample_matches_json AS sampleMatchesJson,
       status,
       built_at AS builtAt,
       contact_emails_json AS contactEmailsJson,
       contact_phone AS contactPhone,
       contact_website AS contactWebsite,
       outreach_email_to AS outreachEmailTo,
       outreach_email_subject AS outreachEmailSubject,
       outreach_email_text AS outreachEmailText,
       outreach_portal_url AS outreachPortalUrl,
       outreach_intake_id AS outreachIntakeId,
       outreach_sent_at AS outreachSentAt
     FROM scanner_prospects
     WHERE id = ?
     LIMIT 1`,
    id,
  );
  return rows[0] ?? null;
}

export async function updateScannerProspectStatus(
  id: number,
  status: ProspectStatus,
): Promise<void> {
  await ensureScannerProspectsTable();
  await prisma.$executeRawUnsafe(
    `UPDATE scanner_prospects SET status = ? WHERE id = ?`,
    status,
    id,
  );
}

export async function updateScannerProspectContact(input: {
  id: number;
  displayName: string;
  emails: string[];
  phone: string;
  website: string;
}): Promise<void> {
  await ensureScannerProspectsTable();
  await prisma.$executeRawUnsafe(
    `UPDATE scanner_prospects
     SET display_name = ?,
         contact_emails_json = ?,
         contact_phone = ?,
         contact_website = ?
     WHERE id = ?`,
    input.displayName,
    JSON.stringify(input.emails),
    input.phone || null,
    input.website || null,
    input.id,
  );
}

export async function markScannerProspectEmailSent(input: {
  id: number;
  recipientEmail: string;
  subject: string;
  text: string;
  portalUrl: string | null;
  intakeId: string | null;
  sentAt: string;
}): Promise<void> {
  await ensureScannerProspectsTable();
  await prisma.$executeRawUnsafe(
    `UPDATE scanner_prospects
     SET status = 'email_sent',
         outreach_email_to = ?,
         outreach_email_subject = ?,
         outreach_email_text = ?,
         outreach_portal_url = ?,
         outreach_intake_id = ?,
         outreach_sent_at = ?
     WHERE id = ?`,
    input.recipientEmail,
    input.subject,
    input.text,
    input.portalUrl,
    input.intakeId,
    input.sentAt,
    input.id,
  );
}

export async function removeScannerProspectsFromDashboard(
  prospectIds: number[],
): Promise<{ updatedCount: number }> {
  const ids = [...new Set(prospectIds)]
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (ids.length === 0) return { updatedCount: 0 };

  await ensureScannerProspectsTable();
  const result = await prisma.$executeRawUnsafe(
    `UPDATE scanner_prospects
     SET status = 'new',
         outreach_email_to = NULL,
         outreach_email_subject = NULL,
         outreach_email_text = NULL,
         outreach_portal_url = NULL,
         outreach_intake_id = NULL,
         outreach_sent_at = NULL
     WHERE id IN (${ids.map(() => "?").join(", ")})`,
    ...ids,
  );
  return { updatedCount: Number(result ?? 0) };
}

export async function listProspectProperties(
  prospect: ScannerProspect,
  limit = 5000,
): Promise<ProspectPropertyRow[]> {
  await ensureScannerProspectsTable();
  const take = Math.min(Math.max(limit, 1), 5000);
  const candidateTables = await prisma.$queryRawUnsafe<{ name: string }[]>(
    `SELECT name FROM sqlite_master
     WHERE type = 'table' AND name = 'source_record_business_candidates'`,
  );
  if (candidateTables.length > 0) {
    return prisma.$queryRawUnsafe<ProspectPropertyRow[]>(
      `SELECT
         source_record_id AS sourceRecordId,
         'California SCO' AS sourceName,
         owner_name AS reportedOwnerName,
         holder_name AS holderName,
         property_id AS propertyId,
         printf('%.2f', amount_num) AS amount,
         TRIM(COALESCE(address, '') || CASE WHEN city IS NOT NULL AND city <> '' THEN ', ' || city ELSE '' END || CASE WHEN state IS NOT NULL AND state <> '' THEN ', ' || state ELSE '' END || CASE WHEN zip_code IS NOT NULL AND zip_code <> '' THEN ', ' || zip_code ELSE '' END) AS reportedAddress,
         property_type AS accountType,
         'high' AS confidence,
         city,
         address
       FROM source_record_business_candidates
       WHERE source = ?
         AND owner_name_normalized = ?
       ORDER BY amount_num DESC, source_record_id ASC
       LIMIT ?`,
      prospect.source,
      prospect.ownerNameNormalized,
      take,
    );
  }
  return prisma.$queryRawUnsafe<ProspectPropertyRow[]>(
    `SELECT
       id AS sourceRecordId,
       'California SCO' AS sourceName,
       owner_name AS reportedOwnerName,
       holder_name AS holderName,
       property_id AS propertyId,
       amount,
       TRIM(COALESCE(address, '') || CASE WHEN city IS NOT NULL AND city <> '' THEN ', ' || city ELSE '' END || CASE WHEN state IS NOT NULL AND state <> '' THEN ', ' || state ELSE '' END || CASE WHEN zip_code IS NOT NULL AND zip_code <> '' THEN ', ' || zip_code ELSE '' END) AS reportedAddress,
       property_type AS accountType,
       'high' AS confidence,
       city,
       address
     FROM source_records INDEXED BY source_records_owner_name_normalized_idx
     WHERE source = ?
       AND owner_name_normalized = ?
     ORDER BY CAST(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(amount,'')), '$', ''), ',', ''), ' ', '') AS REAL) DESC,
              id ASC
     LIMIT ?`,
    prospect.source,
    prospect.ownerNameNormalized,
    take,
  );
}

export function parseProspectJsonList(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.map((x) => String(x).trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

export function parseProspectContactEmails(raw: string | null): string[] {
  if (!raw) return [];
  return parseProspectJsonList(raw);
}

export function parseProspectSampleMatches(raw: string): ProspectSampleMatch[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => {
        if (!x || typeof x !== "object") return null;
        const r = x as Record<string, unknown>;
        return {
          sourceName: typeof r.sourceName === "string" ? r.sourceName : "California SCO",
          reportedOwnerName:
            typeof r.reportedOwnerName === "string" ? r.reportedOwnerName : "",
          holderName: typeof r.holderName === "string" ? r.holderName : "",
          propertyId: typeof r.propertyId === "string" ? r.propertyId : "",
          amount: typeof r.amount === "string" ? r.amount : null,
          reportedAddress:
            typeof r.reportedAddress === "string" ? r.reportedAddress : "",
          accountType: typeof r.accountType === "string" ? r.accountType : null,
          confidence: typeof r.confidence === "string" ? r.confidence : "high",
        };
      })
      .filter((x): x is ProspectSampleMatch => x != null);
  } catch {
    return [];
  }
}
