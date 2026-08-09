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

type ApiEnvelope<T> = {
  ok: boolean;
  data?: T;
  meta?: {
    has_next?: boolean;
    next_offset?: number | string | null;
    total?: number | string | null;
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

type NormalizedRow<T> = {
  row: T | null;
  invalid: boolean;
};

type RowNormalizer<T> = (value: unknown) => NormalizedRow<T>;

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
  options: {
    strings: readonly string[];
    nullableStrings?: readonly string[];
    numbers: readonly string[];
    nullableNumbers?: readonly string[];
  },
): NormalizedRow<T> {
  if (!isRecord(value)) {
    return { row: null, invalid: true };
  }

  // Only copy the dashboard contract. This keeps obsolete or unexpectedly
  // large backend fields out of the browser response.
  const row: Record<string, unknown> = {};
  let invalid = false;
  const normalizeString = (key: string, nullable: boolean) => {
    const raw = value[key];
    if (raw === undefined) {
      invalid ||= !nullable;
    } else if (raw === null) {
      if (nullable) row[key] = null;
      else invalid = true;
    } else if (typeof raw !== "string") {
      invalid = true;
    } else if (raw.trim()) {
      row[key] = raw.trim();
    } else {
      invalid ||= !nullable;
    }
  };
  const normalizeNumber = (key: string, nullable: boolean) => {
    const raw = value[key];
    if (raw === undefined) {
      invalid ||= !nullable;
    } else if (raw === null && nullable) {
      row[key] = null;
    } else {
      const normalized = finiteNumber(raw);
      if (normalized === undefined) invalid = true;
      else row[key] = normalized;
    }
  };

  for (const key of options.strings) {
    normalizeString(key, false);
  }
  for (const key of options.nullableStrings ?? []) {
    normalizeString(key, true);
  }
  for (const key of options.numbers) {
    normalizeNumber(key, false);
  }
  for (const key of options.nullableNumbers ?? []) {
    normalizeNumber(key, true);
  }
  return { row: invalid ? null : (row as T), invalid };
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
  for (const value of [meta?.total, meta?.total_count]) {
    const normalized = finiteNumber(value);
    if (
      normalized !== undefined &&
      normalized >= 0 &&
      Number.isInteger(normalized)
    ) {
      return normalized;
    }
  }
  return null;
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

    const hasExplicitNext = typeof payload.meta?.has_next === "boolean";
    const hasNext = hasExplicitNext
      ? payload.meta?.has_next === true
      : total !== null
        ? receivedRows < total
        : pageRows.length >= requestLimit;
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

const normalizeTradeExecution: RowNormalizer<TradeExecution> = (value) =>
  normalizeKnownFields<TradeExecution>(value, {
    strings: [
      "timestamp",
      "strategy_name",
      "strategy_family",
      "broker_account_id",
      "symbol",
      "sec_type",
      "side",
      "status",
    ],
    nullableStrings: ["strategy_version", "notes"],
    numbers: ["quantity", "price"],
    nullableNumbers: ["commission", "realized_pnl"],
  });

const normalizeAccountEquity: RowNormalizer<AccountEquity> = (value) =>
  normalizeKnownFields<AccountEquity>(value, {
    strings: ["date", "timestamp", "broker_account_id"],
    numbers: ["equity_value"],
  });

const normalizeStrategyDailyPnl: RowNormalizer<StrategyDailyPnl> = (value) =>
  normalizeKnownFields<StrategyDailyPnl>(value, {
    strings: [
      "date",
      "strategy_name",
      "strategy_family",
      "broker_account_id",
      "valuation_status",
      "calculation_source",
    ],
    nullableStrings: ["strategy_version"],
    numbers: [],
    nullableNumbers: ["daily_pnl", "realized_pnl", "unrealized_pnl", "commission"],
  });

const normalizeStrategyPosition: RowNormalizer<StrategyPosition> = (value) =>
  normalizeKnownFields<StrategyPosition>(value, {
    strings: [
      "snapshot_at",
      "strategy_name",
      "strategy_family",
      "broker_account_id",
      "symbol",
      "sec_type",
      "currency",
      "source",
    ],
    nullableStrings: ["strategy_version", "local_symbol", "expiry_date", "right"],
    numbers: ["quantity", "average_cost", "cost_basis"],
    nullableNumbers: [
      "strike",
      "mark_price",
      "market_value",
      "day_change",
      "unrealized_pnl",
      "gain_loss_percent",
    ],
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

  const modernStrategyNames = new Set(
    families.flatMap((family) =>
      family.versions.map((version) => version.strategy_name),
    ),
  );
  const uncoveredStrategies = strategies.filter(
    (strategyName) => !modernStrategyNames.has(strategyName),
  );
  const merged = new Map<string, StrategyFamilyOption>();
  for (const entry of [
    ...families,
    ...legacyStrategyFamilies(uncoveredStrategies),
  ]) {
    const existing = merged.get(entry.family);
    if (!existing) {
      merged.set(entry.family, {
        family: entry.family,
        versions: [...entry.versions],
      });
      continue;
    }
    const known = new Set(
      existing.versions.map(
        (version) => `${version.version ?? ""}\u0000${version.strategy_name}`,
      ),
    );
    for (const version of entry.versions) {
      const key = `${version.version ?? ""}\u0000${version.strategy_name}`;
      if (!known.has(key)) {
        existing.versions.push(version);
        known.add(key);
      }
    }
  }
  return [...merged.values()]
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
  if (!isRecord(data)) {
    throw new BackendApiError(
      "Unexpected response format from filters API.",
      "Backend returned invalid filter metadata.",
    );
  }
  const strategies = data.strategies;
  const accounts = data.accounts;
  if (!Array.isArray(strategies) || !Array.isArray(accounts)) {
    throw new BackendApiError(
      "Unexpected response format from filters API.",
      "Backend returned invalid filter metadata.",
    );
  }
  const normalizedStrategies = [...new Set(strategies.flatMap((strategy) =>
    typeof strategy === "string" && strategy.trim() ? [strategy.trim()] : [],
  ))];
  return {
    strategy_families: normalizeStrategyFamilies(
      data.strategy_families,
      normalizedStrategies,
    ),
    accounts: normalizeAccounts(accounts),
  };
}

export type ReconciliationSyncResult = {
  status: "completed";
  completed_at: string;
  elapsed_seconds: number;
};

export async function syncTradingData(): Promise<ReconciliationSyncResult> {
  const payload = await requestJson<unknown>(
    "/api/trading/reconciliation/sync/",
    {
      method: "POST",
      timeoutSeconds: apiConfig.syncTimeoutSeconds,
    },
  );
  const data = payload.data;
  if (!isRecord(data)) {
    throw new BackendApiError(
      "Unexpected response format from sync API.",
      "Backend returned an invalid synchronization result.",
    );
  }
  const completedAt =
    typeof data.completed_at === "string" ? data.completed_at.trim() : "";
  const elapsedSeconds = finiteNumber(data.elapsed_seconds);
  if (
    data.status !== "completed" ||
    !completedAt ||
    !Number.isFinite(Date.parse(completedAt)) ||
    elapsedSeconds === undefined ||
    elapsedSeconds < 0
  ) {
    throw new BackendApiError(
      "Unexpected response fields from sync API.",
      "Backend returned an invalid synchronization result.",
    );
  }
  return {
    status: "completed",
    completed_at: completedAt,
    elapsed_seconds: elapsedSeconds,
  };
}

function fetchDataset<T>(
  path: string,
  queryParams: Record<string, string | number>,
  normalizeRow: RowNormalizer<T>,
  rowBudget: BackendRowBudget,
) {
  return fetchAllPages(path, queryParams, normalizeRow, rowBudget);
}

export function getTradeExecutions(params: ScopedDateRangeParams) {
  return fetchDataset(
    "/api/trading/trades/executions/",
    { ...scopeParams(params), order: "desc" },
    normalizeTradeExecution,
    params.rowBudget,
  );
}

export function getAccountEquityHistory(params: DateRangeParams) {
  return fetchDataset(
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
  return fetchDataset(
    "/api/trading/strategies/daily-pnl/",
    { ...scopeParams(params), order: "asc" },
    normalizeStrategyDailyPnl,
    params.rowBudget,
  );
}

export function getStrategyPositions(params: PositionParams) {
  return fetchDataset(
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
