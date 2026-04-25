import { BackendApiError, getFilters } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const filters = await getFilters();
    return Response.json({ ok: true, data: filters });
  } catch (error) {
    const message =
      error instanceof BackendApiError || error instanceof Error
        ? error.message
        : String(error);
    return Response.json(
      { ok: false, error: { message }, data: { strategies: [], accounts: [] } },
      { status: 503 },
    );
  }
}

