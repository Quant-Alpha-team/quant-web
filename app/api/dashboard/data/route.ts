import {
  BackendApiError,
  getAccountEquityHistory,
  getStrategyDailyPnl,
  getTradeExecutions,
} from "@/lib/backend-api";
import type { DashboardData, DashboardQuery } from "@/lib/types";

export const dynamic = "force-dynamic";

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boolValue(value: unknown) {
  return value === true;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<DashboardQuery>;
    const today = new Date().toISOString().slice(0, 10);
    const query: DashboardQuery = {
      strategy: stringValue(body.strategy, "ALL"),
      accountId: stringValue(body.accountId, "ALL"),
      startDate: stringValue(body.startDate, today),
      endDate: stringValue(body.endDate, today),
      timezone: stringValue(body.timezone, "Asia/Taipei"),
      includeExec: boolValue(body.includeExec),
      includePerf: boolValue(body.includePerf),
      includePnl: boolValue(body.includePnl),
    };

    const [execRows, perfRows, pnlRows] = await Promise.all([
      query.includeExec ? getTradeExecutions(query) : Promise.resolve([]),
      query.includePerf ? getAccountEquityHistory(query) : Promise.resolve([]),
      query.includePnl ? getStrategyDailyPnl(query) : Promise.resolve([]),
    ]);

    const data: DashboardData = { execRows, perfRows, pnlRows };
    return Response.json({ ok: true, data });
  } catch (error) {
    const message =
      error instanceof BackendApiError || error instanceof Error
        ? error.message
        : String(error);
    return Response.json(
      {
        ok: false,
        error: { message },
        data: { execRows: [], perfRows: [], pnlRows: [] },
      },
      { status: 503 },
    );
  }
}

