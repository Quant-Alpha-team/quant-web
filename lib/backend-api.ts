import type {
  AccountOption,
  AccountEquity,
  FilterOptions,
  StrategyFamilyOption,
  StrategyDailyPnl,
  StrategyPosition,
  StrategyScope,
  TradeExecution,
} from "@/lib/types";
import { logError, logWarning } from "@/lib/logger";
import { TRADE_EXECUTION_ROW_SCHEMA } from "@/lib/trade-executions";
import {
  normalizeReconciliationSyncResult,
  type ReconciliationSyncResult,
} from "./reconciliation";

type ApiEnvelope<T> = {
  ok: boolean;
  data?: T;
  meta?: {
    has_next?: boolean;
    next_offset?: number | string | null;
    total_count?: number | string | null;
  };
  error?: {
    code?: string;
    message?: string;
  };
};

type RequestJsonOptions = {
  method?: "GET" | "POST";
  queryParams?: Record<string, string | number>;
  requireAuth?: boolean;
  timeoutSeconds?: number;
};

export class BackendApiError extends Error {
  readonly clientMessage: string;

  constructor(message: string, clientMessage = "Backend service request failed.") {
    super(message);
    this.name = "BackendApiError";
    this.clientMessage = clientMessage;
  }
}

export function safeBackendErrorMessage(error: unknown) {
  return error instanceof BackendApiError
    ? error.clientMessage
    : "Backend service request failed.";
}

export type BackendRowsResult<T> = {
  rows: T[];
  meta: {
    fetched: number;
    total: number | null;
    truncated: boolean;
    complete: boolean;
    failed: boolean;
    error: string | null;
    invalidRows: number;
  };
};

type BudgetRequest = {
  size: number;
  resolve: (reserved: number) => void;
};

export type BackendRowBudget = {
  reserve: (size: number) => Promise<number>;
  settle: (reserved: number, used: number) => void;
};

type NormalizedRow<T> = { row: T | null; invalid: boolean };
type RowNormalizer<T> = (value: unknown) => NormalizedRow<T>;
type FieldKind = "string" | "string?" | "number" | "number?";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeKnownFields<T>(
  value: unknown,
  schema: Record<string, FieldKind>,
): NormalizedRow<T> {
  if (!isRecord(value)) {
    return { row: null, invalid: true };
  }

  // Only copy the dashboard contract. This keeps obsolete or unexpectedly
  // large backend fields out of the browser response.
  const row: Record<string, unknown> = {};
  let invalid = false;
  for (const [key, kind] of Object.entries(schema)) {
    const raw = value[key];
    const nullable = kind.endsWith("?");
    if (raw === undefined) {
      invalid ||= !nullable;
    } else if (raw === null) {
      if (nullable) row[key] = null;
      else invalid = true;
    } else if (kind.startsWith("string")) {
      if (typeof raw !== "string") invalid = true;
      else if (raw.trim()) row[key] = raw.trim();
      else invalid ||= !nullable;
    } else {
      const normalized = finiteNumber(raw);
      if (normalized === undefined) invalid = true;
      else row[key] = normalized;
    }
  }
  return { row: invalid ? null : (row as T), invalid };
}

const rowNormalizer = <T>(
  schema: Record<string, FieldKind>,
): RowNormalizer<T> => (value) => normalizeKnownFields<T>(value, schema);

function boolEnv(name: string, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined) {
    return fallback;
  }
  return ["1", "true", "yes", "y", "on"].includes(raw.trim().toLowerCase());
}

function intEnv(name: string, fallback: number, max?: number) {
  const raw = Number(process.env[name] ?? fallback);
  const value = Number.isFinite(raw) ? raw : fallback;
  const normalized = value <= 0 ? fallback : Math.floor(value);
  return max ? Math.min(normalized, max) : normalized;
}

function optionalRowCap(name: string, fallback: number) {
  const raw = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(raw) || raw < 0) {
    return fallback;
  }
  if (raw === 0) {
    return undefined;
  }
  const normalized = Math.floor(raw);
  return normalized > 0 ? normalized : fallback;
}

