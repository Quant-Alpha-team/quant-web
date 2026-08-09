import {
  createBackendDatasetRowBudgets,
  getAccountEquityHistory,
  getStrategyDailyPnl,
  getStrategyPositions,
  getTradeExecutions,
  safeBackendErrorMessage,
  type BackendRowsResult,
} from "@/lib/backend-api";
import { todayInTimeZone } from "@/lib/dashboard";
import { logError, logInfo, logWarning } from "@/lib/logger";
import type {
  AccountEquity,
  DashboardData,
  DashboardQuery,
  DatasetMetadata,
  SectionId,
  StrategyDailyPnl,
  StrategyPosition,
  StrategyScope,
  TradeExecution,
} from "@/lib/types";

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

const MAX_FILTER_VALUES = 100;
const MAX_STRATEGY_SCOPES = 1000;
const MAX_SCOPE_CONCURRENCY = 8;

class ClientInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientInputError";
  }
}

type LoadedDataset<T> = {
  rows: T[];
  meta: DatasetMetadata;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function inputString(
  value: unknown,
  field: string,
  fallback?: string,
  maxLength = 128,
) {
  if (value === undefined && fallback !== undefined) {
    return fallback;
  }
  if (typeof value !== "string") {
    throw new ClientInputError(`${field} must be a string.`);
  }
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > maxLength ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new ClientInputError(`${field} contains an invalid value.`);
  }
  return normalized;
}

function inputStringList(
  value: unknown,
  field: string,
  fallback: string[],
  maxLength = 128,
) {
  if (value === undefined) {
    return fallback;
  }
  if (!Array.isArray(value) || value.length > MAX_FILTER_VALUES) {
    throw new ClientInputError(`${field} must be an array of at most ${MAX_FILTER_VALUES} strings.`);
  }
  const values = value.map((item, index) =>
    inputString(item, `${field}[${index}]`, undefined, maxLength),
  );
  const uniqueValues = [...new Set(values)];
  return uniqueValues.includes("ALL") ? ["ALL"] : uniqueValues;
}

function inputBoolean(value: unknown, field: string) {
  if (value === undefined) {
    return false;
  }
  if (typeof value !== "boolean") {
    throw new ClientInputError(`${field} must be a boolean.`);
  }
  return value;
}

function inputSection(value: unknown): SectionId {
  const section = inputString(value, "section", "overview", 32);
  if (!Object.prototype.hasOwnProperty.call(sectionLabels, section)) {
    throw new ClientInputError("section is not supported.");
  }
  return section as SectionId;
}

function inputDate(value: unknown, field: string, fallback: string) {
  const date = inputString(value, field, fallback, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new ClientInputError(`${field} must use YYYY-MM-DD format.`);
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new ClientInputError(`${field} is not a valid calendar date.`);
  }
  return date;
}

function inputTimezone(value: unknown) {
  const timezone = inputString(value, "timezone", "America/New_York");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new ClientInputError("timezone is not a supported IANA time zone.");
  }
  return timezone;
}

function inputScopes(value: unknown): StrategyScope[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length > MAX_STRATEGY_SCOPES) {
    throw new ClientInputError(
      `strategyScopes must be an array of at most ${MAX_STRATEGY_SCOPES} entries.`,
    );
  }
  const scopes = value.map((rawScope, index) => {
    if (!isRecord(rawScope)) {
      throw new ClientInputError(`strategyScopes[${index}] must be an object.`);
    }
    return {
      strategyFamily: inputString(
        rawScope.strategyFamily,
        `strategyScopes[${index}].strategyFamily`,
        undefined,
        255,
      ),
      strategyVersion: inputString(
        rawScope.strategyVersion,
        `strategyScopes[${index}].strategyVersion`,
        undefined,
        255,
      ),
    };
  });
  return [...new Map(scopes.map((scope) => [
    `${scope.strategyFamily}\u0000${scope.strategyVersion}`,
    scope,
  ])).values()];
}

async function parseQuery(request: Request): Promise<DashboardQuery> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ClientInputError("Request body must be valid JSON.");
  }
  if (!isRecord(body)) {
    throw new ClientInputError("Request body must be a JSON object.");
  }

  const timezone = inputTimezone(body.timezone);
  const today = todayInTimeZone(timezone);
  const strategyFamilies = inputStringList(
    body.strategyFamilies,
    "strategyFamilies",
    ["ALL"],
    255,
  );
  const strategyVersions = strategyFamilies.includes("ALL")
    ? ["ALL"]
    : inputStringList(
        body.strategyVersions,
        "strategyVersions",
        ["ALL"],
        255,
      );
  const startDate = inputDate(body.startDate, "startDate", today);
  const endDate = inputDate(body.endDate, "endDate", today);
  if (startDate > endDate) {
    throw new ClientInputError("startDate must be on or before endDate.");
  }

  const strategyScopes = inputScopes(body.strategyScopes);
  if (strategyScopes) {
    for (const scope of strategyScopes) {
      if (
        !strategyFamilies.includes("ALL") &&
        !strategyFamilies.includes(scope.strategyFamily)
      ) {
        throw new ClientInputError(
          "strategyScopes contains a family outside strategyFamilies.",
        );
      }
      if (
        !strategyVersions.includes("ALL") &&
        !strategyVersions.includes(scope.strategyVersion)
      ) {
        throw new ClientInputError(
          "strategyScopes contains a version outside strategyVersions.",
        );
      }
    }
  }

  return {
    strategyFamilies,
    strategyVersions,
    strategyScopes,
    accountId: inputString(body.accountId, "accountId", "ALL", 50),
    startDate,
    endDate,
    timezone,
    section: inputSection(body.section),
    includeExec: inputBoolean(body.includeExec, "includeExec"),
    includePerf: inputBoolean(body.includePerf, "includePerf"),
    includePnl: inputBoolean(body.includePnl, "includePnl"),
    includePositions: inputBoolean(body.includePositions, "includePositions"),
  };
}

