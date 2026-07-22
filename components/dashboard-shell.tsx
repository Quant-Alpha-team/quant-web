"use client";

import { useEffect, useId, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Download,
  FoldVertical,
  RadioTower,
  RefreshCw,
  ShieldCheck,
  UnfoldVertical,
} from "lucide-react";
import { EquityChart, PnlBarChart } from "@/components/dashboard-charts";
import { DataTable, type TableColumn } from "@/components/data-table";
import { MetricCard } from "@/components/metric-card";
import { SectionControl } from "@/components/section-control";
import { SignalIcon } from "@/components/signal-icon";
import { SidebarFilters } from "@/components/sidebar-filters";
import { StatusMessage } from "@/components/status-message";
import {
  CHART_COLORS,
  aggregateEquityHistory,
  computeKpis,
  formatCurrency,
  formatDate,
  formatNumber,
  formatTimestamp,
  includesForSection,
  pnlSummary,
  recordCounts,
  resolveDateRange,
  sortByNewest,
  toNumber,
  todayInTimeZone,
} from "@/lib/dashboard";
import type {
  AccountEquity,
  DashboardData,
  DatePreset,
  FilterOptions,
  SectionId,
  StrategyDailyPnl,
  StrategyPosition,
  TradeExecution,
} from "@/lib/types";

type ApiResponse<T> = {
  ok: boolean;
  data: T;
  error?: {
    message?: string;
  };
};

const emptyFilters: FilterOptions = { strategies: [], accounts: [] };
const emptyData: DashboardData = { execRows: [], perfRows: [], pnlRows: [], positionRows: [] };
const surfaceClass =
  "rounded-md bg-[radial-gradient(circle_at_100%_0%,rgba(94,234,212,0.1),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.095),rgba(255,255,255,0.055))] p-4 shadow-[0_18px_42px_var(--shadow)] backdrop-blur-xl";
const statusPillClass =
  "flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 font-mono text-[10px] uppercase tracking-normal text-[var(--muted-strong)]";
const metaPillClass =
  "rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 font-mono text-[10px] uppercase tracking-normal text-[var(--muted)]";
const primaryButtonClass =
  "inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md bg-[linear-gradient(135deg,#5eead4,#38bdf8)] px-4 text-sm font-semibold text-[#061322] shadow-[0_14px_30px_rgba(45,212,191,0.2)] transition hover:-translate-y-px hover:brightness-105 disabled:cursor-not-allowed disabled:bg-white/[0.08] disabled:text-[var(--muted)] disabled:shadow-none disabled:hover:translate-y-0 disabled:hover:brightness-100";
const secondaryButtonClass =
  "inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md bg-[linear-gradient(180deg,rgba(255,255,255,0.14),rgba(255,255,255,0.09))] px-3 text-sm font-semibold text-[var(--foreground)] shadow-[0_10px_20px_rgba(0,5,18,0.18)] transition hover:-translate-y-px hover:bg-white/[0.18] disabled:cursor-not-allowed disabled:bg-white/[0.05] disabled:text-[var(--muted)] disabled:shadow-none disabled:hover:translate-y-0";

async function readApi<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as ApiResponse<T>;
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error?.message || `Request failed: ${response.status}`);
  }
  return payload.data;
}