const apiConfig = {
  baseUrl: (
    process.env.API_BASE_URL ||
    process.env.BASE_URL ||
    "http://127.0.0.1:8000"
  ).replace(/\/+$/, ""),
  token: (process.env.API_TOKEN || "").trim().replace(/^token\s+/i, ""),
  authDisabled: boolEnv("API_AUTH_DISABLED", false),
  timeoutSeconds: intEnv("API_TIMEOUT_SECONDS", 15),
  syncTimeoutSeconds: intEnv("API_SYNC_TIMEOUT_SECONDS", 180),
  pageSize: intEnv("API_PAGE_SIZE", 500, 2000),
  maxExecRows: optionalRowCap("API_MAX_EXEC_ROWS", 5000),
  maxPerfRows: optionalRowCap("API_MAX_PERF_ROWS", 5000),
  maxPnlRows: optionalRowCap("API_MAX_PNL_ROWS", 5000),
  maxPositionRows: optionalRowCap("API_MAX_POSITION_ROWS", 5000),
};

function createRowBudget(limit: number | undefined): BackendRowBudget {
  if (limit === undefined) {
    return {
      reserve: async (size) => Math.max(0, Math.floor(size)),
      settle: () => undefined,
    };
  }

  let available = limit;
  let inFlight = 0;
  const pending: BudgetRequest[] = [];

  const drain = () => {
    while (available > 0 && pending.length > 0) {
      const request = pending.shift();
      if (!request) {
        break;
      }
      const reserved = Math.min(request.size, available);
      available -= reserved;
      inFlight += 1;
      request.resolve(reserved);
    }
    if (available === 0 && inFlight === 0) {
      for (const request of pending.splice(0)) {
        request.resolve(0);
      }
    }
  };

  return {
    reserve(size) {
      const normalizedSize = Math.max(0, Math.floor(size));
      if (normalizedSize === 0) {
        return Promise.resolve(0);
      }
      return new Promise<number>((resolve) => {
        pending.push({ size: normalizedSize, resolve });
        drain();
      });
    },
    settle(reserved, used) {
      const normalizedReserved = Math.max(0, Math.floor(reserved));
      if (normalizedReserved === 0) {
        return;
      }
      const normalizedUsed = Math.min(
        normalizedReserved,
        Math.max(0, Math.floor(used)),
      );
      available += normalizedReserved - normalizedUsed;
      inFlight = Math.max(0, inFlight - 1);
      drain();
    },
  };
}

export function createBackendDatasetRowBudgets() {
  return {
    executions: createRowBudget(apiConfig.maxExecRows),
    equity: createRowBudget(apiConfig.maxPerfRows),
    pnl: createRowBudget(apiConfig.maxPnlRows),
    positions: createRowBudget(apiConfig.maxPositionRows),
  };
}