function resolveStrategyScopes(query: DashboardQuery): StrategyScope[] {
  if (query.strategyFamilies.length === 0) {
    return [];
  }
  if (query.strategyFamilies.includes("ALL")) {
    return [{ strategyFamily: "ALL", strategyVersion: "ALL" }];
  }
  if (query.strategyVersions.includes("ALL")) {
    return query.strategyFamilies.map((strategyFamily) => ({
      strategyFamily,
      strategyVersion: "ALL",
    }));
  }
  if (query.strategyScopes === undefined) {
    throw new ClientInputError(
      "strategyScopes is required when specific strategy versions are selected.",
    );
  }
  return query.strategyScopes;
}

function concurrencyLimit() {
  const configured = Number(process.env.DASHBOARD_API_CONCURRENCY ?? 4);
  return Number.isFinite(configured)
    ? Math.min(Math.max(Math.floor(configured), 1), MAX_SCOPE_CONCURRENCY)
    : 4;
}

function createLimiter(maxConcurrent: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const advance = () => {
    while (active < maxConcurrent && queue.length > 0) {
      const run = queue.shift();
      if (run) {
        active += 1;
        run();
      }
    }
  };

  return function limit<T>(task: () => Promise<T>) {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        task()
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            advance();
          });
      });
      advance();
    });
  };
}

function unrequestedMetadata(): DatasetMetadata {
  return {
    requested: false,
    fetched: 0,
    total: 0,
    truncated: false,
    complete: true,
    error: null,
    invalidRows: 0,
    scopes: {
      requested: 0,
      completed: 0,
      incomplete: 0,
      failed: 0,
      incompleteLabels: [],
      failedLabels: [],
    },
  };
}

function combineSettled<T>(
  requested: boolean,
  settled: PromiseSettledResult<BackendRowsResult<T>>[],
  labels: string[],
): LoadedDataset<T> {
  if (!requested) {
    return { rows: [], meta: unrequestedMetadata() };
  }
  const rows: T[] = [];
  const errors = new Set<string>();
  let invalidRows = 0;
  let truncated = false;
  let completed = 0;
  let incomplete = 0;
  let failed = 0;
  const incompleteLabels: string[] = [];
  const failedLabels: string[] = [];
  let total = 0;
  let totalKnown = true;

  for (const [index, item] of settled.entries()) {
    const label = labels[index] ?? `scope ${index + 1}`;
    if (item.status === "rejected") {
      errors.add(safeBackendErrorMessage(item.reason));
      totalKnown = false;
      failed += 1;
      failedLabels.push(label);
      logError("Dashboard dataset scope failed unexpectedly", {
        scope: label,
        error: item.reason instanceof Error
          ? item.reason.message
          : String(item.reason),
      });
      continue;
    }
    rows.push(...item.value.rows);
    invalidRows += item.value.meta.invalidRows;
    truncated ||= item.value.meta.truncated;
    if (item.value.meta.failed) {
      failed += 1;
      failedLabels.push(label);
    } else if (item.value.meta.complete) {
      completed += 1;
    } else {
      incomplete += 1;
      incompleteLabels.push(label);
    }
    if (item.value.meta.error) {
      errors.add(item.value.meta.error);
    }
    if (item.value.meta.total === null) {
      totalKnown = false;
    } else {
      total += item.value.meta.total;
    }
  }
  if (truncated) {
    errors.add("Result was truncated by the configured row limit.");
  }
  return {
    rows,
    meta: {
      requested: true,
      fetched: rows.length,
      total: totalKnown ? total : null,
      truncated,
      complete:
        failed === 0 &&
        incomplete === 0 &&
        !truncated &&
        invalidRows === 0,
      error: errors.size > 0 ? [...errors].join(" ") : null,
      invalidRows,
      scopes: {
        requested: settled.length,
        completed,
        incomplete,
        failed,
        incompleteLabels,
        failedLabels,
      },
    },
  };
}

