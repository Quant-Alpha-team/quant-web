import { getReconciliationStatus, safeBackendErrorMessage } from "@/lib/backend-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return Response.json({ ok: true, data: await getReconciliationStatus() });
  } catch (error) {
    return Response.json({ ok: false, error: { code: "status_failed", message: safeBackendErrorMessage(error) } }, { status: 503 });
  }
}
