"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, RadioTower, RefreshCw, ShieldCheck } from "lucide-react";
import { EquityChart, PnlBarChart } from "@/components/dashboard-charts";
import { DataTable, type TableColumn } from "@/components/data-table";
import { MetricCard } from "@/components/metric-card";
import { SectionControl } from "@/components/section-control";
import { SignalIcon } from "@/components/signal-icon";
import { SidebarFilters } from "@/components/sidebar-filters";
import { StatusMessage } from "@/components/status-message";
import {
  CHART_COLORS,
  SECTIONS,
  computeKpis,
  formatCurrency,
  formatCurrencyDelta,
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
const emptyData: DashboardData = { execRows: [], perfRows: [], pnlRows: [] };
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
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-[var(--foreground)]">
        <span className="status-dot" aria-hidden="true" />
        {title}
      </h2>
      {children}
    </section>
  );
}

function EmptyPanel({ children }: { children: React.ReactNode }) {
  return <StatusMessage tone="info">{children}</StatusMessage>;
}

function OverviewPanel({
  strategy,
  accountId,
  data,
  timezone,
}: {
  strategy: string;
  accountId: string;
  data: DashboardData;
  timezone: string;
}) {
  const kpi = computeKpis(data.perfRows, data.execRows, data.pnlRows);
  const equityTone = kpi.equityChange < 0 ? "loss" : "profit";

  return (
    <Panel title={`Equity Overview: ${strategy} (${accountId})`}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Current Equity"
          value={formatCurrency(kpi.currentEquity)}
          delta={formatCurrencyDelta(kpi.equityChange)}
          tone={equityTone}
        />
        <MetricCard label="Total P&L" value={formatCurrency(kpi.totalPnl)} />
        <MetricCard label="Open Trades" value={String(kpi.openTrades)} />
        <MetricCard
          label="Total Commission"
          value={formatCurrency(kpi.totalCommission)}
        />
      </div>

      {data.perfRows.length === 0 ? (
        <EmptyPanel>
          No equity history available for this account in the selected time range.
        </EmptyPanel>
      ) : (
        <div className={surfaceClass}>
          <EquityChart rows={data.perfRows} timezone={timezone} />
        </div>
      )}
    </Panel>
  );
}

function StrategyPnlPanel({ rows }: { rows: StrategyDailyPnl[] }) {
  if (rows.length === 0) {
    return (
      <Panel title="Strategy P&L Performance">
        <EmptyPanel>
          No daily strategy performance data found in the selected time range.
        </EmptyPanel>
      </Panel>
    );
  }

  const summary = pnlSummary(rows);
  const orderedRows = sortByNewest(rows);
  const summaryColumns: TableColumn<(typeof summary)[number]>[] = [
    { key: "strategy", label: "Strategy", render: (row) => row.strategy },
    {
      key: "pnl",
      label: "P&L",
      align: "right",
      render: (row) => formatCurrency(row.pnl),
    },
    { key: "wins", label: "Wins", align: "right", render: (row) => row.wins },
    { key: "losses", label: "Losses", align: "right", render: (row) => row.losses },
    {
      key: "winRate",
      label: "Win Rate",
      align: "right",
      render: (row) => `${row.winRate.toFixed(1)}%`,
    },
  ];

  const rawColumns: TableColumn<StrategyDailyPnl>[] = [
    { key: "date", label: "Date", render: (row) => formatDate(row.date) },
    { key: "strategy", label: "Strategy", render: (row) => row.strategy_name ?? "-" },
    {
      key: "account",
      label: "Account ID",
      render: (row) => row.broker_account_id ?? "-",
    },
    {
      key: "equity",
      label: "Total Equity",
      align: "right",
      render: (row) => formatCurrency(toNumber(row.total_equity)),
    },
    {
      key: "pnl",
      label: "Total P&L",
      align: "right",
      render: (row) => formatCurrency(toNumber(row.daily_pnl)),
    },
  ];

  return (
    <Panel title="Strategy P&L Performance">
      <StatusMessage tone="info">
        Win rate counts positive daily net P&L as a win and excludes zero P&L days.
      </StatusMessage>
      <div className="grid gap-4 xl:grid-cols-[minmax(320px,0.8fr)_minmax(520px,1.2fr)]">
        <DataTable rows={summary} columns={summaryColumns} />
        <div className={surfaceClass}>
          <PnlBarChart rows={rows} />
        </div>
      </div>
      <div className="space-y-3">
        <div className="flex flex-col gap-3 rounded-md bg-white/[0.05] px-3 py-3 shadow-[0_12px_30px_rgba(0,5,18,0.16)] backdrop-blur xl:flex-row xl:items-center xl:justify-between">
          <div className="font-mono text-[11px] uppercase tracking-normal text-[var(--muted-strong)]">
            {orderedRows.length} records loaded
          </div>
          <button
            type="button"
            onClick={() =>
              downloadCsv(
                "performance-logs.csv",
                rawColumns.map((column) => column.label),
                orderedRows.map((row) => [
                  formatDate(row.date),
                  row.strategy_name ?? "-",
                  row.broker_account_id ?? "-",
                  formatCurrency(toNumber(row.total_equity)),
                  formatCurrency(toNumber(row.daily_pnl)),
                ]),
              )
            }
            className={secondaryButtonClass}
          >
            <Download className="h-4 w-4" />
            Download CSV
          </button>
        </div>
        <DataTable
          key={`pnl-${rows.length}-${orderedRows[0]?.date ?? "empty"}`}
          rows={orderedRows}
          columns={rawColumns}
          pagination={{ enabled: true, pageSize: 20 }}
        />
      </div>
    </Panel>
  );
}

