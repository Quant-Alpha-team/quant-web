import type {
  AccountEquity,
  FilterOptions,
  StrategyFamilyOption,
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
  strategyFamily: string,
  strategyVersion: string,
  accountId: string,
  startDate: string,
  endDate: string,
  timezone: string,
) {
  return {
    strategy_family: strategyFamily,
    strategy_version: strategyVersion,
    account_id: accountId,
    start_date: startDate,
    end_date: endDate,
    tz: timezone,
  };
}

function strategyIdentityFromName(strategyName: string) {
  const match = strategyName.match(/^(.*)_(V\d+)$/i);
  return match
    ? { family: match[1], version: match[2].toUpperCase() }
    : { family: strategyName, version: null };
}

function legacyStrategyFamilies(strategies: string[]): StrategyFamilyOption[] {
  const byFamily = new Map<string, StrategyFamilyOption>();

  for (const strategyName of strategies) {
    const identity = strategyIdentityFromName(strategyName);
    const entry = byFamily.get(identity.family) ?? {
      family: identity.family,
      versions: [],
    };
    entry.versions.push({
      version: identity.version,
      strategy_name: strategyName,
      is_active: true,
    });
    byFamily.set(identity.family, entry);
  }

  return [...byFamily.values()]
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

function normalizeStrategyFamilies(
  value: unknown,
  strategies: string[],
): StrategyFamilyOption[] {
  if (!Array.isArray(value)) {
    return legacyStrategyFamilies(strategies);
  }

  const families: StrategyFamilyOption[] = [];
  for (const rawFamily of value) {
    if (!rawFamily || typeof rawFamily !== "object") {
      continue;
    }
    const familyRecord = rawFamily as Record<string, unknown>;
    const family =
      typeof familyRecord.family === "string" ? familyRecord.family.trim() : "";
    if (!family || !Array.isArray(familyRecord.versions)) {
      continue;
    }

    const versions = familyRecord.versions.flatMap((rawVersion) => {
      if (!rawVersion || typeof rawVersion !== "object") {
        return [];
      }
      const versionRecord = rawVersion as Record<string, unknown>;
      const strategyName =
        typeof versionRecord.strategy_name === "string"
          ? versionRecord.strategy_name.trim()
          : "";
      const version =
        versionRecord.version === null
          ? null
          : typeof versionRecord.version === "string" &&
              versionRecord.version.trim()
            ? versionRecord.version.trim()
            : undefined;
      if (!strategyName || version === undefined) {
        return [];
      }
      return [
        {
          version,
          strategy_name: strategyName,
          is_active:
            typeof versionRecord.is_active === "boolean"
              ? versionRecord.is_active
              : true,
        },
      ];
    });
    if (versions.length > 0) {
      families.push({ family, versions });
    }
  }

  return families.length > 0 || strategies.length === 0
    ? families
    : legacyStrategyFamilies(strategies);
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
  const normalizedStrategies = strategies.filter(
    (strategy): strategy is string => typeof strategy === "string" && Boolean(strategy.trim()),
  );
  return {
    strategies: normalizedStrategies,
    strategy_families: normalizeStrategyFamilies(
      data?.strategy_families,
      normalizedStrategies,
    ),
    accounts,
  };
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
  strategyFamily: string;
  strategyVersion: string;
  accountId: string;
  startDate: string;
  endDate: string;
  timezone: string;
}) {
  return fetchAllPages<TradeExecution>(
    "/api/trading/trades/executions/",
    {
      ...scopeParams(
        params.strategyFamily,
        params.strategyVersion,
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
      account_id: params.accountId,
      start_date: params.startDate,
      end_date: params.endDate,
      tz: params.timezone,
      order: "asc",
    },
    apiConfig.maxPerfRows,
  );
}

export async function getStrategyDailyPnl(params: {
  strategyFamily: string;
  strategyVersion: string;
  accountId: string;
  startDate: string;
  endDate: string;
  timezone: string;
}) {
  return fetchAllPages<StrategyDailyPnl>(
    "/api/trading/strategies/daily-pnl/",
    {
      ...scopeParams(
        params.strategyFamily,
        params.strategyVersion,
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
  strategyFamily: string;
  strategyVersion: string;
  accountId: string;
  endDate: string;
  timezone: string;
}) {
  return fetchAllPages<StrategyPosition>(
    "/api/trading/portfolio/positions/",
    {
      strategy_family: params.strategyFamily,
      strategy_version: params.strategyVersion,
      account_id: params.accountId,
      as_of_date: params.endDate,
      tz: params.timezone,
      order: "asc",
    },
    apiConfig.maxPositionRows,
  );
}
