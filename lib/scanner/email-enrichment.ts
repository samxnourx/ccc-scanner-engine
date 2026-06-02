import "server-only";

import { prisma } from "@/lib/scanner/db/client";
import {
  getLeadDiscovery,
  updateLeadDiscovery as persistLeadDiscovery,
} from "@/lib/scanner/lead-discovery-store";
import { listEmailsForLeadBusiness } from "@/lib/scanner/lead-batch-service";
import {
  getScannerProspect,
  parseProspectContactEmails,
  updateScannerProspectContact,
} from "@/lib/scanner/prospect-discovery";

export type EmailEnrichmentTargetType =
  | "lead_business"
  | "lead_discovery"
  | "prospect";

export type EmailEnrichmentTarget = {
  type: EmailEnrichmentTargetType;
  id: string;
};

export type EmailFinding = {
  email: string;
  urls: string[];
};

export type CheckedEmailUrl = {
  url: string;
  emails: string[];
  error?: string;
};

export type EmailEnrichmentRecord = {
  id: number;
  targetType: EmailEnrichmentTargetType;
  targetId: string;
  businessName: string;
  websiteHint: string | null;
  status: string;
  message: string;
  emailCandidatesJson: string;
  checkedUrlsJson: string;
  selectedEmail: string | null;
  createdAt: string;
  updatedAt: string;
};

type TargetContext = {
  target: EmailEnrichmentTarget;
  businessName: string;
  city: string;
  website: string;
  currentEmails: string[];
  phone?: string;
};

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const CONTACT_PATHS = ["", "/contact", "/contact-us", "/about", "/about-us"];
const EMAIL_DOMAIN_BLOCKLIST = [
  "example.com",
  "wixpress.com",
  "sentry.io",
  "ag-grid.com",
];
const REJECT_FILE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".svg",
  ".ico",
  ".css",
  ".js",
  ".pdf",
];
const ASSET_WORDS_IN_LOCAL = [
  "logo",
  "icon",
  "sprite",
  "image",
  "photo",
  "banner",
  "hero",
  "background",
  "thumbnail",
];

function cleanEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidEmailCandidate(email: string): boolean {
  const e = cleanEmail(email);
  if (!e || e.length > 80 || e.split("@").length !== 2) return false;
  if (e.includes("@2x") || e.includes("@3x")) return false;

  const [local, domain] = e.split("@") as [string, string];
  if (!local || !domain || local.startsWith("___")) return false;
  if (!/[a-z]/.test(local)) return false;
  if (EMAIL_DOMAIN_BLOCKLIST.some((bad) => e.includes(bad))) return false;
  if (domain.startsWith("2x") || domain.startsWith("3x")) return false;
  if (REJECT_FILE_EXTENSIONS.some((ext) => e.endsWith(ext))) return false;
  if (ASSET_WORDS_IN_LOCAL.some((word) => new RegExp(`(^|[^a-z0-9])${word}([^a-z0-9]|$)`).test(local))) {
    return false;
  }
  if (!domain.includes(".")) return false;

  const tld = domain.split(".").pop() ?? "";
  if (tld.length < 2 || tld.length > 24 || !/^[a-z]+$/.test(tld)) return false;
  return domain.split(".").every((label) => label && label.length <= 63 && !label.startsWith("-") && !label.endsWith("-"));
}

function normalizeWebsiteUrl(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  return `https://${value}`;
}

