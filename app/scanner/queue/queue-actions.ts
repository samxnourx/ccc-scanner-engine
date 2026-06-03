"use server";

import { revalidatePath } from "next/cache";

import { hideIntakesFromScanQueue } from "@/lib/scanner/intake-scan-store";

export async function removeSelectedIntakesFromQueue(
  intakeIds: string[],
): Promise<{ ok: boolean; removedCount: number; error?: string }> {
  try {
    const removedCount = await hideIntakesFromScanQueue(intakeIds);
    revalidatePath("/scanner/queue");
    return { ok: true, removedCount };
  } catch (error) {
    return {
      ok: false,
      removedCount: 0,
      error:
        error instanceof Error
          ? error.message
          : "Could not remove selected queue rows.",
    };
  }
}
