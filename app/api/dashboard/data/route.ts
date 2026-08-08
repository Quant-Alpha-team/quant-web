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

function stringListValue(value: unknown, fallback: string) {
  const isArrayValue = Array.isArray(value);
  const values = (isArrayValue ? value : [value])
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  const uniqueValues = [...new Set(values)];
  if (uniqueValues.includes("ALL")) {
    return ["ALL"];
  }
  return uniqueValues.length > 0 || isArrayValue ? uniqueValues : [fallback];
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
    const body = (await request.json()) as Partial<DashboardQuery> & {
      strategy?: string;
      strategyFamily?: string;
      strategyVersion?: string;
    };
    const today = new Date().toISOString().slice(0, 10);
    const strategyFamilies = stringListValue(
      body.strategyFamilies ?? body.strategyFamily ?? body.strategy,
      "ALL",
    );
    const query: DashboardQuery = {
      strategyFamilies,
      strategyVersions:
        strategyFamilies.length === 0
          ? []
          : strategyFamilies.includes("ALL")
            ? ["ALL"]
            : stringListValue(body.strategyVersions ?? body.strategyVersion, "ALL"),
      accountId: stringValue(body.accountId, "ALL"),
      startDate: stringValue(body.startDate, today),
      endDate: stringValue(body.endDate, today),
      timezone: stringValue(body.timezone, "America/New_York"),
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
      strategy_family: query.strategyFamilies.join(","),
      strategy_version: query.strategyVersions.join(","),
      account: query.accountId,
      start: query.startDate,
      end: query.endDate,
      tz: query.timezone,
    });

    const strategyScopes = query.strategyFamilies.includes("ALL")
      ? [{ strategyFamily: "ALL", strategyVersion: "ALL" }]
      : query.strategyFamilies.flatMap((strategyFamily) =>
          query.strategyVersions.includes("ALL")
            ? [{ strategyFamily, strategyVersion: "ALL" }]
            : query.strategyVersions.map((strategyVersion) => ({
                strategyFamily,
                strategyVersion,
              })),
        );

    const [execBatches, perfRows, pnlBatches, positionBatches] = await Promise.all([
      query.includeExec
        ? Promise.all(
            strategyScopes.map((scope) =>
              getTradeExecutions({
                ...scope,
                accountId: query.accountId,
                startDate: query.startDate,
                endDate: query.endDate,
                timezone: query.timezone,
              }),
            ),
          )
        : Promise.resolve([]),
      query.includePerf ? getAccountEquityHistory(query) : Promise.resolve([]),
      query.includePnl
        ? Promise.all(
            strategyScopes.map((scope) =>
              getStrategyDailyPnl({
                ...scope,
                accountId: query.accountId,
                startDate: query.startDate,
                endDate: query.endDate,
                timezone: query.timezone,
              }),
            ),
          )
        : Promise.resolve([]),
      query.includePositions
        ? Promise.all(
            strategyScopes.map((scope) =>
              getStrategyPositions({
                ...scope,
                accountId: query.accountId,
                endDate: query.endDate,
                timezone: query.timezone,
              }),
            ),
          )
        : Promise.resolve([]),
    ]);

    const data: DashboardData = {
      execRows: execBatches.flat(),
      perfRows,
      pnlRows: pnlBatches.flat(),
      positionRows: positionBatches.flat(),
    };
    const { execRows, pnlRows, positionRows } = data;
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