async function requestJson<T>(
  path: string,
  options: RequestJsonOptions = {},
) {
  const requireAuth = options.requireAuth ?? true;
  if (requireAuth && !apiConfig.authDisabled && !apiConfig.token) {
    throw new BackendApiError(
      "Missing API token. Set API_TOKEN or API_AUTH_DISABLED=true.",
      "Dashboard backend is not configured.",
    );
  }

  const url = new URL(`${apiConfig.baseUrl}${path}`);
  for (const [key, value] of Object.entries(options.queryParams ?? {})) {
    url.searchParams.set(key, String(value));
  }

  const headers: HeadersInit = {
    Accept: "application/json",
  };
  if (requireAuth && !apiConfig.authDisabled) {
    headers.Authorization = `Token ${apiConfig.token}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    (options.timeoutSeconds ?? apiConfig.timeoutSeconds) * 1000,
  );

  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      headers,
      method: options.method ?? "GET",
      signal: controller.signal,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new BackendApiError(
      `Failed to connect to backend API at ${apiConfig.baseUrl}: ${message}`,
      "Backend service is unavailable.",
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = (await response.text()).slice(0, 1000);
    throw new BackendApiError(
      `API request failed (${response.status}) for ${path}: ${body}`,
      "Backend service rejected the data request.",
    );
  }

  let rawPayload: unknown;
  try {
    rawPayload = await response.json();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new BackendApiError(
      `Invalid JSON response from ${path}: ${message}`,
      "Backend returned an invalid response.",
    );
  }
  if (!isRecord(rawPayload)) {
    throw new BackendApiError(
      `Unexpected API payload type from ${path}`,
      "Backend returned an invalid response.",
    );
  }
  const payload = rawPayload as ApiEnvelope<T>;
  if (payload.ok !== true) {
    const code = payload.error?.code ?? "unknown_error";
    const message = payload.error?.message ?? "Unknown API error";
    throw new BackendApiError(
      `API error (${code}) at ${path}: ${message}`,
      "Backend could not complete the data request.",
    );
  }
  return payload;
}

function responseTotal(meta: ApiEnvelope<unknown>["meta"]) {
  const total = finiteNumber(meta?.total_count);
  return total !== undefined && total >= 0 && Number.isInteger(total)
    ? total
    : null;
}

async function fetchAllPages<T>(
  path: string,
  baseParams: Record<string, string | number>,
  normalizeRow: RowNormalizer<T>,
  rowBudget: BackendRowBudget,
) : Promise<BackendRowsResult<T>> {
  const rows: T[] = [];
  let offset = 0;
  let receivedRows = 0;
  let invalidRows = 0;
  let total: number | null = null;

  const result = (
    complete: boolean,
    error: string | null,
    truncated = false,
    failed = false,
  ): BackendRowsResult<T> => ({
    rows,
    meta: {
      fetched: rows.length,
      total,
      truncated,
      complete: complete && invalidRows === 0 && !truncated,
      failed,
      error:
        error ??
        (invalidRows > 0
          ? `${invalidRows} backend row(s) contained invalid fields and were omitted.`
          : null),
      invalidRows,
    },
  });

  for (let page = 0; page < 10000; page += 1) {
    const requestLimit = await rowBudget.reserve(apiConfig.pageSize);
    if (requestLimit === 0) {
      return result(false, null, true);
    }

    let payload: ApiEnvelope<unknown[]>;
    try {
      payload = await requestJson<unknown[]>(path, {
        queryParams: {
          ...baseParams,
          limit: requestLimit,
          offset,
        },
      });
    } catch (error) {
      rowBudget.settle(requestLimit, 0);
      logError("Backend data page request failed", {
        path,
        offset,
        received_rows: receivedRows,
        error: error instanceof Error ? error.message : String(error),
      });
      return result(
        false,
        safeBackendErrorMessage(error),
        false,
        receivedRows === 0,
      );
    }
    const pageRows = payload.data;
    if (!Array.isArray(pageRows)) {
      rowBudget.settle(requestLimit, 0);
      logWarning("Backend returned a non-array data page", { path, offset });
      return result(
        false,
        "Backend returned an invalid data page.",
        false,
        receivedRows === 0,
      );
    }
    if (pageRows.length > requestLimit) {
      rowBudget.settle(requestLimit, requestLimit);
      logWarning("Backend data page exceeded its requested limit", {
        path,
        offset,
        requested_limit: requestLimit,
        returned_rows: pageRows.length,
      });
      return result(
        false,
        "Backend returned an oversized data page.",
        false,
        receivedRows === 0,
      );
    }
    rowBudget.settle(requestLimit, pageRows.length);

    const declaredTotal = responseTotal(payload.meta);
    if (declaredTotal !== null) {
      total = declaredTotal;
    }
    receivedRows += pageRows.length;

    for (const rawRow of pageRows) {
      const normalized = normalizeRow(rawRow);
      if (normalized.invalid) {
        invalidRows += 1;
      }
      if (normalized.row !== null) {
        rows.push(normalized.row);
      }
    }

    const hasNext = payload.meta?.has_next;
    if (typeof hasNext !== "boolean") {
      logWarning("Backend pagination has_next metadata was invalid", {
        path,
        offset,
        has_next: hasNext ?? null,
      });
      return result(false, "Backend pagination metadata was invalid.");
    }
    const paginationError = (() => {
      if (hasNext && pageRows.length === 0) {
        return "Backend pagination reported another page after an empty page.";
      }
      if (total !== null && receivedRows > total) {
        return "Backend pagination returned more rows than its declared total.";
      }
      if (total !== null && !hasNext && receivedRows < total) {
        return "Backend pagination ended before its declared total was reached.";
      }
      if (total !== null && hasNext && receivedRows >= total) {
        return "Backend pagination continued after its declared total was reached.";
      }
      return null;
    })();
    if (paginationError) {
      logWarning("Backend pagination metadata was inconsistent", {
        path,
        offset,
        received_rows: receivedRows,
        total,
        has_next: hasNext,
        error: paginationError,
      });
      return result(false, paginationError);
    }
    if (!hasNext) {
      if (total === null) {
        total = receivedRows;
      }
      return result(true, null);
    }

    const expectedNextOffset = offset + pageRows.length;
    const rawNextOffset = payload.meta?.next_offset;
    const nextOffset = rawNextOffset === undefined || rawNextOffset === null
      ? expectedNextOffset
      : finiteNumber(rawNextOffset);
    if (
      nextOffset === undefined ||
      !Number.isInteger(nextOffset) ||
      nextOffset !== expectedNextOffset
    ) {
      logWarning("Backend pagination next offset was invalid", {
        path,
        offset,
        expected_next_offset: expectedNextOffset,
        next_offset: rawNextOffset ?? null,
      });
      return result(false, "Backend pagination metadata was invalid.");
    }
    offset = nextOffset;
  }

  logWarning("Backend pagination safety limit was exceeded", {
    path,
    received_rows: receivedRows,
  });
  return result(false, "Backend pagination safety limit was exceeded.");
}

const normalizeTradeExecution = rowNormalizer<TradeExecution>(
  TRADE_EXECUTION_ROW_SCHEMA,
);

const normalizeAccountEquity = rowNormalizer<AccountEquity>({
  date: "string",
  timestamp: "string",
  broker_account_id: "string",
  equity_value: "number",
  cash_value: "number?",
  gross_position_value: "number?",
});

const normalizeStrategyDailyPnl = rowNormalizer<StrategyDailyPnl>({
  date: "string",
  strategy_name: "string",
  strategy_family: "string",
  broker_account_id: "string",
  valuation_status: "string",
  calculation_source: "string",
  strategy_version: "string?",
  daily_pnl: "number?",
  realized_pnl: "number?",
  unrealized_pnl: "number?",
  commission: "number?",
});

const normalizeStrategyPosition = rowNormalizer<StrategyPosition>({
  snapshot_at: "string",
  strategy_name: "string",
  strategy_family: "string",
  broker_account_id: "string",
  symbol: "string",
  sec_type: "string",
  currency: "string",
  source: "string",
  strategy_version: "string?",
  local_symbol: "string?",
  expiry_date: "string?",
  right: "string?",
  quantity: "number",
  average_cost: "number",
  cost_basis: "number",
  strike: "number?",
  mark_price: "number?",
  market_value: "number?",
  day_change: "number?",
  unrealized_pnl: "number?",
  gain_loss_percent: "number?",
});

type DateRangeParams = {
  accountId: string;
  startDate: string;
  endDate: string;
  timezone: string;
  rowBudget: BackendRowBudget;
};

type ScopedDateRangeParams = DateRangeParams & StrategyScope;
type PositionParams = Omit<ScopedDateRangeParams, "startDate">;

function scopeParams(params: ScopedDateRangeParams) {
  return {
    strategy_family: params.strategyFamily,
    strategy_version: params.strategyVersion,
    account_id: params.accountId,
    start_date: params.startDate,
    end_date: params.endDate,
    tz: params.timezone,
  };
}

function invalidFilterMetadata(): never {
  throw new BackendApiError(
    "Filters API violated the strategy_families contract.",
    "Backend returned invalid filter metadata.",
  );
}

function normalizeStrategyFamilies(value: unknown[]): StrategyFamilyOption[] {
  return value
    .map((rawFamily) => {
      if (!isRecord(rawFamily)) {
        return invalidFilterMetadata();
      }
      const family =
        typeof rawFamily.family === "string" ? rawFamily.family.trim() : "";
      if (
        !family ||
        !Array.isArray(rawFamily.versions) ||
        rawFamily.versions.length === 0
      ) {
        return invalidFilterMetadata();
      }
      const versions = rawFamily.versions.map((rawVersion) => {
        if (!isRecord(rawVersion)) {
          return invalidFilterMetadata();
        }
        const strategyName =
          typeof rawVersion.strategy_name === "string"
            ? rawVersion.strategy_name.trim()
            : "";
        const version = rawVersion.version;
        if (
          !strategyName ||
          (version !== null &&
            (typeof version !== "string" || !version.trim())) ||
          typeof rawVersion.is_active !== "boolean"
        ) {
          return invalidFilterMetadata();
        }
        return {
          version: version === null ? null : version.trim(),
          strategy_name: strategyName,
          is_active: rawVersion.is_active,
        };
      });
      return { family, versions };
    })
    .map((entry) => ({
      ...entry,
      versions: entry.versions.sort((left, right) =>
        (left.version ?? "").localeCompare(right.version ?? "", undefined, {
          numeric: true,
        }),
      ),
    }))
    .sort((left, right) => left.family.localeCompare(right.family));
}

export async function pingBackend() {
  await requestJson("/api/health/", { requireAuth: false });
}

export async function verifyBackendAccess() {
  // This protected endpoint is small and verifies that the dashboard's
  // server-side credentials can actually read trading metadata.
  await requestJson("/api/trading/meta/filters/");
}

function normalizeAccounts(value: unknown): AccountOption[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const accounts = new Map<string, AccountOption>();
  for (const rawAccount of value) {
    if (!isRecord(rawAccount)) {
      continue;
    }
    const accountId =
      typeof rawAccount.account_id === "string"
        ? rawAccount.account_id.trim()
        : "";
    if (!accountId) {
      continue;
    }
    const account: AccountOption = { account_id: accountId };
    accounts.set(accountId, account);
  }
  return [...accounts.values()];
}

export async function getFilters(): Promise<FilterOptions> {
  const payload = await requestJson<unknown>("/api/trading/meta/filters/");
  const data = payload.data;
  if (
    !isRecord(data) ||
    !Array.isArray(data.strategy_families) ||
    !Array.isArray(data.accounts)
  ) {
    return invalidFilterMetadata();
  }
  return {
    strategy_families: normalizeStrategyFamilies(data.strategy_families),
    accounts: normalizeAccounts(data.accounts),
  };
}

export async function syncTradingData(): Promise<ReconciliationSyncResult> {
  const payload = await requestJson<unknown>(
    "/api/trading/reconciliation/sync/",
    {
      method: "POST",
      timeoutSeconds: apiConfig.syncTimeoutSeconds,
    },
  );
  const data = payload.data;
  try {
    return normalizeReconciliationSyncResult(data);
  } catch (error) {
    throw new BackendApiError(
      `Unexpected synchronization result: ${error instanceof Error ? error.message : String(error)}`,
      "Backend returned an invalid synchronization result.",
    );
  }
}

export function getTradeExecutions(params: ScopedDateRangeParams) {
  return fetchAllPages(
    "/api/trading/trades/executions/",
    { ...scopeParams(params), order: "desc" },
    normalizeTradeExecution,
    params.rowBudget,
  );
}

export function getAccountEquityHistory(params: DateRangeParams) {
  return fetchAllPages(
    "/api/trading/accounts/equity-history/",
    {
      account_id: params.accountId,
      start_date: params.startDate,
      end_date: params.endDate,
      tz: params.timezone,
      order: "desc",
    },
    normalizeAccountEquity,
    params.rowBudget,
  );
}

export function getStrategyDailyPnl(params: ScopedDateRangeParams) {
  return fetchAllPages(
    "/api/trading/strategies/daily-pnl/",
    { ...scopeParams(params), order: "asc" },
    normalizeStrategyDailyPnl,
    params.rowBudget,
  );
}

export function getStrategyPositions(params: PositionParams) {
  return fetchAllPages(
    "/api/trading/portfolio/positions/",
    {
      strategy_family: params.strategyFamily,
      strategy_version: params.strategyVersion,
      account_id: params.accountId,
      as_of_date: params.endDate,
      tz: params.timezone,
      order: "asc",
    },
    normalizeStrategyPosition,
    params.rowBudget,
  );
}
