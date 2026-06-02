import "server-only";

export type ScannerIntakeQueueItem = {
  intakeId: string;
  fullName: string;
  phone: string;
  email: string;
  primaryClaimType: string;
  intakeStatus: string;
  checkUnclaimedProperty: boolean;
  createdAt: string;
  updatedAt: string;
};

function coerceQueueItem(raw: unknown): ScannerIntakeQueueItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const intakeId = typeof r.intakeId === "string" ? r.intakeId.trim() : "";
  if (!intakeId) return null;
  return {
    intakeId,
    fullName: typeof r.fullName === "string" ? r.fullName : "",
    phone: typeof r.phone === "string" ? r.phone : "",
    email: typeof r.email === "string" ? r.email : "",
    primaryClaimType:
      typeof r.primaryClaimType === "string" ? r.primaryClaimType : "",
    intakeStatus: typeof r.intakeStatus === "string" ? r.intakeStatus : "",
    checkUnclaimedProperty: Boolean(r.checkUnclaimedProperty),
    createdAt: typeof r.createdAt === "string" ? r.createdAt : "",
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : "",
  };
}

/**
 * Intakes that need an unclaimed-property scan (claims-intake-system API).
 */
export async function fetchScannerIntakeQueue(): Promise<
  | { ok: true; intakes: ScannerIntakeQueueItem[] }
  | { ok: false; message: string }
> {
  const base =
    process.env.CLAIMS_INTAKE_BASE_URL?.trim() || "http://localhost:3000";
  const url = `${base.replace(/\/$/, "")}/api/scanner/intake-queue`;

  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      return {
        ok: false,
        message: "Intake queue endpoint is not available.",
      };
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return {
        ok: false,
        message: "Intake queue endpoint is not available.",
      };
    }

    const obj = body as Record<string, unknown>;
    if (!Array.isArray(obj.intakes)) {
      return {
        ok: false,
        message: "Intake queue endpoint is not available.",
      };
    }

    const intakes: ScannerIntakeQueueItem[] = [];
    for (const row of obj.intakes) {
      const item = coerceQueueItem(row);
      if (item) intakes.push(item);
    }

    return { ok: true, intakes };
  } catch {
    return {
      ok: false,
      message: "Intake queue endpoint is not available.",
    };
  }
}
