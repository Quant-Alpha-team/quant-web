import type {
  AccountEquity,
  FilterOptions,
  StrategyDailyPnl,
  StrategyPosition,
  TradeExecution,
} from "@/lib/types";

type ApiEnvelope<T> = {
  ok: boolean;
  data?: T;
  meta?: {
    has_next?: boolean;
    next_offset?: number | string | null;
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
  constructor(message: string) {
    super(message);
    this.name = "BackendApiError";
  }
}

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
  return raw === 0 ? undefined : Math.floor(raw);
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

async function requestJson<T>(
  path: string,
  options: RequestJsonOptions = {},
) {
  const requireAuth = options.requireAuth ?? true;
  if (requireAuth && !apiConfig.authDisabled && !apiConfig.token) {
    throw new BackendApiError(
      "Missing API token. Set API_TOKEN or API_AUTH_DISABLED=true.",
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
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new BackendApiError(
      `API request failed (${response.status}) for ${path}: ${body}`,
    );
  }

  const payload = (await response.json()) as ApiEnvelope<T>;
  if (!payload || typeof payload !== "object") {
    throw new BackendApiError(`Unexpected API payload type from ${path}`);
  }
  if (!payload.ok) {
    const code = payload.error?.code ?? "unknown_error";
    const message = payload.error?.message ?? "Unknown API error";
    throw new BackendApiError(`API error (${code}) at ${path}: ${message}`);
  }
  return payload;
}

async function fetchAllPages<T>(
  path: string,
  baseParams: Record<string, string | number>,
  maxRows?: number,
) {
  const rows: T[] = [];
  let offset = 0;

  for (let page = 0; page < 10000; page += 1) {
    const payload = await requestJson<T[]>(path, {
      queryParams: {
        ...baseParams,
        limit: apiConfig.pageSize,
        offset,
      },
    });
    const pageRows = payload.data ?? [];
    if (!Array.isArray(pageRows)) {
      throw new BackendApiError(`Unexpected response format from ${path}`);
    }
    rows.push(...pageRows);
    if (maxRows !== undefined && rows.length >= maxRows) {
      return rows.slice(0, maxRows);
    }

    if (
      !payload.meta?.has_next ||
      payload.meta.next_offset === undefined ||
      payload.meta.next_offset === null
    ) {
      return rows;
    }

    const nextOffset = Number(payload.meta.next_offset);
    if (!Number.isFinite(nextOffset) || nextOffset <= offset) {
      return rows;
    }
    offset = nextOffset;
  }

  throw new BackendApiError(`Pagination safety limit exceeded for ${path}`);
}

function scopeParams(
  strategy: string,
  accountId: string,
  startDate: string,
  endDate: string,
  timezone: string,
) {
  return {
    strategy,
    account_id: accountId,
    start_date: startDate,
    end_date: endDate,
    tz: timezone,
  };
}

export async function pingBackend() {
  await requestJson("/api/health/", { requireAuth: false });
}

export async function getFilters(): Promise<FilterOptions> {
  const payload = await requestJson<Partial<FilterOptions>>(
    "/api/trading/meta/filters/",
  );
  const data = payload.data;
  const strategies = data?.strategies;
  const accounts = data?.accounts;
  if (!Array.isArray(strategies) || !Array.isArray(accounts)) {
    throw new BackendApiError("Unexpected response format from filters API.");
  }
  return { strategies, accounts };
}

export type ReconciliationSyncResult = {
  status: "completed";
  completed_at: string;
  elapsed_seconds: number;
};

export async function syncTradingData(): Promise<ReconciliationSyncResult> {
  const payload = await requestJson<ReconciliationSyncResult>(
    "/api/trading/reconciliation/sync/",
    {
      method: "POST",
      timeoutSeconds: apiConfig.syncTimeoutSeconds,
    },
  );
  if (!payload.data) {
    throw new BackendApiError("Unexpected response format from sync API.");
  }
  return payload.data;
}

export async function getTradeExecutions(params: {
  strategy: string;
  accountId: string;
  startDate: string;
  endDate: string;
  timezone: string;
}) {
  return fetchAllPages<TradeExecution>(
    "/api/trading/trades/executions/",
    {
      ...scopeParams(
        params.strategy,
        params.accountId,
        params.startDate,
        params.endDate,
        params.timezone,
      ),
      order: "desc",
    },
    apiConfig.maxExecRows,
  );
}

export async function getAccountEquityHistory(params: {
  accountId: string;
  startDate: string;
  endDate: string;
  timezone: string;
}) {
  return fetchAllPages<AccountEquity>(
    "/api/trading/accounts/equity-history/",
    {
      ...scopeParams(
        "ALL",
        params.accountId,
        params.startDate,
        params.endDate,
        params.timezone,
      ),
      order: "asc",
    },
    apiConfig.maxPerfRows,
  );
}

export async function getStrategyDailyPnl(params: {
  strategy: string;
  accountId: string;
  startDate: string;
  endDate: string;
  timezone: string;
}) {
  return fetchAllPages<StrategyDailyPnl>(
    "/api/trading/strategies/daily-pnl/",
    {
      ...scopeParams(
        params.strategy,
        params.accountId,
        params.startDate,
        params.endDate,
        params.timezone,
      ),
      order: "asc",
    },
    apiConfig.maxPnlRows,
  );
}

export async function getStrategyPositions(params: {
  strategy: string;
  accountId: string;
  endDate: string;
  timezone: string;
}) {
  return fetchAllPages<StrategyPosition>(
    "/api/trading/portfolio/positions/",
    {
      strategy: params.strategy,
      account_id: params.accountId,
      as_of_date: params.endDate,
      tz: params.timezone,
      order: "asc",
    },
    apiConfig.maxPositionRows,
  );
}

