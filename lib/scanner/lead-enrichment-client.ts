import "server-only";

const DEFAULT_ENRICH_URL =
  "http://127.0.0.1:8000/api/enrich-business-contact";

export type LeadEnrichmentRequestBody = {
  business_name: string;
  address: string;
  city: string;
  force_google_search: boolean;
};

export type LeadEnrichmentSuccess = {
  found: boolean;
  source?: string;
  business_name?: string;
  phone?: string;
  address?: string;
  website?: string;
  has_website?: boolean;
  emails?: string | string[];
  has_email?: boolean;
  google_maps_url?: string;
  message?: string;
};

function displayServiceOrigin(): string {
  const raw = process.env.LEAD_SCANNER_ENRICH_URL?.trim() || DEFAULT_ENRICH_URL;
  try {
    return new URL(raw).origin;
  } catch {
    return "http://127.0.0.1:8000";
  }
}

function enrichUrl(): string {
  return process.env.LEAD_SCANNER_ENRICH_URL?.trim() || DEFAULT_ENRICH_URL;
}

/**
 * POST to Lead Scanner enrich endpoint. 30s timeout.
 * Throws with a staff-facing message when the service is down or response is invalid.
 */
export async function postEnrichBusinessContact(
  body: LeadEnrichmentRequestBody,
): Promise<LeadEnrichmentSuccess> {
  const url = enrichUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(
        `Lead Scanner returned non-JSON (${res.status}). Check the enrich service.`,
      );
    }
    if (!res.ok) {
      throw new Error(
        typeof (data as { error?: string })?.error === "string"
          ? (data as { error: string }).error
          : `Lead Scanner enrich failed (${res.status}).`,
      );
    }
    if (!data || typeof data !== "object") {
      throw new Error("Lead Scanner returned an empty response.");
    }
    return data as LeadEnrichmentSuccess;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error(
        `Lead Scanner enrichment service is not reachable at ${displayServiceOrigin()}.`,
      );
    }
    if (
      e instanceof TypeError &&
      (e.message.includes("fetch") || e.message.includes("ECONNREFUSED"))
    ) {
      throw new Error(
        `Lead Scanner enrichment service is not reachable at ${displayServiceOrigin()}.`,
      );
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}
