import { BackendApiError, getReconciliationStatus, safeBackendErrorMessage, syncTradingData } from "@/lib/backend-api";
import { logError, logInfo, logWarning } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Browsers always send Origin on POST. A mismatch means another site (or another
// localhost port) is driving the request, so it must not start a reconciliation.
// Requests without Origin come from non-browser clients and are not CSRF vectors.
function isCrossOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

export async function POST(request: Request) {
  if (isCrossOrigin(request)) {
    logWarning("Rejected cross-origin synchronization request", { origin: request.headers.get("origin") });
    return Response.json(
      { ok: false, error: { code: "forbidden_origin", message: "Cross-origin synchronization requests are not allowed." } },
      { status: 403 },
    );
  }
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
    if (error instanceof BackendApiError && error.status === 409 && error.code === "sync_in_progress") {
      return Response.json({ ok: false, error: { code: error.code, message: error.clientMessage } }, { status: 409 });
    }
    // A transport timeout does not cancel the backend's reconciliation.
    // Check ownership before deciding whether the browser should keep waiting.
    if (error instanceof BackendApiError && error.code === "backend_transport_failure") {
      try {
        const status = await getReconciliationStatus();
        if (status?.status === "in_progress") {
          return Response.json({ ok: false, error: {
            code: "sync_in_progress",
            message: "Trading data synchronization is already in progress.",
          } }, { status: 409 });
        }
      } catch {
        // An unavailable status or an idle lease cannot establish success.
      }
    }
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