function AccountEquityPanel({
  rows,
  timezone,
}: {
  rows: AccountEquity[];
  timezone: string;
}) {
  if (rows.length === 0) {
    return (
      <Panel title="Account Equity History">
        <EmptyPanel>No equity history found in the selected time range.</EmptyPanel>
      </Panel>
    );
  }

  const columns: TableColumn<AccountEquity>[] = [
    { key: "date", label: "Date", render: (row) => formatDate(row.date) },
    {
      key: "account",
      label: "Account ID",
      render: (row) => row.broker_account_id ?? "-",
    },
    {
      key: "equity",
      label: "Equity Value",
      align: "right",
      render: (row) => formatCurrency(toNumber(row.equity_value)),
    },
    {
      key: "timestamp",
      label: "Timestamp",
      render: (row) => formatTimestamp(row.timestamp, timezone),
    },
  ];
  const orderedRows = sortByNewest(rows);

  return (
    <Panel title="Account Equity History">
      <div className="flex flex-col gap-3 rounded-md bg-white/[0.05] px-3 py-3 shadow-[0_12px_30px_rgba(0,5,18,0.16)] backdrop-blur xl:flex-row xl:items-center xl:justify-between">
        <div className="font-mono text-[11px] uppercase tracking-normal text-[var(--muted-strong)]">
          {orderedRows.length} records loaded
        </div>
        <button
          type="button"
          onClick={() =>
            downloadCsv(
              "account-equity-history.csv",
              columns.map((column) => column.label),
              orderedRows.map((row) => [
                formatDate(row.date),
                row.broker_account_id ?? "-",
                formatCurrency(toNumber(row.equity_value)),
                formatTimestamp(row.timestamp, timezone),
              ]),
            )
          }
          className={secondaryButtonClass}
        >
          <Download className="h-4 w-4" />
          Download CSV
        </button>
      </div>
      <DataTable
        key={`equity-${rows.length}-${orderedRows[0]?.timestamp ?? orderedRows[0]?.date ?? "empty"}`}
        rows={orderedRows}
        columns={columns}
        pagination={{ enabled: true, pageSize: 25 }}
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
      label: "Timestamp",
      render: (row) => formatTimestamp(row.timestamp, timezone),
    },
    { key: "strategy", label: "Strategy", render: (row) => row.strategy_name ?? "-" },
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
  const activeSectionLabel =
    SECTIONS.find((item) => item.id === section)?.label ?? "Overview";

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
          timezone={timezone}
        />
      );
    }
    if (section === "strategy-pnl") {
      return <StrategyPnlPanel rows={data.pnlRows} />;
    }
    if (section === "account-equity") {
      return <AccountEquityPanel rows={data.perfRows} timezone={timezone} />;
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
    <div className="min-h-screen text-[var(--foreground)] lg:flex">
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
          <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0 space-y-4">
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
              <div>
                <div className="text-xs font-medium uppercase tracking-normal text-[var(--accent-strong)]">
                  {activeSectionLabel}
                </div>
                <h1 className="mt-2 text-3xl font-semibold text-[var(--foreground)] md:text-4xl">
                  Quant Alpha Dashboard
                </h1>
              </div>
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
            <div className="flex w-full flex-col gap-2 xl:w-auto xl:items-end">
              <button
                type="button"
                title={syncing ? "Synchronizing trading data" : "Refresh"}
                disabled={loading || syncing}
                onClick={handleRefresh}
                className={`${primaryButtonClass} w-full xl:w-auto`}
              >
                <SignalIcon
                  icon={RefreshCw}
                  tone="mint"
                  className="h-6 w-6"
                  iconClassName={`h-3.5 w-3.5 ${loading || syncing ? "animate-spin" : ""}`}
                />
                {syncing ? "Syncing..." : "Refresh"}
              </button>
              <div className="rounded-md bg-white/[0.05] px-3 py-1.5 text-center font-mono text-[11px] uppercase tracking-normal text-[var(--muted)] xl:text-right">
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
