import type {
  AccountEquity,
  DatePreset,
  KpiCards,
  SectionId,
  StrategyDailyPnl,
  StrategyPosition,
  TradeExecution,
} from "@/lib/types";

export const DEFAULT_TIMEZONES = ["America/New_York", "Asia/Taipei"];

export const DATE_PRESETS: DatePreset[] = [
  "Today",
  "Last 7 Days",
  "Last 14 Days",
  "Last 30 Days",
  "Month to Date",
  "Last 10 Years",
  "Custom Date",
];

export const SECTIONS: { id: SectionId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "strategy-pnl", label: "Strategy P&L" },
  { id: "positions", label: "Positions" },
  { id: "account-equity", label: "Account Equity" },
  { id: "trade-logs", label: "Trade Logs" },
  { id: "diagnostics", label: "Diagnostics" },
];

export const CHART_COLORS = {
  profit: "#34d399",
  loss: "#fb7185",
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function todayInTimeZone(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function addDays(dateValue: string, days: number) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(
    date.getUTCDate(),
  )}`;
}

export function resolveDateRange(
  preset: DatePreset,
  timeZone: string,
  customStart: string,
  customEnd: string,
) {
  const today = todayInTimeZone(timeZone);
  let startDate = today;
  let endDate = today;

  if (preset === "Last 7 Days") {
    startDate = addDays(today, -6);
  } else if (preset === "Last 14 Days") {
    startDate = addDays(today, -13);
  } else if (preset === "Last 30 Days") {
    startDate = addDays(today, -29);
  } else if (preset === "Month to Date") {
    startDate = `${today.slice(0, 8)}01`;
  } else if (preset === "Last 10 Years") {
    startDate = addDays(today, -3650);
  } else if (preset === "Custom Date") {
    startDate = customStart || today;
    endDate = customEnd || today;
  }

  if (startDate > endDate) {
    return { startDate: endDate, endDate: startDate };
  }
  return { startDate, endDate };
}

export function includesForSection(section: SectionId) {
  return {
    includeExec: ["overview", "trade-logs", "diagnostics"].includes(section),
    includePerf: ["overview", "account-equity", "diagnostics"].includes(section),
    includePnl: ["overview", "strategy-pnl", "diagnostics"].includes(section),
    includePositions: ["overview", "positions", "diagnostics"].includes(section),
  };
}

export function toNumber(value: unknown) {
  return toOptionalNumber(value) ?? 0;
}

export function toOptionalNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

type StrategyIdentityRow = {
  strategy_name?: string;
  strategy_family?: string;
  strategy_version?: string | null;
};

export function strategyIdentity(row: StrategyIdentityRow) {
  const strategyName = row.strategy_name?.trim() || "Unknown";
  const legacyMatch = strategyName.match(/^(.*)_(V\d+)$/i);
  const family =
    row.strategy_family?.trim() || legacyMatch?.[1] || strategyName;
  let version: string | null = null;
  if (typeof row.strategy_version === "string" && row.strategy_version.trim()) {
    version = row.strategy_version.trim();
  } else if (row.strategy_version == null && !row.strategy_family) {
    version = legacyMatch?.[2]?.toUpperCase() ?? null;
  }
  return { family, version, strategyName };
}

export function strategyFamily(row: StrategyIdentityRow) {
  return strategyIdentity(row).family;
}

export function strategyVersionLabel(row: StrategyIdentityRow) {
  return strategyIdentity(row).version ?? "N/A";
}

function timeValue(value: string | undefined) {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function equityAccountKey(row: AccountEquity) {
  return row.broker_account_id?.trim() || "__unknown_account__";
}

function equityDateKey(row: AccountEquity) {
  return row.date?.trim() || row.timestamp?.slice(0, 10) || "";
}

function newestValue(values: Array<string | undefined>) {
  let newest: string | undefined;
  for (const value of values) {
    if (value && (!newest || timeValue(value) > timeValue(newest))) {
      newest = value;
    }
  }
  return newest;
}

/**
 * Return one closing NAV point per account and trading date. If multiple
 * accounts are selected, carry each account's last known close forward and do
 * not emit a portfolio total until every account has appeared at least once.
 */
export function aggregateEquityHistory(rows: AccountEquity[]) {
  const latestByAccountDate = new Map<string, AccountEquity>();

  for (const row of rows) {
    if (toOptionalNumber(row.equity_value) === null) {
      continue;
    }
    const date = equityDateKey(row);
    if (!date) {
      continue;
    }
    const key = `${equityAccountKey(row)}|${date}`;
    const current = latestByAccountDate.get(key);
    if (
      !current ||
      timeValue(row.timestamp ?? row.date) >=
        timeValue(current.timestamp ?? current.date)
    ) {
      latestByAccountDate.set(key, row);
    }
  }

  const dailyRows = [...latestByAccountDate.values()];
  const accounts = new Set(dailyRows.map(equityAccountKey));
  const rowsByDate = new Map<string, AccountEquity[]>();
  for (const row of dailyRows) {
    const date = equityDateKey(row);
    const dateRows = rowsByDate.get(date) ?? [];
    dateRows.push(row);
    rowsByDate.set(date, dateRows);
  }

  const latestByAccount = new Map<string, AccountEquity>();
  const combined: AccountEquity[] = [];

  for (const date of [...rowsByDate.keys()].sort()) {
    for (const row of rowsByDate.get(date) ?? []) {
      latestByAccount.set(equityAccountKey(row), row);
    }
    if (latestByAccount.size !== accounts.size) {
      continue;
    }

    const currentRows = [...latestByAccount.values()];
    combined.push({
      date,
      timestamp: newestValue(currentRows.map((row) => row.timestamp ?? row.date)),
      broker_account_id:
        accounts.size === 1
          ? currentRows[0]?.broker_account_id
          : "ALL",
      equity_value: currentRows.reduce(
        (total, row) => total + (toOptionalNumber(row.equity_value) ?? 0),
        0,
      ),
    });
  }

  return combined;
}

export function computeKpis(
  perfRows: AccountEquity[],
  execRows: TradeExecution[],
  pnlRows: StrategyDailyPnl[],
  positionRows: StrategyPosition[],
): KpiCards {
  const kpi: KpiCards = {
    accountNav: null,
    navChange: null,
    navChangePercent: null,
    openPnl: null,
    periodRealizedPnl: null,
    periodRealizedRecords: 0,
    totalTrades: execRows.length,
    openPositions: positionRows.length,
    openStrategies: new Set(
      positionRows.map(
        (row) =>
          `${strategyFamily(row)}|${row.broker_account_id ?? "unknown"}`,
      ),
    ).size,
    pricedPositions: 0,
  };

  const latestEquityByAccount = new Map<string, AccountEquity>();
  for (const row of perfRows) {
    if (toOptionalNumber(row.equity_value) === null) {
      continue;
    }
    const account = equityAccountKey(row);
    const current = latestEquityByAccount.get(account);
    if (
      !current ||
      timeValue(row.timestamp ?? row.date) >=
        timeValue(current.timestamp ?? current.date)
    ) {
      latestEquityByAccount.set(account, row);
    }
  }
  const latestEquityRows = [...latestEquityByAccount.values()];
  if (latestEquityRows.length > 0) {
    kpi.accountNav = latestEquityRows.reduce(
      (total, row) => total + toNumber(row.equity_value),
      0,
    );
  }

  const equitySeries = aggregateEquityHistory(perfRows);
  if (equitySeries.length > 1) {
    const firstNav = toNumber(equitySeries[0].equity_value);
    const lastNav = toNumber(equitySeries.at(-1)?.equity_value);
    kpi.navChange = lastNav - firstNav;
    kpi.navChangePercent =
      firstNav !== 0 ? ((lastNav - firstNav) / firstNav) * 100 : null;
  }

  const recordedRealizedRows = pnlRows.filter(
    (row) => toOptionalNumber(row.realized_pnl) !== null,
  );
  kpi.periodRealizedRecords = new Set(
    recordedRealizedRows.map(
      (row) =>
        `${strategyFamily(row)}|${row.broker_account_id ?? "unknown"}|${row.date ?? "unknown"}`,
    ),
  ).size;
  if (recordedRealizedRows.length > 0) {
    kpi.periodRealizedPnl = recordedRealizedRows.reduce(
      (total, row) => total + toNumber(row.realized_pnl),
      0,
    );
  }

  const pricedPositions = positionRows.filter(
    (row) =>
      toOptionalNumber(row.market_value) !== null &&
      toOptionalNumber(row.unrealized_pnl) !== null,
  );
  kpi.pricedPositions = pricedPositions.length;
  if (positionRows.length === 0) {
    kpi.openPnl = 0;
  } else if (pricedPositions.length === positionRows.length) {
    kpi.openPnl = pricedPositions.reduce(
      (total, row) => total + toNumber(row.unrealized_pnl),
      0,
    );
  }

  return kpi;
}

export function formatCurrency(value: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatNumber(value: unknown, digits = 2) {
  const numeric = toOptionalNumber(value);
  if (numeric === null) {
    return "—";
  }
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(numeric);
}

export function formatDate(value: string | undefined) {
  if (!value) {
    return "-";
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed);
}

export function formatTimestamp(value: string | undefined, timeZone: string) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(parsed);
  const valueByPart = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${valueByPart.year}-${valueByPart.month}-${valueByPart.day} ${valueByPart.hour}:${valueByPart.minute}:${valueByPart.second}`;
}

