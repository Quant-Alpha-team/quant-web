import {
  pingBackend,
  safeBackendErrorMessage,
  verifyBackendAccess,
} from "@/lib/backend-api";
import { logWarning } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function unavailableResponse(
  checkedAt: string,
  error: unknown,
  reachable: boolean,
) {
  const internalMessage = error instanceof Error ? error.message : String(error);
  logWarning(
    reachable ? "Backend protected access check failed" : "Backend health check failed",
    { error: internalMessage },
  );
  return Response.json(
    {
      ok: false,
      data: {
        status: "offline",
        checkedAt,
        backend: { reachable, protectedAccess: false },
      },
      error: {
        code: reachable ? "backend_access_unavailable" : "backend_unavailable",
        message: safeBackendErrorMessage(error),
      },
    },
    { status: 503 },
  );
}

export async function GET() {
  const checkedAt = new Date().toISOString();
  try {
    await pingBackend();
  } catch (error) {
    return unavailableResponse(checkedAt, error, false);
  }

  try {
    await verifyBackendAccess();
  } catch (error) {
    return unavailableResponse(checkedAt, error, true);
  }

  return Response.json({
    ok: true,
    data: {
      status: "online",
      checkedAt,
      backend: { reachable: true, protectedAccess: true },
    },
  });
}
