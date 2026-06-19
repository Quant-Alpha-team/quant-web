import { BackendApiError, syncTradingData } from "@/lib/backend-api";
import { logError, logInfo } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  try {
    logInfo("Trading data synchronization started");
    const result = await syncTradingData();
    logInfo("Trading data synchronization completed", {
      elapsed_seconds: result.elapsed_seconds,
      completed_at: result.completed_at,
    });
    return Response.json({ ok: true, data: result });
  } catch (error) {
    const message =
      error instanceof BackendApiError || error instanceof Error
        ? error.message
        : String(error);
    logError("Trading data synchronization failed", { error: message });
    return Response.json(
      {
        ok: false,
        error: { message },
        data: null,
      },
      { status: 503 },
    );
  }
}