export function downsample<T>(rows: T[], maxPoints: number) {
  if (maxPoints <= 0 || rows.length <= maxPoints) {
    return rows;
  }
  if (maxPoints === 1) {
    return rows.slice(-1);
  }

  const lastIndex = rows.length - 1;
  const positions = new Set<number>();
  for (let index = 0; index < maxPoints; index += 1) {
    positions.add(Math.floor((index * lastIndex) / (maxPoints - 1)));
  }
  return [...positions].sort((a, b) => a - b).map((index) => rows[index]);
}

export function sortByNewest<
  T extends { timestamp?: string; snapshot_at?: string; date?: string },
>(rows: T[]) {
  return [...rows].sort(
    (a, b) =>
      timeValue(b.timestamp ?? b.snapshot_at ?? b.date) -
      timeValue(a.timestamp ?? a.snapshot_at ?? a.date),
  );
}

export function pnlSummary(rows: StrategyDailyPnl[]) {
  const byFamilyDay = new Map<
    string,
    {
      family: string;
      pnl: number;
      hasPnl: boolean;
      complete: boolean;
    }
  >();

  for (const row of rows) {
    const family = strategyFamily(row);
    const key = JSON.stringify([
      family,
      row.broker_account_id ?? "Unknown",
      row.date ?? "Unknown",
    ]);
    const entry = byFamilyDay.get(key) ?? {
      family,
      pnl: 0,
      hasPnl: false,
      complete: true,
    };
    if (row.daily_pnl === null || row.daily_pnl === undefined) {
      entry.complete = false;
    } else {
      entry.pnl += toNumber(row.daily_pnl);
      entry.hasPnl = true;
    }
    byFamilyDay.set(key, entry);
  }

  const byFamily = new Map<
    string,
    { strategy: string; pnl: number; wins: number; losses: number }
  >();

  for (const familyDay of byFamilyDay.values()) {
    if (!familyDay.hasPnl) {
      continue;
    }
    const strategy = familyDay.family;
    const entry = byFamily.get(strategy) ?? {
      strategy,
      pnl: 0,
      wins: 0,
      losses: 0,
    };
    byFamily.set(strategy, entry);
    const pnl = familyDay.pnl;
    entry.pnl += pnl;
    if (!familyDay.complete) {
      continue;
    }
    if (pnl > 0) {
      entry.wins += 1;
    } else if (pnl < 0) {
      entry.losses += 1;
    }
  }

  return [...byFamily.values()]
    .map((entry) => {
      const total = entry.wins + entry.losses;
      return {
        ...entry,
        winRate: total > 0 ? (entry.wins / total) * 100 : 0,
      };
    })
    .filter(
      (entry) =>
        entry.wins + entry.losses > 0 || Math.abs(entry.pnl) >= 0.005,
    )
    .sort((a, b) => b.pnl - a.pnl);
}