async function loadScopes<T>(
  requested: boolean,
  scopes: StrategyScope[],
  limit: <R>(task: () => Promise<R>) => Promise<R>,
  loader: (scope: StrategyScope) => Promise<BackendRowsResult<T>>,
): Promise<LoadedDataset<T>> {
  if (!requested) {
    return { rows: [], meta: unrequestedMetadata() };
  }
  const settled = await Promise.allSettled(
    scopes.map((scope) => limit(() => loader(scope))),
  );
  const labels = scopes.map(
    (scope) => `${scope.strategyFamily} / ${scope.strategyVersion}`,
  );
  return combineSettled(true, settled, labels);
}

async function loadSingle<T>(
  requested: boolean,
  limit: <R>(task: () => Promise<R>) => Promise<R>,
  loader: () => Promise<BackendRowsResult<T>>,
): Promise<LoadedDataset<T>> {
  if (!requested) {
    return { rows: [], meta: unrequestedMetadata() };
  }
  return combineSettled(
    true,
    await Promise.allSettled([limit(loader)]),
    ["account-wide"],
  );
}

export async function POST(request: Request) {
  const requestedAt = new Date().toISOString();
  try {
    const query = await parseQuery(request);
    const strategyScopes = resolveStrategyScopes(query);
    const limit = createLimiter(concurrencyLimit());
    const rowBudgets = createBackendDatasetRowBudgets();

    logInfo("Filters applied", {
      strategy_family: query.strategyFamilies.join(","),
      strategy_version: query.strategyVersions.join(","),
      strategy_scopes: strategyScopes.length,
      account: query.accountId,
      start: query.startDate,
      end: query.endDate,
      tz: query.timezone,
    });

    const [executions, equity, pnl, positions] = await Promise.all([
      loadScopes<TradeExecution>(
        query.includeExec,
        strategyScopes,
        limit,
        (scope) => getTradeExecutions({
          ...scope,
          accountId: query.accountId,
          startDate: query.startDate,
          endDate: query.endDate,
          timezone: query.timezone,
          rowBudget: rowBudgets.executions,
        }),
      ),
      loadSingle<AccountEquity>(query.includePerf, limit, () =>
        getAccountEquityHistory({
          ...query,
          rowBudget: rowBudgets.equity,
        }),
      ),
      loadScopes<StrategyDailyPnl>(
        query.includePnl,
        strategyScopes,
        limit,
        (scope) => getStrategyDailyPnl({
          ...scope,
          accountId: query.accountId,
          startDate: query.startDate,
          endDate: query.endDate,
          timezone: query.timezone,
          rowBudget: rowBudgets.pnl,
        }),
      ),
      loadScopes<StrategyPosition>(
        query.includePositions,
        strategyScopes,
        limit,
        (scope) => getStrategyPositions({
          ...scope,
          accountId: query.accountId,
          endDate: query.endDate,
          timezone: query.timezone,
          rowBudget: rowBudgets.positions,
        }),
      ),
    ]);

    const datasets = {
      executions: executions.meta,
      equity: equity.meta,
      pnl: pnl.meta,
      positions: positions.meta,
    };
    const data: DashboardData = {
      execRows: executions.rows,
      perfRows: equity.rows,
      pnlRows: pnl.rows,
      positionRows: positions.rows,
      meta: {
        requestedAt,
        completedAt: new Date().toISOString(),
        partial: Object.values(datasets).some(
          (dataset) => dataset.requested && !dataset.complete,
        ),
        datasets,
      },
    };
    const requestedDatasets = Object.entries(datasets).filter(
      ([, metadata]) => metadata.requested,
    );
    const allRequestedDatasetsUnavailable =
      requestedDatasets.length > 0 &&
      requestedDatasets.every(
        ([, metadata]) => metadata.fetched === 0 && !metadata.complete,
      );
    if (allRequestedDatasetsUnavailable) {
      logError("All requested dashboard datasets were unavailable", {
        datasets: requestedDatasets.map(([name, metadata]) => ({
          name,
          error: metadata.error,
          failed_scopes: metadata.scopes.failed,
          incomplete_scopes: metadata.scopes.incomplete,
        })),
      });
      return Response.json(
        {
          ok: false,
          error: {
            code: "dashboard_data_unavailable",
            message: "Dashboard data is currently unavailable.",
          },
        },
        { status: 503 },
      );
    }

    logInfo("Data loaded", {
      section: sectionLabels[query.section],
      exec_rows: data.execRows.length,
      equity_rows: data.perfRows.length,
      pnl_rows: data.pnlRows.length,
      position_rows: data.positionRows.length,
      partial: data.meta.partial,
    });
    return Response.json({ ok: true, data });
  } catch (error) {
    if (error instanceof ClientInputError) {
      logWarning("Dashboard request rejected", { error: error.message });
      return Response.json(
        { ok: false, error: { code: "invalid_request", message: error.message } },
        { status: 400 },
      );
    }
    const internalMessage = error instanceof Error ? error.message : String(error);
    logError("Data load failed", { error: internalMessage });
    return Response.json(
      {
        ok: false,
        error: {
          code: "dashboard_data_failed",
          message: "Dashboard data could not be loaded.",
        },
      },
      { status: 503 },
    );
  }
}
