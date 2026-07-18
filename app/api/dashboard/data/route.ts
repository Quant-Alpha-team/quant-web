import {
  BackendApiError,
  getAccountEquityHistory,
  getStrategyDailyPnl,
  getStrategyPositions,
  getTradeExecutions,
} from "@/lib/backend-api";
import { logError, logInfo } from "@/lib/logger";
import type { DashboardData, DashboardQuery, SectionId } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const sectionLabels: Record<SectionId, string> = {
  overview: "\u{1F4C8} Overview",
  "strategy-pnl": "\u{1F4CA} Strategy P&L",
  "account-equity": "\u{1F3E6} Account Equity",
  positions: "\u{1F4BC} Positions",
  "trade-logs": "\u{1F4DD} Trade Logs",
  diagnostics: "Diagnostics",
};

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function sectionValue(value: unknown): SectionId {
  return typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(sectionLabels, value)
    ? (value as SectionId)
    : "overview";
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
      section: sectionValue(body.section),
      includeExec: boolValue(body.includeExec),
      includePerf: boolValue(body.includePerf),
      includePnl: boolValue(body.includePnl),
      includePositions: boolValue(body.includePositions),
    };

    logInfo("Dashboard session started", {
      page: "Quant Alpha Performance Dashboard",
      layout: "wide",
    });
    logInfo("Filters applied", {
      strategy: query.strategy,
      account: query.accountId,
      start: query.startDate,
      end: query.endDate,
      tz: query.timezone,
    });

    const [execRows, perfRows, pnlRows, positionRows] = await Promise.all([
      query.includeExec ? getTradeExecutions(query) : Promise.resolve([]),
      query.includePerf ? getAccountEquityHistory(query) : Promise.resolve([]),
      query.includePnl ? getStrategyDailyPnl(query) : Promise.resolve([]),
      query.includePositions ? getStrategyPositions(query) : Promise.resolve([]),
    ]);

    const data: DashboardData = { execRows, perfRows, pnlRows, positionRows };
    logInfo("Data loaded", {
      section: sectionLabels[query.section],
      exec_rows: execRows.length,
      equity_rows: perfRows.length,
      pnl_rows: pnlRows.length,
      position_rows: positionRows.length,
    });
    return Response.json({ ok: true, data });
  } catch (error) {
    const message =
      error instanceof BackendApiError || error instanceof Error
        ? error.message
        : String(error);
    logError("Data load failed", { error: message });
    return Response.json(
      {
        ok: false,
        error: { message },
        data: { execRows: [], perfRows: [], pnlRows: [], positionRows: [] },
      },
      { status: 503 },
    );
  }
}
