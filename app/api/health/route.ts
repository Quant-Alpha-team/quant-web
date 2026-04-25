import { BackendApiError, pingBackend } from "@/lib/backend-api";
import { logWarning } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await pingBackend();
    return Response.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof BackendApiError || error instanceof Error
        ? error.message
        : String(error);
    logWarning("Health check failed", { error: message });
    return Response.json({ ok: false, error: { message } }, { status: 503 });
  }
}
