"use server";

import { revalidatePath } from "next/cache";

import {
  type EmailEnrichmentTargetType,
  runEmailEnrichment,
} from "@/lib/scanner/email-enrichment";

function validTargetType(value: string): value is EmailEnrichmentTargetType {
  return ["lead_business", "lead_discovery", "prospect"].includes(value);
}

export async function runEmailEnrichmentAction(input: {
  targetType: string;
  targetId: string;
  revalidatePaths?: string[];
}): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const targetType = input.targetType.trim();
  const targetId = input.targetId.trim();
  if (!validTargetType(targetType)) {
    return { ok: false, error: "Invalid enrichment target." };
  }
  if (!targetId) return { ok: false, error: "Missing enrichment target ID." };

  try {
    const result = await runEmailEnrichment({ type: targetType, id: targetId });
    for (const path of input.revalidatePaths ?? []) {
      revalidatePath(path);
    }
    revalidatePath("/scanner/leads");
    revalidatePath("/scanner/prospects");
    return { ok: true, message: result.message };
  } catch (e) {
    console.error("[email-enrichment] action failed", e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
