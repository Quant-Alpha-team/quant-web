import type {
  AccountEquity,
  DatePreset,
  DashboardData,
  KpiCards,
  SectionId,
  StrategyDailyPnl,
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
  { id: "account-equity", label: "Account Equity" },
  { id: "trade-logs", label: "Trade Logs" },
  { id: "diagnostics", label: "Diagnostics" },
];

export const CHART_COLORS = {
  profit: "#34d399",
  loss: "#fb7185",
  accent: "#22d3ee",
  cyan: "#38bdf8",
  amber: "#fbbf24",
  violet: "#c084fc",
  rose: "#fb7185",
};

const STRATEGY_COLORS = [
  CHART_COLORS.accent,
  CHART_COLORS.profit,
  CHART_COLORS.amber,
  CHART_COLORS.violet,
  CHART_COLORS.rose,
  "#5eead4",
  "#818cf8",
];

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

export function addDays(dateValue: string, days: number) {
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
    startDate = addDays(today, -7);
  } else if (preset === "Last 14 Days") {
    startDate = addDays(today, -14);
  } else if (preset === "Last 30 Days") {
    startDate = addDays(today, -30);
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

function sortEquityOldestFirst(rows: AccountEquity[]) {
  return [...rows].sort(
    (a, b) =>
      timeValue(a.timestamp ?? a.date) - timeValue(b.timestamp ?? b.date),
  );
}

/**
 * Build one portfolio-level equity series when the API returns multiple
 * accounts. Each point carries forward the latest known value for every
 * account, so snapshots recorded at slightly different times do not get
 * connected as if they belonged to one account.
 */
export function aggregateEquityHistory(rows: AccountEquity[]) {
  const sorted = sortEquityOldestFirst(rows);
  const accounts = new Set(sorted.map(equityAccountKey));

  if (accounts.size <= 1) {
    return sorted;
  }

  const latestByAccount = new Map<string, number>();
  const combined: AccountEquity[] = [];
  let index = 0;

  while (index < sorted.length) {
    const pointTime = timeValue(sorted[index].timestamp ?? sorted[index].date);
    let point = sorted[index];

    do {
      point = sorted[index];
      latestByAccount.set(
        equityAccountKey(point),
        toNumber(point.equity_value),
      );
      index += 1;
    } while (
      index < sorted.length &&
      timeValue(sorted[index].timestamp ?? sorted[index].date) === pointTime
    );

    combined.push({
      date: point.date,
      timestamp: point.timestamp,
      broker_account_id: "ALL",
      equity_value: [...latestByAccount.values()].reduce(
        (total, value) => total + value,
        0,
      ),
    });
  }

  return combined;
}

function currentAndPreviousEquity(rows: AccountEquity[]) {
  const byAccount = new Map<string, AccountEquity[]>();

  for (const row of rows) {
    const account = equityAccountKey(row);
    const accountRows = byAccount.get(account) ?? [];
    accountRows.push(row);
    byAccount.set(account, accountRows);
  }

  let current = 0;
  let previous = 0;

  for (const accountRows of byAccount.values()) {
    const sorted = sortEquityOldestFirst(accountRows);
    const latestValue = toNumber(sorted.at(-1)?.equity_value);
    const previousValue =
      sorted.length > 1
        ? toNumber(sorted.at(-2)?.equity_value)
        : latestValue;
    current += latestValue;
    previous += previousValue;
  }

  return { current, previous };
}

export function computeKpis(
  perfRows: AccountEquity[],
  execRows: TradeExecution[],
  pnlRows: StrategyDailyPnl[],
): KpiCards {
  const kpi: KpiCards = {
    currentEquity: 0,
    equityChange: 0,
    totalPnl: 0,
    openTrades: 0,
    totalCommission: 0,
  };

  if (perfRows.length > 0) {
    const equity = currentAndPreviousEquity(perfRows);
    kpi.currentEquity = equity.current;
    kpi.equityChange = equity.current - equity.previous;
  }

  kpi.totalPnl = pnlRows.reduce(
    (total, row) => total + toNumber(row.daily_pnl),
    0,
  );
  kpi.openTrades = execRows.filter((row) => row.status === "OPEN").length;
  kpi.totalCommission = execRows.reduce(
    (total, row) => total + toNumber(row.commission),
    0,
  );
  return kpi;
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatCurrencyDelta(value: number) {
  const prefix = value < 0 ? "-" : "";
  return `${prefix}${formatCurrency(Math.abs(value))}`;
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

export function sortByNewest<T extends { timestamp?: string; date?: string }>(
  rows: T[],
) {
  return [...rows].sort(
    (a, b) =>
      timeValue(b.timestamp ?? b.date) - timeValue(a.timestamp ?? a.date),
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
    .sort((a, b) => b.pnl - a.pnl);
}

export function strategyColor(strategy: string, index: number) {
  let hash = 0;
  for (const char of strategy) {
    hash = (hash + char.charCodeAt(0)) % STRATEGY_COLORS.length;
  }
  return STRATEGY_COLORS[(hash + index) % STRATEGY_COLORS.length];
}

export function recordCounts(data: DashboardData) {
  return {
    executions: data.execRows.length,
    equity: data.perfRows.length,
    pnl: data.pnlRows.length,
  };
}
