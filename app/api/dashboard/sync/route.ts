import { safeBackendErrorMessage, syncTradingData } from "@/lib/backend-api";
import { logError, logInfo, logWarning } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  try {
    logInfo("Trading data synchronization started");
    const result = await syncTradingData();
    const fields = {
      status: result.status,
      elapsed_seconds: result.elapsed_seconds,
      completed_at: result.completed_at,
      warnings: result.warnings,
      phases: result.phases.map(({ phase, status }) => ({ phase, status })),
    };
    if (result.status === "completed_with_warnings") {
      logWarning("Trading data synchronization completed with warnings", fields);
    } else {
      logInfo("Trading data synchronization completed", fields);
    }
    return Response.json({ ok: true, data: result });
  } catch (error) {
    const internalMessage = error instanceof Error ? error.message : String(error);
    logError("Trading data synchronization failed", { error: internalMessage });
    return Response.json(
      {
        ok: false,
        error: {
          code: "synchronization_failed",
          message: safeBackendErrorMessage(error),
        },
        data: null,
      },
      { status: 503 },
    );
  }
}