function sameHostKey(raw: string): string {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function cleanSearchResultUrl(href: string): string {
  let raw = href.trim();
  if (!raw) return "";
  if (raw.startsWith("//")) raw = `https:${raw}`;
  try {
    let parsed = new URL(raw);
    if (parsed.hostname.includes("duckduckgo.com") && parsed.pathname.startsWith("/l/")) {
      const uddg = parsed.searchParams.get("uddg");
      if (uddg) raw = decodeURIComponent(uddg);
    }
    parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    const host = parsed.hostname.toLowerCase();
    const blocked = [
      "google.",
      "bing.com",
      "duckduckgo.com",
      "facebook.com",
      "instagram.com",
      "linkedin.com",
      "yelp.com",
      "yellowpages.com",
      "mapquest.com",
      "apple.com",
    ];
    if (blocked.some((bad) => host.includes(bad))) return "";
    return `${parsed.protocol}//${parsed.hostname}${parsed.pathname || "/"}`;
  } catch {
    return "";
  }
}

function decodeHtmlish(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

async function safeGet(url: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !contentType.includes("text") && !contentType.includes("html")) {
      return { ok: false, error: `Skipped ${contentType}` };
    }
    return { ok: true, text: await response.text() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function extractEmailsFromHtml(html: string): string[] {
  const found = new Set<string>();
  for (const match of html.matchAll(EMAIL_RE)) {
    const email = cleanEmail(match[0]);
    if (isValidEmailCandidate(email)) found.add(email);
  }

  const mailtoRe = /href\s*=\s*["']mailto:([^"'?]+)[^"']*["']/gi;
  for (const match of html.matchAll(mailtoRe)) {
    const email = cleanEmail(decodeURIComponent(decodeHtmlish(match[1] ?? "")));
    if (EMAIL_RE.test(email) && isValidEmailCandidate(email)) found.add(email);
    EMAIL_RE.lastIndex = 0;
  }
  return [...found].sort();
}

async function crawlWebsiteForEmails(website: string): Promise<CheckedEmailUrl[]> {
  const normalized = normalizeWebsiteUrl(website);
  if (!normalized) return [];
  let base: URL;
  try {
    base = new URL(normalized);
  } catch {
    return [];
  }

  const checked: CheckedEmailUrl[] = [];
  for (const path of CONTACT_PATHS) {
    const pageUrl = new URL(path, `${base.protocol}//${base.hostname}`).toString();
    const result = await safeGet(pageUrl);
    if (!result.ok) {
      checked.push({ url: pageUrl, emails: [], error: result.error });
      continue;
    }
    checked.push({ url: pageUrl, emails: extractEmailsFromHtml(result.text) });
  }
  return checked;
}

async function findBusinessWebsites(input: {
  businessName: string;
  city: string;
  maxCandidates?: number;
}): Promise<string[]> {
  const businessName = input.businessName.trim();
  if (!businessName) return [];
  const query = [businessName, input.city.trim(), "official website email contact"]
    .filter(Boolean)
    .join(" ");
  const url = new URL("https://duckduckgo.com/html/");
  url.searchParams.set("q", query);

  const response = await safeGet(url.toString());
  if (!response.ok) return [];
  const hrefRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of response.text.matchAll(hrefRe)) {
    const candidate = cleanSearchResultUrl(decodeHtmlish(match[1] ?? ""));
    if (!candidate) continue;
    const key = sameHostKey(candidate);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
    if (out.length >= (input.maxCandidates ?? 5)) break;
  }
  return out;
}

export async function ensureEmailEnrichmentTable(): Promise<void> {
  await prisma.$queryRawUnsafe(`PRAGMA busy_timeout = 60000`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS lead_email_enrichment_results (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      business_name TEXT NOT NULL,
      website_hint TEXT,
      status TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      email_candidates_json TEXT NOT NULL DEFAULT '[]',
      checked_urls_json TEXT NOT NULL DEFAULT '[]',
      selected_email TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(target_type, target_id)
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS lead_email_enrichment_target_idx
    ON lead_email_enrichment_results(target_type, target_id)
  `);
}

export async function getEmailEnrichmentResult(
  target: EmailEnrichmentTarget,
): Promise<EmailEnrichmentRecord | null> {
  await ensureEmailEnrichmentTable();
  const rows = await prisma.$queryRawUnsafe<EmailEnrichmentRecord[]>(
    `SELECT
       id,
       target_type AS targetType,
       target_id AS targetId,
       business_name AS businessName,
       website_hint AS websiteHint,
       status,
       message,
       email_candidates_json AS emailCandidatesJson,
       checked_urls_json AS checkedUrlsJson,
       selected_email AS selectedEmail,
       created_at AS createdAt,
       updated_at AS updatedAt
     FROM lead_email_enrichment_results
     WHERE target_type = ? AND target_id = ?
     LIMIT 1`,
    target.type,
    target.id,
  );
  return rows[0] ?? null;
}

async function getTargetContext(target: EmailEnrichmentTarget): Promise<TargetContext | null> {
  if (target.type === "lead_business") {
    const id = Number.parseInt(target.id, 10);
    if (!Number.isFinite(id)) return null;
    const row = await prisma.leadBusiness.findUnique({ where: { id } });
    if (!row) return null;
    return {
      target,
      businessName: row.businessName,
      city: row.city ?? "",
      website: row.website ?? "",
      phone: row.phone ?? "",
      currentEmails: listEmailsForLeadBusiness(row),
    };
  }

  if (target.type === "lead_discovery") {
    const lead = await getLeadDiscovery(target.id);
    if (!lead) return null;
    return {
      target,
      businessName: lead.targetName,
      city: lead.searchQuery.city ?? "",
      website: "",
      currentEmails: lead.outreachEmailTo
        ? lead.outreachEmailTo
            .split(/[\n,;]+/)
            .map((email) => email.trim())
            .filter(Boolean)
        : [],
    };
  }

  const prospect = await getScannerProspect(Number.parseInt(target.id, 10));
  if (!prospect) return null;
  return {
    target,
    businessName: prospect.displayName,
    city: "",
    website: prospect.contactWebsite ?? "",
    phone: prospect.contactPhone ?? "",
    currentEmails: parseProspectContactEmails(prospect.contactEmailsJson),
  };
}

function aggregateFindings(checked: CheckedEmailUrl[]): EmailFinding[] {
  const byEmail = new Map<string, Set<string>>();
  for (const item of checked) {
    for (const email of item.emails) {
      const clean = cleanEmail(email);
      if (!isValidEmailCandidate(clean)) continue;
      const urls = byEmail.get(clean) ?? new Set<string>();
      urls.add(item.url);
      byEmail.set(clean, urls);
    }
  }
  return [...byEmail.entries()]
    .map(([email, urls]) => ({ email, urls: [...urls].sort() }))
    .sort((a, b) => a.email.localeCompare(b.email));
}

async function persistEnrichment(input: {
  context: TargetContext;
  status: string;
  message: string;
  findings: EmailFinding[];
  checked: CheckedEmailUrl[];
  selectedEmail: string | null;
}): Promise<void> {
  await ensureEmailEnrichmentTable();
  await prisma.$executeRawUnsafe(
    `INSERT INTO lead_email_enrichment_results (
       target_type,
       target_id,
       business_name,
       website_hint,
       status,
       message,
       email_candidates_json,
       checked_urls_json,
       selected_email,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(target_type, target_id) DO UPDATE SET
       business_name = excluded.business_name,
       website_hint = excluded.website_hint,
       status = excluded.status,
       message = excluded.message,
       email_candidates_json = excluded.email_candidates_json,
       checked_urls_json = excluded.checked_urls_json,
       selected_email = excluded.selected_email,
       updated_at = CURRENT_TIMESTAMP`,
    input.context.target.type,
    input.context.target.id,
    input.context.businessName,
    input.context.website || null,
    input.status,
    input.message,
    JSON.stringify(input.findings),
    JSON.stringify(input.checked),
    input.selectedEmail,
  );
}

async function applySelectedEmail(
  context: TargetContext,
  selectedEmail: string,
  foundEmails: string[] = [selectedEmail],
): Promise<void> {
  const emails = [
    ...new Set([
      ...foundEmails,
      ...context.currentEmails,
    ].map((email) => cleanEmail(email)).filter(Boolean)),
  ];
  if (context.target.type === "lead_business") {
    const id = Number.parseInt(context.target.id, 10);
    await prisma.leadBusiness.update({
      where: { id },
      data: {
        email: emails[0] ?? "",
        emailsJson: JSON.stringify(emails),
        enrichmentStatus: "found_local",
        enrichmentSource: "email_parser",
        enrichmentMessage: "Email parser found public email candidate.",
        enrichedAt: new Date(),
      },
    });
    return;
  }

  if (context.target.type === "lead_discovery") {
    await persistLeadDiscovery(context.target.id, {
      outreachEmailTo: emails.join("\n"),
    });
    return;
  }

  const id = Number.parseInt(context.target.id, 10);
  await updateScannerProspectContact({
    id,
    displayName: context.businessName,
    emails,
    phone: context.phone ?? "",
    website: context.website,
  });
}

export async function runEmailEnrichment(
  target: EmailEnrichmentTarget,
): Promise<EmailEnrichmentRecord> {
  const context = await getTargetContext(target);
  if (!context) throw new Error("Email enrichment target not found.");

  const checked: CheckedEmailUrl[] = [];
  const seedUrls = new Set<string>();
  if (context.website) seedUrls.add(normalizeWebsiteUrl(context.website));

  if (seedUrls.size === 0) {
    const candidates = await findBusinessWebsites({
      businessName: context.businessName,
      city: context.city,
      maxCandidates: 5,
    });
    for (const url of candidates) seedUrls.add(url);
  }

  for (const url of seedUrls) {
    checked.push(...(await crawlWebsiteForEmails(url)));
  }

  const findings = aggregateFindings(checked);
  const selectedEmail = findings[0]?.email ?? null;
  if (selectedEmail && context.currentEmails.length === 0) {
    await applySelectedEmail(
      context,
      selectedEmail,
      findings.map((finding) => finding.email),
    );
  }

  const status = selectedEmail ? "found" : seedUrls.size > 0 ? "not_found" : "no_website";
  const message = selectedEmail
    ? `Found ${findings.length.toLocaleString("en-US")} email candidate${findings.length === 1 ? "" : "s"}.`
    : seedUrls.size > 0
      ? "Checked likely websites but did not find a usable email."
      : "No likely website candidates were found.";

  await persistEnrichment({
    context,
    status,
    message,
    findings,
    checked,
    selectedEmail,
  });

  const result = await getEmailEnrichmentResult(target);
  if (!result) throw new Error("Email enrichment result was not saved.");
  return result;
}

export function parseEmailFindings(raw: string): EmailFinding[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const r = item as Record<string, unknown>;
        const email = typeof r.email === "string" ? r.email : "";
        const urls = Array.isArray(r.urls) ? r.urls.map(String).filter(Boolean) : [];
        return email ? { email, urls } : null;
      })
      .filter((item): item is EmailFinding => item != null);
  } catch {
    return [];
  }
}

export function parseCheckedEmailUrls(raw: string): CheckedEmailUrl[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const rows: Array<CheckedEmailUrl | null> = parsed
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const r = item as Record<string, unknown>;
        const url = typeof r.url === "string" ? r.url : "";
        const emails = Array.isArray(r.emails) ? r.emails.map(String).filter(Boolean) : [];
        const error = typeof r.error === "string" ? r.error : undefined;
        const row: CheckedEmailUrl = error ? { url, emails, error } : { url, emails };
        return url ? row : null;
      })
    return rows.filter((item): item is CheckedEmailUrl => item != null);
  } catch {
    return [];
  }
}