function csvCell(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value).replace(/\r?\n/g, " ");
  return /[",]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(fileName: string, headers: string[], rows: unknown[][]) {
  const csv = [headers.map(csvCell).join(","), ...rows.map((row) => row.map(csvCell).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);

  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function Panel({
  title,
  helpText,
  children,
}: {
  title: string;
  helpText?: string;
  children: React.ReactNode;
}) {
  const helpId = useId();

  return (
    <section className="space-y-4">
      <div className="relative flex items-center gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-[var(--foreground)]">
          <span className="status-dot" aria-hidden="true" />
          {title}
        </h2>
        {helpText ? (
          <div className="group">
            <button
              type="button"
              aria-label={`About ${title}`}
              aria-describedby={helpId}
              className="grid h-7 w-7 cursor-help place-items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70"
            >
              <SignalIcon
                icon={AlertTriangle}
                tone="amber"
                className="h-6 w-6 shadow-none"
                iconClassName="h-3.5 w-3.5"
              />
            </button>
            <div
              id={helpId}
              role="tooltip"
              className="pointer-events-none invisible absolute left-0 top-full z-50 mt-2 w-[min(42rem,calc(100vw-2rem))] max-w-full translate-y-1 rounded-md border border-amber-200/15 bg-[#091a2e]/95 px-4 py-3 text-sm font-normal leading-6 text-[var(--muted-strong)] opacity-0 shadow-[0_18px_42px_rgba(0,5,18,0.38)] backdrop-blur-xl transition duration-150 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100"
            >
              {helpText}
            </div>
          </div>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function EmptyPanel({ children }: { children: React.ReactNode }) {
  return <StatusMessage tone="info">{children}</StatusMessage>;
}

type MetricTone = "neutral" | "profit" | "loss";

function metricTone(value: number | null): MetricTone {
  if (value === null || value === 0) {
    return "neutral";
  }
  return value > 0 ? "profit" : "loss";
}

function formatSignedCurrency(value: number) {
  return `${value > 0 ? "+" : ""}${formatCurrency(value)}`;
}

function formatSignedPercent(value: number) {
  return `${value > 0 ? "+" : ""}${formatNumber(value, 2)}%`;
}

function OverviewPanel({
  strategy,
  accountId,
  data,
}: {
  strategy: string;
  accountId: string;
  data: DashboardData;
}) {
  const kpi = computeKpis(
    data.perfRows,
    data.execRows,
    data.pnlRows,
    data.positionRows,
  );
  const realizedValue = kpi.periodRealizedPnl;
  const realizedDetail =
    realizedValue !== null
      ? `${kpi.periodRealizedRecords} daily realized record${kpi.periodRealizedRecords === 1 ? "" : "s"}`
      : "No realized P&L records";
  const navDetail =
    kpi.navChange === null || kpi.navChangePercent === null
      ? "One NAV close in selected range"
      : `${formatSignedCurrency(kpi.navChange)} (${formatSignedPercent(kpi.navChangePercent)})`;

  return (
    <Panel title={`Portfolio Overview: ${strategy} (${accountId})`}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="lg:col-span-2">
          <MetricCard
            label="Current Equity"
            value={kpi.accountNav === null ? "Unavailable" : formatCurrency(kpi.accountNav)}
            delta={navDetail}
            tone="neutral"
            deltaTone={metricTone(kpi.navChange)}
            iconTone="cyan"
          />
        </div>
        <div className="lg:col-span-2">
          <MetricCard
            label="Total Realized P&L"
            value={formatCurrency(realizedValue ?? 0)}
            delta={realizedDetail}
            tone={metricTone(realizedValue)}
            deltaTone={metricTone(realizedValue)}
          />
        </div>
        <div className="lg:col-span-2">
          <MetricCard
            label="Total Unrealized P&L"
            value={
              kpi.openPnl === null
                ? "Pricing incomplete"
                : formatCurrency(kpi.openPnl)
            }
            delta={
              kpi.openPositions === 0
                ? "No open positions"
                : `${kpi.pricedPositions}/${kpi.openPositions} positions valued`
            }
            tone={metricTone(kpi.openPnl)}
          />
        </div>
        <div className="lg:col-span-2">
          <MetricCard
            label="Total Trades"
            value={String(kpi.totalTrades)}
            tone="neutral"
          />
        </div>
        <div className="lg:col-span-2">
          <MetricCard
            label="Open Positions"
            value={String(kpi.openPositions)}
            delta={`${kpi.openStrategies} ${kpi.openStrategies === 1 ? "strategy" : "strategies"}`}
            tone="neutral"
          />
        </div>
        <div className="lg:col-span-2">
          <MetricCard
            label="Total Commission"
            value={formatCurrency(kpi.totalCommission)}
            tone="neutral"
          />
        </div>
      </div>

      {data.perfRows.length === 0 ? (
        <EmptyPanel>
          No account NAV history is available in the selected range.
        </EmptyPanel>
      ) : (
        <div className={surfaceClass}>
          <div className="mb-2 text-sm font-semibold text-[var(--foreground)]">
            Equity history
          </div>
          <EquityChart rows={data.perfRows} />
        </div>
      )}
    </Panel>
  );
}

function isMarkToMarketRow(row: StrategyDailyPnl) {
  return row.calculation_source === "MARK_TO_MARKET";
}

function pnlTableValue(value: number | string | null | undefined, available = true) {
  if (!available || value === null || value === undefined) {
    return <span className="text-[var(--muted)]">—</span>;
  }

  const numeric = toNumber(value);
  const tone =
    numeric > 0
      ? "text-[#34d399]"
      : numeric < 0
        ? "text-[#fb7185]"
        : "text-[var(--foreground)]";
  return <span className={tone}>{formatCurrency(numeric)}</span>;
}

function commissionTableValue(
  value: number | string | null | undefined,
  available = true,
) {
  if (!available || value === null || value === undefined) {
    return <span className="text-[var(--muted)]">—</span>;
  }

  const numeric = Math.abs(toNumber(value));
  return (
    <span
      className={
        numeric === 0 ? "text-[var(--muted-strong)]" : "text-amber-300"
      }
    >
      {numeric === 0 ? formatCurrency(0) : `-${formatCurrency(numeric)}`}
    </span>
  );
}

function pnlDataBasis(row: StrategyDailyPnl) {
  if (!isMarkToMarketRow(row)) {
    return "Daily realized archive";
  }
  if (row.valuation_status === "PARTIAL") {
    return "Partial pricing";
  }
  if (row.valuation_status === "UNPRICED") {
    return "Unpriced";
  }
  if (row.daily_pnl === null || row.daily_pnl === undefined) {
    return "Baseline unavailable";
  }
  return "Mark to market";
}

const strategyPnlHelp =
  "Daily P&L is net of commission and includes the daily open-position mark change when pricing is available. Realized P&L is the day's realized result after commission; opening-only fees do not create realized P&L. Unrealized P&L is shown separately. Empty zero-only archive rows are omitted.";

function StrategyPnlPanel({ rows }: { rows: StrategyDailyPnl[] }) {
  const informativeRows = rows.filter(
    (row) =>
      isMarkToMarketRow(row) ||
      (row.daily_pnl !== null &&
        row.daily_pnl !== undefined &&
        Math.abs(toNumber(row.daily_pnl)) >= 0.005),
  );

  if (informativeRows.length === 0) {
    return (
      <Panel title="Strategy P&L Performance" helpText={strategyPnlHelp}>
        <EmptyPanel>
          No non-zero daily strategy performance was recorded in the selected range.
        </EmptyPanel>
      </Panel>
    );
  }

  const summary = pnlSummary(informativeRows);
  const orderedRows = sortByNewest(informativeRows);
  const summaryColumns: TableColumn<(typeof summary)[number]>[] = [
    {
      key: "strategy",
      label: "Strategy",
      width: "24%",
      sortValue: (row) => row.strategy,
      render: (row) => row.strategy,
    },
    {
      key: "pnl",
      label: "P&L",
      align: "right",
      width: "20%",
      sortValue: (row) => row.pnl,
      render: (row) => formatCurrency(row.pnl),
    },
    {
      key: "wins",
      label: "Wins",
      align: "right",
      width: "18%",
      sortValue: (row) => row.wins,
      render: (row) => row.wins,
    },
    {
      key: "losses",
      label: "Losses",
      align: "right",
      width: "18%",
      sortValue: (row) => row.losses,
      render: (row) => row.losses,
    },
    {
      key: "winRate",
      label: "Win Rate",
      align: "right",
      width: "20%",
      sortValue: (row) => row.winRate,
      render: (row) => `${row.winRate.toFixed(1)}%`,
    },
  ];

  const rawColumns: TableColumn<StrategyDailyPnl>[] = [
    {
      key: "date",
      label: "Date",
      width: "140px",
      sticky: "left",
      sortValue: (row) => row.date,
      render: (row) => formatDate(row.date),
    },
    {
      key: "strategy",
      label: "Strategy",
      width: "250px",
      sticky: "left",
      stickyOffset: "140px",
      stickyEdge: true,
      render: (row) => row.strategy_name ?? "—",
    },
    {
      key: "account",
      label: "Account",
      render: (row) => row.broker_account_id ?? "—",
    },
    {
      key: "dailyPnl",
      label: "Daily P&L",
      align: "right",
      render: (row) => pnlTableValue(row.daily_pnl),
    },
    {
      key: "realizedPnl",
      label: "Realized P&L",
      align: "right",
      render: (row) => pnlTableValue(row.realized_pnl),
    },
    {
      key: "unrealizedPnl",
      label: "Unrealized P&L",
      align: "right",
      render: (row) => pnlTableValue(row.unrealized_pnl, isMarkToMarketRow(row)),
    },
    {
      key: "commission",
      label: "Commission",
      align: "right",
      render: (row) => commissionTableValue(row.commission),
    },
    { key: "basis", label: "Data Basis", render: pnlDataBasis },
  ];

  return (
    <Panel title="Strategy P&L Performance" helpText={strategyPnlHelp}>
      <div className="grid gap-4">
        <DataTable rows={summary} columns={summaryColumns} />
        <div className={surfaceClass}>
          <PnlBarChart rows={informativeRows} />
        </div>
      </div>
      <div className="space-y-3">
        <div className="flex flex-col gap-3 rounded-md bg-white/[0.05] px-3 py-3 shadow-[0_12px_30px_rgba(0,5,18,0.16)] backdrop-blur xl:flex-row xl:items-center xl:justify-between">
          <div className="font-mono text-[11px] uppercase tracking-normal text-[var(--muted-strong)]">
            {orderedRows.length} informative records
          </div>
          <button
            type="button"
            onClick={() =>
              downloadCsv(
                "performance-logs.csv",
                rawColumns.map((column) => column.label),
                orderedRows.map((row) => {
                  const marked = isMarkToMarketRow(row);
                  return [
                    formatDate(row.date),
                    row.strategy_name ?? "",
                    row.broker_account_id ?? "",
                    row.daily_pnl ?? "",
                    row.realized_pnl ?? "",
                    marked ? (row.unrealized_pnl ?? "") : "",
                    row.commission ?? "",
                    pnlDataBasis(row),
                  ];
                }),
              )
            }
            className={secondaryButtonClass}
          >
            <Download className="h-4 w-4" />
            Download CSV
          </button>
        </div>
        <DataTable
          key={`pnl-${informativeRows.length}-${orderedRows[0]?.date ?? "empty"}`}
          rows={orderedRows}
          columns={rawColumns}
          minWidth="1600px"
          pagination={{ enabled: true, pageSize: 20 }}
        />
      </div>
    </Panel>
  );
}


function optionalPositionNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function positionInstrumentLabel(row: StrategyPosition) {
  if (row.local_symbol) {
    return row.local_symbol;
  }
  const option = row.sec_type === "OPT" || row.sec_type === "FOP";
  if (!option) {
    return row.symbol ?? "-";
  }
  return [row.symbol, row.expiry_date, row.right, row.strike].filter(Boolean).join(" ");
}

function positionDescription(row: StrategyPosition) {
  const option = row.sec_type === "OPT" || row.sec_type === "FOP";
  if (option) {
    const optionRight = row.right === "C" ? "Call" : row.right === "P" ? "Put" : row.right;
    return [row.symbol, row.expiry_date, optionRight, row.strike]
      .filter(Boolean)
      .join(" · ");
  }
  if (row.sec_type === "STK") {
    return (row.symbol ?? "Unknown") + " Equity";
  }
  return [row.symbol, row.sec_type].filter(Boolean).join(" · ");
}

function positionAssetGroup(secType: string | undefined) {
  if (secType === "STK") {
    return { key: "1-equities", label: "Equities" };
  }
  if (secType === "OPT" || secType === "FOP") {
    return { key: "2-options", label: "Options" };
  }
  if (secType === "FUT") {
    return { key: "3-futures", label: "Futures" };
  }
  if (secType === "CASH") {
    return { key: "4-cash", label: "Cash & FX" };
  }
  return { key: "9-other", label: "Other" };
}

function positionValueClass(value: unknown) {
  const numeric = optionalPositionNumber(value);
  if (numeric === null || numeric === 0) {
    return "text-[var(--muted-strong)]";
  }
  return numeric > 0 ? "text-[var(--profit)]" : "text-[var(--loss)]";
}

function formatPositionCurrency(value: unknown) {
  const numeric = optionalPositionNumber(value);
  return numeric === null ? "—" : formatCurrency(numeric);
}

function formatPositionPercent(value: unknown) {
  const numeric = optionalPositionNumber(value);
  return numeric === null ? "—" : formatNumber(numeric, 2) + "%";
}

type PositionSortKey =
  | "quantity"
  | "mark_price"
  | "market_value"
  | "cost_basis"
  | "day_change"
  | "unrealized_pnl"
  | "gain_loss_percent"
  | "expiry_date";

type PositionSortState = {
  key: PositionSortKey;
  direction: "asc" | "desc";
};

const positionTableColumns: Array<{
  label: string;
  align: "left" | "right";
  sortKey?: PositionSortKey;
}> = [
  { label: "Symbol", align: "left" },
  { label: "Description", align: "left" },
  { label: "Qty", align: "right", sortKey: "quantity" },
  { label: "Price", align: "right", sortKey: "mark_price" },
  { label: "Mkt Val", align: "right", sortKey: "market_value" },
  { label: "Cost Basis", align: "right", sortKey: "cost_basis" },
  { label: "P/L Day", align: "right", sortKey: "day_change" },
  { label: "P/L", align: "right", sortKey: "unrealized_pnl" },
  { label: "P/L %", align: "right", sortKey: "gain_loss_percent" },
  { label: "Exp/Mat", align: "left", sortKey: "expiry_date" },
];

function sortPositionRows(rows: StrategyPosition[], sort: PositionSortState | null) {
  if (!sort) {
    return rows;
  }

  return [...rows].sort((left, right) => {
    const leftValue = left[sort.key];
    const rightValue = right[sort.key];
    const leftMissing =
      leftValue === null || leftValue === undefined || leftValue === "";
    const rightMissing =
      rightValue === null || rightValue === undefined || rightValue === "";

    if (leftMissing !== rightMissing) {
      return leftMissing ? 1 : -1;
    }

    let comparison = 0;
    if (!leftMissing && !rightMissing) {
      if (sort.key === "expiry_date") {
        comparison = String(leftValue).localeCompare(String(rightValue));
      } else {
        comparison =
          (optionalPositionNumber(leftValue) ?? 0) -
          (optionalPositionNumber(rightValue) ?? 0);
      }
    }

    if (comparison === 0) {
      comparison = positionInstrumentLabel(left).localeCompare(
        positionInstrumentLabel(right),
      );
    }
    return sort.direction === "asc" ? comparison : -comparison;
  });
}

function sumPositionValues(
  rows: StrategyPosition[],
  readValue: (row: StrategyPosition) => unknown,
) {
  let total = 0;
  let complete = true;
  for (const row of rows) {
    const value = optionalPositionNumber(readValue(row));
    if (value === null) {
      complete = false;
    } else {
      total += value;
    }
  }
  return { total, complete };
}

function StrategyPositionsPanel({
  rows,
  timezone,
}: {
  rows: StrategyPosition[];
  timezone: string;
}) {
  const orderedRows = [...rows].sort((left, right) => {
    const strategyOrder = (left.strategy_name ?? "").localeCompare(right.strategy_name ?? "");
    if (strategyOrder !== 0) {
      return strategyOrder;
    }
    const leftGroup = positionAssetGroup(left.sec_type).key;
    const rightGroup = positionAssetGroup(right.sec_type).key;
    if (leftGroup !== rightGroup) {
      return leftGroup.localeCompare(rightGroup);
    }
    return Math.abs(optionalPositionNumber(right.market_value) ?? 0)
      - Math.abs(optionalPositionNumber(left.market_value) ?? 0);
  });

  const strategyMap = new Map<string, StrategyPosition[]>();
  for (const row of orderedRows) {
    const strategyName = row.strategy_name ?? "Unattributed";
    strategyMap.set(strategyName, [...(strategyMap.get(strategyName) ?? []), row]);
  }
  const strategyGroups = [...strategyMap.entries()];
  const latestSnapshot = sortByNewest(rows)[0]?.snapshot_at;
  const [collapsedStrategies, setCollapsedStrategies] = useState<Set<string>>(
    () => new Set(),
  );
  const [positionSortByStrategy, setPositionSortByStrategy] = useState<
    Record<string, PositionSortState | null>
  >({});
  const allStrategiesCollapsed =
    strategyGroups.length > 0 &&
    strategyGroups.every(([strategyName]) => collapsedStrategies.has(strategyName));

  function toggleStrategy(strategyName: string) {
    setCollapsedStrategies((current) => {
      const next = new Set(current);
      if (next.has(strategyName)) {
        next.delete(strategyName);
      } else {
        next.add(strategyName);
      }
      return next;
    });
  }

  function togglePositionSort(strategyName: string, key: PositionSortKey) {
    setPositionSortByStrategy((current) => {
      const currentSort = current[strategyName];
      const nextSort: PositionSortState | null =
        currentSort?.key !== key
          ? { key, direction: "asc" }
          : currentSort.direction === "asc"
            ? { key, direction: "desc" }
            : null;
      return {
        ...current,
        [strategyName]: nextSort,
      };
    });
  }

  const csvHeaders = [
    "Strategy",
    "Account",
    "Symbol",
    "Description",
    "Type",
    "Quantity",
    "Price",
    "Market Value",
    "Cost Basis",
    "P/L Day",
    "P/L",
    "P/L %",
    "Expiration",
    "As Of",
    "Position Source",
  ];

  return (
    <Panel
      title="Current Holdings by Strategy"
      helpText="Current contracts and aggregate quantities are verified against IBKR. Strategy attribution and cost basis come from strategy-tagged executions; missing broker prices remain blank."
    >

      {rows.length === 0 ? (
        <EmptyPanel>No current broker positions exist for this strategy/account.</EmptyPanel>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded-md border border-white/[0.08] bg-white/[0.05] px-4 py-3 shadow-[0_12px_30px_rgba(0,5,18,0.16)] md:flex-row md:items-center md:justify-between">
            <div>
              <div className="font-mono text-[11px] uppercase text-[var(--muted-strong)]">
                {rows.length} current positions across {strategyGroups.length} strategies
              </div>
              <div className="mt-1 text-xs text-[var(--muted)]">
                Broker snapshot {formatTimestamp(latestSnapshot, timezone)}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 md:flex-nowrap md:justify-end [&>button]:shrink-0 [&>button]:whitespace-nowrap">
              <button
                type="button"
                onClick={() =>
                  setCollapsedStrategies(
                    allStrategiesCollapsed
                      ? new Set()
                      : new Set(strategyGroups.map(([strategyName]) => strategyName)),
                  )
                }
                className={secondaryButtonClass}
              >
                {allStrategiesCollapsed ? (
                  <UnfoldVertical className="h-4 w-4" />
                ) : (
                  <FoldVertical className="h-4 w-4" />
                )}
                {allStrategiesCollapsed ? "Expand all" : "Collapse all"}
              </button>
              <button
                type="button"
                onClick={() =>
                  downloadCsv(
                    "current-holdings-by-strategy.csv",
                    csvHeaders,
                    orderedRows.map((row) => [
                      row.strategy_name ?? "Unattributed",
                      row.broker_account_id ?? "-",
                      positionInstrumentLabel(row),
                      positionDescription(row),
                      row.sec_type ?? "-",
                      optionalPositionNumber(row.quantity),
                      optionalPositionNumber(row.mark_price),
                      optionalPositionNumber(row.market_value),
                      optionalPositionNumber(row.cost_basis),
                      optionalPositionNumber(row.day_change),
                      optionalPositionNumber(row.unrealized_pnl),
                      optionalPositionNumber(row.gain_loss_percent),
                      row.expiry_date ?? "",
                      formatTimestamp(row.snapshot_at, timezone),
                      row.source ?? "LEDGER",
                    ]),
                  )
                }
                className={secondaryButtonClass}
              >
                <Download className="h-4 w-4" />
                Download CSV
              </button>
            </div>
          </div>

          {strategyGroups.map(([strategyName, strategyRows]) => {
            const marketValue = sumPositionValues(strategyRows, (row) => row.market_value);
            const dayChange = sumPositionValues(strategyRows, (row) => row.day_change);
            const costBasis = sumPositionValues(strategyRows, (row) => row.cost_basis);
            const gainLoss = sumPositionValues(strategyRows, (row) => row.unrealized_pnl);
            const accounts = [...new Set(strategyRows.map((row) => row.broker_account_id).filter(Boolean))];
            const reconciledCount = strategyRows.filter(
              (row) => row.source === "BROKER_RECONCILED",
            ).length;
            const isCollapsed = collapsedStrategies.has(strategyName);
            const positionSort = positionSortByStrategy[strategyName] ?? null;
            const assetMap = new Map<string, { label: string; rows: StrategyPosition[] }>();
            for (const row of strategyRows) {
              const asset = positionAssetGroup(row.sec_type);
              const current = assetMap.get(asset.key) ?? { label: asset.label, rows: [] };
              current.rows.push(row);
              assetMap.set(asset.key, current);
            }

            return (
              <section
                key={strategyName}
                className="overflow-hidden rounded-lg border border-white/[0.1] bg-[linear-gradient(180deg,rgba(17,47,78,0.9),rgba(8,28,49,0.82))] shadow-[0_22px_46px_rgba(0,5,18,0.28)]"
              >
                <div className="border-b border-white/[0.09] bg-white/[0.035] p-4">
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                    <button
                      type="button"
                      onClick={() => toggleStrategy(strategyName)}
                      aria-expanded={!isCollapsed}
                      className="group flex cursor-pointer items-start gap-3 rounded-md text-left focus-visible:outline-none"
                    >
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-white/[0.09] bg-white/[0.06] text-[var(--muted-strong)] transition group-hover:bg-white/[0.11]">
                        <ChevronDown
                          className={
                            "h-4 w-4 transition-transform duration-200 " +
                            (isCollapsed ? "-rotate-90" : "rotate-0")
                          }
                        />
                      </span>
                      <span>
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-lg font-bold tracking-tight text-[var(--foreground)]">
                            {strategyName}
                          </span>
                          <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 font-mono text-[10px] uppercase text-[var(--accent-strong)]">
                            {strategyRows.length} positions
                          </span>
                          {reconciledCount > 0 ? (
                            <span className="rounded-full bg-amber-400/15 px-2.5 py-1 font-mono text-[10px] uppercase text-amber-200">
                              {reconciledCount} broker reconciled
                            </span>
                          ) : (
                            <span className="rounded-full bg-emerald-400/15 px-2.5 py-1 font-mono text-[10px] uppercase text-emerald-200">
                              Broker verified
                            </span>
                          )}
                        </span>
                        <span className="mt-1 block text-xs text-[var(--muted)]">
                          Account {accounts.join(", ") || "—"} · {isCollapsed ? "Show holdings" : "Hide holdings"}
                        </span>
                      </span>
                    </button>

                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:min-w-[620px]">
                      {[
                        {
                          label: "Market value",
                          value: formatCurrency(marketValue.total),
                          complete: marketValue.complete,
                          tone: "",
                        },
                        {
                          label: "Day change",
                          value: formatCurrency(dayChange.total),
                          complete: dayChange.complete,
                          tone: positionValueClass(dayChange.total),
                        },
                        {
                          label: "Cost basis",
                          value: formatCurrency(costBasis.total),
                          complete: costBasis.complete,
                          tone: "",
                        },
                        {
                          label: "Unrealized P/L",
                          value: formatCurrency(gainLoss.total),
                          complete: gainLoss.complete,
                          tone: positionValueClass(gainLoss.total),
                        },
                      ].map((metric) => (
                        <div
                          key={metric.label}
                          className="rounded-md border border-white/[0.07] bg-black/10 px-3 py-2"
                        >
                          <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
                            {metric.label}
                          </div>
                          <div className={"mt-1 font-mono text-sm font-semibold " + metric.tone}>
                            {metric.value}
                          </div>
                          {!metric.complete ? (
                            <div className="mt-0.5 text-[9px] uppercase text-amber-200">
                              Partial pricing
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {isCollapsed
                  ? null
                  : [...assetMap.entries()]
                      .sort(([left], [right]) => left.localeCompare(right))
                      .map(([assetKey, assetGroup]) => (
                    <div key={assetKey} className="border-b border-white/[0.07] last:border-b-0">
                      <div className="flex items-center justify-between bg-black/10 px-4 py-2.5">
                        <h4 className="text-sm font-bold text-[var(--muted-strong)]">
                          {assetGroup.label}
                        </h4>
                        <span className="font-mono text-[10px] uppercase text-[var(--muted)]">
                          {assetGroup.rows.length} holdings
                        </span>
                      </div>
                      <div className="max-h-[620px] overflow-auto">
                        <table className="w-full min-w-[1160px] table-fixed border-collapse text-[12px]">
                          <thead className="sticky top-0 z-20 bg-[#173451] text-[10px] uppercase tracking-wide text-[#b7ccd8]">
                            <tr>
                              {positionTableColumns.map(
                                ({ label, align, sortKey }) => (
                                  <th
                                    key={label}
                                    aria-sort={
                                      sortKey
                                        ? positionSort?.key === sortKey
                                          ? positionSort.direction === "asc"
                                            ? "ascending"
                                            : "descending"
                                          : "none"
                                        : undefined
                                    }
                                    className={
                                      "whitespace-nowrap border-b border-white/[0.12] px-3 py-3 font-semibold " +
                                      (align === "right" ? "text-right" : "text-left") +
                                      (label === "Symbol"
                                        ? " sticky left-0 z-30 w-[8%] bg-[#173451]"
                                        : label === "Description"
                                          ? " sticky left-[8%] z-30 w-[12%] bg-[#173451] shadow-[8px_0_16px_rgba(0,7,20,0.24)]"
                                          : "")
                                    }
                                  >
                                    {sortKey ? (
                                      <button
                                        type="button"
                                        onClick={() => togglePositionSort(strategyName, sortKey)}
                                        className={
                                          "inline-flex w-full cursor-pointer items-center gap-1.5 rounded-sm transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 " +
                                          (align === "right"
                                            ? "justify-end"
                                            : "justify-start")
                                        }
                                        title={
                                          positionSort?.key === sortKey
                                            ? positionSort.direction === "asc"
                                              ? `Sort ${label} descending`
                                              : `Clear ${label} sorting`
                                            : `Sort ${label} ascending`
                                        }
                                      >
                                        <span>{label}</span>
                                        {positionSort?.key === sortKey ? (
                                          positionSort.direction === "asc" ? (
                                            <ChevronUp
                                              className="h-3.5 w-3.5 text-cyan-300"
                                              aria-hidden="true"
                                            />
                                          ) : (
                                            <ChevronDown
                                              className="h-3.5 w-3.5 text-cyan-300"
                                              aria-hidden="true"
                                            />
                                          )
                                        ) : (
                                          <ArrowUpDown
                                            className="h-3.5 w-3.5 opacity-50"
                                            aria-hidden="true"
                                          />
                                        )}
                                      </button>
                                    ) : (
                                      label
                                    )}
                                  </th>
                                ),
                              )}
                            </tr>
                          </thead>
                          <tbody>
                            {sortPositionRows(assetGroup.rows, positionSort).map(
                              (row, rowIndex) => (
                              <tr
                                key={(row.broker_account_id ?? "") + "-" + positionInstrumentLabel(row) + "-" + rowIndex}
                                className="group border-b border-white/[0.065] bg-white/[0.015] transition hover:bg-cyan-300/[0.055]"
                              >
                                <td className="sticky left-0 z-10 w-[8%] whitespace-nowrap bg-[#0d2c47] px-3 py-3 align-top transition group-hover:bg-[#123a59]">
                                  <div
                                    className="truncate font-mono text-sm font-bold text-cyan-300"
                                    title={positionInstrumentLabel(row)}
                                  >
                                    {positionInstrumentLabel(row)}
                                  </div>
                                  <div className="mt-1 text-[9px] uppercase text-[var(--muted)]">
                                    {row.sec_type ?? "—"} · {row.currency ?? "USD"}
                                  </div>
                                </td>
                                <td className="sticky left-[8%] z-10 w-[12%] bg-[#0d2c47] px-3 py-3 align-top shadow-[8px_0_16px_rgba(0,7,20,0.24)] transition group-hover:bg-[#123a59]">
                                  <div
                                    className="truncate font-medium text-[var(--foreground)]"
                                    title={positionDescription(row)}
                                  >
                                    {positionDescription(row)}
                                  </div>
                                  <div className="mt-1 text-[10px] text-[var(--muted)]">
                                    {row.broker_account_id ?? "—"}
                                  </div>
                                </td>
                                <td className="whitespace-nowrap px-3 py-3 text-right font-mono">
                                  {formatNumber(row.quantity, 4)}
                                </td>
                                <td className="whitespace-nowrap px-3 py-3 text-right font-mono">
                                  {formatPositionCurrency(row.mark_price)}
                                </td>
                                <td className="whitespace-nowrap px-3 py-3 text-right font-mono font-semibold">
                                  {formatPositionCurrency(row.market_value)}
                                </td>
                                <td className="whitespace-nowrap px-3 py-3 text-right font-mono">
                                  {formatPositionCurrency(row.cost_basis)}
                                </td>
                                <td className={"whitespace-nowrap px-3 py-3 text-right font-mono " + positionValueClass(row.day_change)}>
                                  {formatPositionCurrency(row.day_change)}
                                </td>
                                <td className={"whitespace-nowrap px-3 py-3 text-right font-mono font-semibold " + positionValueClass(row.unrealized_pnl)}>
                                  {formatPositionCurrency(row.unrealized_pnl)}
                                </td>
                                <td className={"whitespace-nowrap px-3 py-3 text-right font-mono font-semibold " + positionValueClass(row.gain_loss_percent)}>
                                  {formatPositionPercent(row.gain_loss_percent)}
                                </td>
                                <td className="whitespace-nowrap px-3 py-3 text-[var(--muted-strong)]">
                                  {row.expiry_date ?? "—"}
                                </td>
                              </tr>
                              ),
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
              </section>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

type EquityHistoryRow = AccountEquity & {
  dayChange: number | null;
  dayChangePercent: number | null;
};

function equitySnapshotTime(value: string | undefined, timezone: string) {
  if (!value) {
    return "—";
  }
  const formatted = formatTimestamp(value, timezone);
  return formatted.split(" ").at(-1) ?? formatted;
}

function AccountEquityPanel({
  rows,
  timezone,
}: {
  rows: AccountEquity[];
  timezone: string;
}) {
  const chronologicalRows = aggregateEquityHistory(rows);
  if (chronologicalRows.length === 0) {
    return (
      <Panel title="Equity History">
        <EmptyPanel>No equity history found in the selected time range.</EmptyPanel>
      </Panel>
    );
  }

  const dailyRows: EquityHistoryRow[] = chronologicalRows.map((row, index) => {
    const equity = toNumber(row.equity_value);
    const previousEquity =
      index > 0 ? toNumber(chronologicalRows[index - 1]?.equity_value) : null;
    const dayChange = previousEquity === null ? null : equity - previousEquity;
    const dayChangePercent =
      dayChange === null || previousEquity === null || previousEquity === 0
        ? null
        : (dayChange / Math.abs(previousEquity)) * 100;
    return { ...row, dayChange, dayChangePercent };
  });
  const orderedRows = [...dailyRows].reverse();
  const latest = dailyRows.at(-1);
  const first = dailyRows[0];
  const latestEquity = toNumber(latest?.equity_value);
  const firstEquity = toNumber(first?.equity_value);
  const periodChange = dailyRows.length > 1 ? latestEquity - firstEquity : null;
  const periodChangePercent =
    periodChange === null || firstEquity === 0
      ? null
      : (periodChange / Math.abs(firstEquity)) * 100;
  const accountCount = new Set(
    rows.map((row) => row.broker_account_id).filter(Boolean),
  ).size;

  const columns: TableColumn<EquityHistoryRow>[] = [
    {
      key: "date",
      label: "Date",
      width: "20%",
      sortValue: (row) => row.timestamp ?? row.date,
      render: (row) => (
        <div>
          <div className="font-medium text-[var(--foreground)]">
            {formatDate(row.date)}
          </div>
          <div className="mt-0.5 text-[11px] text-[var(--muted)]">
            Updated {equitySnapshotTime(row.timestamp, timezone)}
          </div>
        </div>
      ),
    },
    {
      key: "account",
      label: "Account",
      width: "20%",
      render: (row) => (
        <span className="inline-flex rounded-full border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 font-mono text-[10px] uppercase text-[var(--muted-strong)]">
          {row.broker_account_id === "ALL"
            ? "Portfolio"
            : (row.broker_account_id ?? "—")}
        </span>
      ),
    },
    {
      key: "equity",
      label: "Net Liquid",
      width: "20%",
      render: (row) => (
        <span className="font-mono font-semibold">
          {formatCurrency(toNumber(row.equity_value))}
        </span>
      ),
    },
    {
      key: "dayChange",
      label: "Daily Change",
      width: "20%",
      align: "right",
      render: (row) =>
        row.dayChange === null ? (
          <span className="text-[var(--muted)]">—</span>
        ) : (
          <span className={"font-mono font-medium " + positionValueClass(row.dayChange)}>
            {formatSignedCurrency(row.dayChange)}
          </span>
        ),
    },
    {
      key: "dayChangePercent",
      label: "Change %",
      width: "20%",
      align: "right",
      render: (row) =>
        row.dayChangePercent === null ? (
          <span className="text-[var(--muted)]">—</span>
        ) : (
          <span
            className={
              "font-mono font-medium " +
              positionValueClass(row.dayChangePercent)
            }
          >
            {formatSignedPercent(row.dayChangePercent)}
          </span>
        ),
    },
  ];

  return (
    <Panel title="Equity History">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-md bg-[linear-gradient(180deg,rgba(255,255,255,0.095),rgba(255,255,255,0.055))] px-4 py-3 shadow-[0_14px_32px_var(--shadow)]">
          <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
            Latest Net Liquid
          </div>
          <div className="mt-1 font-mono text-2xl font-semibold text-[var(--foreground)]">
            {formatCurrency(latestEquity)}
          </div>
          <div className="mt-1 text-xs text-[var(--muted)]">
            {accountCount} {accountCount === 1 ? "account" : "accounts"} · Updated{" "}
            {equitySnapshotTime(latest?.timestamp, timezone)}
          </div>
        </div>

        <div className="rounded-md bg-[linear-gradient(180deg,rgba(255,255,255,0.095),rgba(255,255,255,0.055))] px-4 py-3 shadow-[0_14px_32px_var(--shadow)]">
          <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
            Change in Range
          </div>
          <div
            className={
              "mt-1 font-mono text-2xl font-semibold " +
              positionValueClass(periodChange)
            }
          >
            {periodChange === null ? "—" : formatSignedCurrency(periodChange)}
          </div>
          <div className={"mt-1 text-xs " + positionValueClass(periodChangePercent)}>
            {periodChangePercent === null
              ? "No earlier daily close"
              : formatSignedPercent(periodChangePercent)}
          </div>
        </div>

        <div className="rounded-md bg-[linear-gradient(180deg,rgba(255,255,255,0.095),rgba(255,255,255,0.055))] px-4 py-3 shadow-[0_14px_32px_var(--shadow)]">
          <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
            Daily Closes
          </div>
          <div className="mt-1 font-mono text-2xl font-semibold text-[var(--foreground)]">
            {dailyRows.length}
          </div>
          <div className="mt-1 text-xs text-[var(--muted)]">
            Trading dates in selected range
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() =>
            downloadCsv(
              "equity-history.csv",
              [
                "Date",
                "Account",
                "Net Liquid",
                "Daily Change",
                "Change %",
                "Updated",
              ],
              orderedRows.map((row) => [
                formatDate(row.date),
                row.broker_account_id ?? "",
                row.equity_value ?? "",
                row.dayChange ?? "",
                row.dayChangePercent ?? "",
                formatTimestamp(row.timestamp, timezone),
              ]),
            )
          }
          className={`${secondaryButtonClass} w-full md:w-auto`}
        >
          <Download className="h-4 w-4" />
          Download CSV
        </button>
      </div>

      <DataTable
        key={
          "equity-" +
          dailyRows.length +
          "-" +
          (orderedRows[0]?.timestamp ?? orderedRows[0]?.date ?? "empty")
        }
        rows={orderedRows}
        columns={columns}
        pagination={{
          enabled: orderedRows.length > 15,
          pageSize: 15,
          pageSizeOptions: [15, 30, 60],
        }}
      />
    </Panel>
  );
}

function TradeLogsPanel({
  rows,
  timezone,
}: {
  rows: TradeExecution[];
  timezone: string;
}) {
  const columns: TableColumn<TradeExecution>[] = [
    {
      key: "timestamp",
      label: "Date",
      width: "205px",
      sticky: "left",
      sortValue: (row) => row.timestamp,
      render: (row) => formatTimestamp(row.timestamp, timezone),
    },
    {
      key: "strategy",
      label: "Strategy",
      width: "270px",
      sticky: "left",
      stickyOffset: "205px",
      stickyEdge: true,
      render: (row) => row.strategy_name ?? "-",
    },
    {
      key: "account",
      label: "Account ID",
      render: (row) => row.broker_account_id ?? "-",
    },
    { key: "symbol", label: "Symbol", render: (row) => row.symbol ?? "-" },
    { key: "type", label: "Type", render: (row) => row.sec_type ?? "-" },
    { key: "side", label: "Side", render: (row) => row.side ?? "-" },
    {
      key: "qty",
      label: "Qty",
      align: "right",
      render: (row) => formatNumber(row.quantity, 0),
    },
    {
      key: "price",
      label: "Price",
      align: "right",
      render: (row) => formatNumber(row.price),
    },
    {
      key: "commission",
      label: "Commission",
      align: "right",
      render: (row) => formatCurrency(toNumber(row.commission)),
    },
    {
      key: "pnl",
      label: "Trade P&L",
      align: "right",
      render: (row) => formatCurrency(toNumber(row.realized_pnl)),
    },
    { key: "status", label: "Status", render: (row) => row.status ?? "-" },
    { key: "notes", label: "Notes", render: (row) => row.notes ?? "" },
  ];
  const sortedRows = sortByNewest(rows);

  return (
    <Panel title="Raw Trade Executions">
      <div className="flex flex-col gap-3 rounded-md bg-white/[0.05] px-3 py-3 shadow-[0_12px_30px_rgba(0,5,18,0.16)] backdrop-blur xl:flex-row xl:items-center xl:justify-between">
        <div className="font-mono text-[11px] uppercase tracking-normal text-[var(--muted-strong)]">
          {rows.length} records loaded
        </div>
        <button
          type="button"
          disabled={rows.length === 0}
          onClick={() =>
            downloadCsv(
              "trade-logs.csv",
              columns.map((column) => column.label),
              sortedRows.map((row) => [
                formatTimestamp(row.timestamp, timezone),
                row.strategy_name ?? "-",
                row.broker_account_id ?? "-",
                row.symbol ?? "-",
                row.sec_type ?? "-",
                row.side ?? "-",
                formatNumber(row.quantity, 0),
                formatNumber(row.price),
                formatCurrency(toNumber(row.commission)),
                formatCurrency(toNumber(row.realized_pnl)),
                row.status ?? "-",
                row.notes ?? "",
              ]),
            )
          }
          className={secondaryButtonClass}
        >
          <Download className="h-4 w-4" />
          Download CSV
        </button>
      </div>

      {rows.length === 0 ? (
        <EmptyPanel>No trades found for the selected time range.</EmptyPanel>
      ) : (
        <DataTable
          key={`trades-${rows.length}-${sortedRows[0]?.timestamp ?? "empty"}`}
          rows={sortedRows}
          columns={columns}
          minWidth="2200px"
          pagination={{ enabled: true, pageSize: 25 }}
        />
      )}
    </Panel>
  );
}

function DiagnosticsPanel({
  strategy,
  accountId,
  startDate,
  endDate,
  timezone,
  data,
}: {
  strategy: string;
  accountId: string;
  startDate: string;
  endDate: string;
  timezone: string;
  data: DashboardData;
}) {
  const counts = recordCounts(data);
  const rows = [
    ["Strategy filter", strategy],
    ["Account filter", accountId],
    ["Date range", `${startDate} to ${endDate}`],
    ["Timezone", timezone],
    ["Execution records", String(counts.executions)],
    ["Account equity records", String(counts.equity)],
    ["Strategy daily P&L records", String(counts.pnl)],
    ["Strategy position snapshots", String(counts.positions)],
    ["Equity color", CHART_COLORS.profit],
    ["Loss color", CHART_COLORS.loss],
  ];

  return (
    <Panel title="System Diagnostics">
      <div className={surfaceClass}>
        <dl className="grid gap-x-8 gap-y-5 md:grid-cols-2 xl:grid-cols-3">
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs uppercase tracking-normal text-[var(--muted)]">
              {label}
            </dt>
            <dd className="mt-2 truncate font-mono text-sm text-[var(--foreground)]">
              {value}
            </dd>
          </div>
        ))}
        </dl>
      </div>
    </Panel>
  );
}

export function DashboardShell() {
  const initialToday = todayInTimeZone("Asia/Taipei");
  const [filters, setFilters] = useState<FilterOptions>(emptyFilters);
  const [strategy, setStrategy] = useState("ALL");
  const [accountId, setAccountId] = useState("ALL");
  const [datePreset, setDatePreset] = useState<DatePreset>("Today");
  const [timezone, setTimezone] = useState("Asia/Taipei");
  const [customStart, setCustomStart] = useState(initialToday);
  const [customEnd, setCustomEnd] = useState(initialToday);
  const [section, setSection] = useState<SectionId>("overview");
  const [data, setData] = useState<DashboardData>(emptyData);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const range = useMemo(
    () => resolveDateRange(datePreset, timezone, customStart, customEnd),
    [customEnd, customStart, datePreset, timezone],
  );
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/dashboard/filters", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => readApi<FilterOptions>(response))
      .then((payload) => {
        setFilters(payload);
        setFilterError(null);
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError") {
          setFilters(emptyFilters);
          setFilterError(error.message);
        }
      });
    return () => controller.abort();
  }, [refreshKey]);

  useEffect(() => {
    const controller = new AbortController();
    const includes = includesForSection(section);

    queueMicrotask(() => {
      if (controller.signal.aborted) {
        return;
      }
      setLoading(true);
      setDataError(null);

      fetch("/api/dashboard/data", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          strategy,
          accountId,
          startDate: range.startDate,
          endDate: range.endDate,
          timezone,
          section,
          ...includes,
        }),
      })
        .then((response) => readApi<DashboardData>(response))
        .then((payload) => {
          setData(payload);
          setDataError(null);
          setLastUpdatedAt(new Date().toISOString());
        })
        .catch((error: Error) => {
          if (error.name !== "AbortError") {
            setData(emptyData);
            setDataError(error.message);
          }
        })
        .finally(() => setLoading(false));
    });

    return () => controller.abort();
  }, [accountId, range.endDate, range.startDate, refreshKey, section, strategy, timezone]);

  async function handleRefresh() {
    setSyncing(true);
    setSyncError(null);

    try {
      const response = await fetch("/api/dashboard/sync", {
        method: "POST",
        cache: "no-store",
      });
      await readApi(response);
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : String(error));
    } finally {
      setSyncing(false);
    }
  }

  const currentPanel = (() => {
    if (section === "overview") {
      return (
        <OverviewPanel
          strategy={strategy}
          accountId={accountId}
          data={data}
        />
      );
    }
    if (section === "strategy-pnl") {
      return <StrategyPnlPanel rows={data.pnlRows} />;
    }
    if (section === "account-equity") {
      return <AccountEquityPanel rows={data.perfRows} timezone={timezone} />;
    }
    if (section === "positions") {
      return <StrategyPositionsPanel rows={data.positionRows} timezone={timezone} />;
    }
    if (section === "trade-logs") {
      return <TradeLogsPanel rows={data.execRows} timezone={timezone} />;
    }
    return (
      <DiagnosticsPanel
        strategy={strategy}
        accountId={accountId}
        startDate={range.startDate}
        endDate={range.endDate}
        timezone={timezone}
        data={data}
      />
    );
  })();

  return (
    <div className="relative min-h-screen text-[var(--foreground)] lg:flex">
      <SidebarFilters
        collapsed={sidebarCollapsed}
        filters={filters}
        strategy={strategy}
        accountId={accountId}
        datePreset={datePreset}
        timezone={timezone}
        customStart={customStart}
        customEnd={customEnd}
        onStrategyChange={setStrategy}
        onAccountChange={setAccountId}
        onPresetChange={setDatePreset}
        onTimezoneChange={setTimezone}
        onCustomStartChange={setCustomStart}
        onCustomEndChange={setCustomEnd}
        onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
      />

      <main className="min-w-0 flex-1 p-5 md:p-8 xl:p-10">
        <div className="mb-8 space-y-6 pt-1">
          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
            <div className="min-w-0 space-y-4 pr-14 md:pr-0">
              <div className="flex flex-wrap gap-3 font-mono text-[10px] uppercase tracking-normal text-[var(--muted)]">
                <span className={`${statusPillClass} border-[#9cf62f]/20 bg-[rgba(156,246,47,0.1)] text-[#b8ff5d]`}>
                  <span className="status-dot" aria-hidden="true" />
                  Live Monitor
                </span>
                <span className={statusPillClass}>
                  <SignalIcon icon={RadioTower} tone="cyan" className="h-5 w-5" iconClassName="h-3 w-3" />
                  API Synced
                </span>
                <span className={statusPillClass}>
                  <SignalIcon icon={ShieldCheck} tone="green" className="h-5 w-5" iconClassName="h-3 w-3" />
                  Read Only
                </span>
              </div>
              <h1 className="text-3xl font-semibold text-[var(--foreground)] md:text-4xl">
                Quant Alpha Dashboard
              </h1>
              <div className="flex flex-wrap gap-3 text-xs text-[var(--muted)]">
                <span className={`${metaPillClass} border-[rgba(45,212,191,0.18)] bg-[rgba(45,212,191,0.09)] text-[var(--accent-strong)]`}>
                  {strategy}
                </span>
                <span className={`${metaPillClass} border-[rgba(56,189,248,0.18)] bg-[rgba(56,189,248,0.08)] text-[#bae6fd]`}>
                  {accountId}
                </span>
                <span className={metaPillClass}>
                  {range.startDate} to {range.endDate}
                </span>
                <span className={`${metaPillClass} border-[rgba(192,132,252,0.18)] bg-[rgba(192,132,252,0.08)] text-[#ddd6fe]`}>
                  {timezone}
                </span>
              </div>
            </div>
            <div className="flex w-full max-w-full flex-col gap-2 justify-self-stretch self-start md:w-fit md:items-end md:justify-self-end md:pt-14 lg:pt-0">
              <button
                type="button"
                title={syncing ? "Synchronizing trading data" : "Refresh"}
                disabled={loading || syncing}
                onClick={handleRefresh}
                className={`${primaryButtonClass} w-full max-w-none shrink-0 self-start whitespace-nowrap md:w-auto md:max-w-max md:self-end`}
              >
                <SignalIcon
                  icon={RefreshCw}
                  tone="mint"
                  className="h-6 w-6"
                  iconClassName={`h-3.5 w-3.5 ${loading || syncing ? "animate-spin" : ""}`}
                />
                {syncing ? "Syncing..." : "Refresh"}
              </button>
              <div className="w-full max-w-full truncate whitespace-nowrap rounded-md bg-white/[0.05] px-3 py-1.5 text-center font-mono text-[11px] uppercase tracking-normal text-[var(--muted)] md:w-auto md:text-right">
                {syncing
                  ? "Syncing with IBKR..."
                  : loading
                  ? "Updating..."
                  : `Last update: ${formatTimestamp(lastUpdatedAt ?? undefined, timezone)}`}
              </div>
            </div>
          </div>
          <div>
            <SectionControl selected={section} onChange={setSection} />
          </div>
        </div>

        <div className="space-y-4">
          {filterError ? (
            <StatusMessage tone="error">
              Filter API unavailable: {filterError}
            </StatusMessage>
          ) : null}
          {dataError ? (
            <StatusMessage tone="error">
              Dashboard API unavailable: {dataError}
            </StatusMessage>
          ) : null}
          {syncError ? (
            <StatusMessage tone="error">
              Trading data sync failed: {syncError}
            </StatusMessage>
          ) : null}
          {syncing ? (
            <StatusMessage tone="loading">Synchronizing trades with IBKR...</StatusMessage>
          ) : loading ? (
            <StatusMessage tone="loading">Loading dashboard data...</StatusMessage>
          ) : null}
          {currentPanel}
        </div>
      </main>
    </div>
  );
}
