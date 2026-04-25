import { BackendApiError, pingBackend } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await pingBackend();
    return Response.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof BackendApiError || error instanceof Error
        ? error.message
        : String(error);
    return Response.json({ ok: false, error: { message } }, { status: 503 });
  }
}

