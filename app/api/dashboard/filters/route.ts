import { getFilters, safeBackendErrorMessage } from "@/lib/backend-api";
import { logError, logInfo } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const filters = await getFilters();
    logInfo("Filter metadata loaded", {
      strategy_families: filters.strategy_families.length,
      accounts: filters.accounts.length,
    });
    return Response.json({ ok: true, data: filters });
  } catch (error) {
    const internalMessage = error instanceof Error ? error.message : String(error);
    logError("Filter metadata failed", { error: internalMessage });
    return Response.json(
      {
        ok: false,
        error: {
          code: "filter_metadata_failed",
          message: safeBackendErrorMessage(error),
        },
        data: { strategy_families: [], accounts: [] },
      },
      { status: 503 },
    );
  }
}
