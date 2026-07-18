import type {
  AccountEquity,
  DatePreset,
  DashboardData,
  KpiCards,
  SectionId,
  StrategyDailyPnl,
  StrategyPosition,
  TradeExecution,
} from "@/lib/types";

export const DEFAULT_TIMEZONES = ["Asia/Taipei", "America/New_York", "UTC"];

export const DATE_PRESETS: DatePreset[] = [
  "Today",
  "Last 7 Days",
  "Last 14 Days",
  "Last 30 Days",
  "Month to Date",
  "All Time",
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
  } else if (preset === "All Time") {
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
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
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

function optionalNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
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
        (total, row) => total + toNumber(row.equity_value),
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
    periodPnl: null,
    totalCommission: execRows.reduce(
      (total, row) => total + toNumber(row.commission),
      0,
    ),
    periodPnlRecords: 0,
    periodPnlPendingRecords: 0,
    totalTrades: execRows.length,
    openPositions: positionRows.length,
    openStrategies: new Set(
      positionRows.map(
        (row) =>
          `${row.strategy_name ?? "unknown"}|${row.broker_account_id ?? "unknown"}`,
      ),
    ).size,
    pricedPositions: 0,
  };

  const latestEquityByAccount = new Map<string, AccountEquity>();
  for (const row of perfRows) {
    const account = equityAccountKey(row);
    const current = latestEquityByAccount.get(account);
    if (
      !current ||
      timeValue(row.timestamp ?? row.date) >
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

  const recordedPnlRows = pnlRows.filter(
    (row) => optionalNumber(row.daily_pnl) !== null,
  );
  kpi.periodPnlRecords = recordedPnlRows.length;
  kpi.periodPnlPendingRecords = pnlRows.length - recordedPnlRows.length;
  if (recordedPnlRows.length > 0) {
    kpi.periodPnl = recordedPnlRows.reduce(
      (total, row) => total + toNumber(row.daily_pnl),
      0,
    );
  }

  const pricedPositions = positionRows.filter(
    (row) =>
      optionalNumber(row.market_value) !== null &&
      optionalNumber(row.unrealized_pnl) !== null,
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

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatNumber(value: unknown, digits = 2) {
  const numeric = toNumber(value);
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
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(parsed);
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
  const byStrategy = new Map<
    string,
    { strategy: string; pnl: number; wins: number; losses: number }
  >();

  for (const row of rows) {
    const strategy = row.strategy_name || "Unknown";
    const entry =
      byStrategy.get(strategy) ??
      byStrategy
        .set(strategy, { strategy, pnl: 0, wins: 0, losses: 0 })
        .get(strategy);
    if (!entry) {
      continue;
    }
    const pnl = toNumber(row.daily_pnl);
    entry.pnl += pnl;
    if (pnl > 0) {
      entry.wins += 1;
    } else if (pnl < 0) {
      entry.losses += 1;
    }
  }

  return [...byStrategy.values()]
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

export function recordCounts(data: DashboardData) {
  return {
    executions: data.execRows.length,
    equity: data.perfRows.length,
    pnl: data.pnlRows.length,
    positions: data.positionRows.length,
  };
}
