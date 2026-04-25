import { BackendApiError, getFilters } from "@/lib/backend-api";
import { logError, logInfo } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const filters = await getFilters();
    logInfo("Filter metadata loaded", {
      strategies: filters.strategies.length,
      accounts: filters.accounts.length,
    });
    return Response.json({ ok: true, data: filters });
  } catch (error) {
    const message =
      error instanceof BackendApiError || error instanceof Error
        ? error.message
        : String(error);
    logError("Filter metadata failed", { error: message });
    return Response.json(
      { ok: false, error: { message }, data: { strategies: [], accounts: [] } },
      { status: 503 },
    );
  }
}
