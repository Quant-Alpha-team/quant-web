"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  ChevronDown,
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
  aggregateEquityHistory,
  computeKpis,
  formatCurrency,
  formatDate,
  formatNumber,
  formatTimestamp,
  includesForSection,
  pnlSummary,
  resolveDateRange,
  sortByNewest,
  strategyFamily,
  strategyIdentity,
  strategyVersionLabel,
  toNumber,
  toOptionalNumber,
  todayInTimeZone,
} from "@/lib/dashboard";
import type { ReconciliationSyncResult } from "@/lib/reconciliation";
import { TRADE_LOG_INSTRUMENT_COLUMNS } from "@/lib/trade-executions";
import type {
  AccountEquity,
  DashboardData,
  DatasetMetadata,
  DatePreset,
  FilterOptions,
  SectionId,
  StrategyScope,
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

const emptyFilters: FilterOptions = {
  strategy_families: [],
  accounts: [],
};

type HealthPayload = {
  status: "online" | "offline";
  checkedAt: string;
  backend: { reachable: boolean; protectedAccess: boolean };
};

type HealthState = {
  status: "checking" | "online" | "offline";
  checkedAt: string | null;
  error: string | null;
};

function selectionLabel(values: string[], allLabel: string) {
  if (values.includes("ALL")) {
    return allLabel;
  }
  return values.length > 0 ? values.join(", ") : "NONE";
}

function sameSelection(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

const surfaceClass =
  "rounded-md bg-[radial-gradient(circle_at_100%_0%,rgba(94,234,212,0.1),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.095),rgba(255,255,255,0.055))] p-4 shadow-[0_18px_42px_var(--shadow)] backdrop-blur-xl";
const statusPillClass =
  "flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 font-mono text-[10px] uppercase tracking-normal text-[var(--muted-strong)]";
const operationalStatusVisuals = {
  current: { className: "text-emerald-200", tone: "green" },
  failed: { className: "text-rose-200", tone: "rose" },
  partial: { className: "text-amber-200", tone: "amber" },
  loading: { className: "text-cyan-200", tone: "cyan" },
  pending: { className: "text-cyan-200", tone: "cyan" },
  complete: { className: "text-emerald-200", tone: "green" },
  warning: { className: "text-amber-200", tone: "amber" },
  running: { className: "text-cyan-200", tone: "cyan" },
  "not run": { className: "text-[var(--muted-strong)]", tone: "amber" },
} as const;
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

  let text = String(value).replace(/[\r\n]+/g, " ");
  if (typeof value === "string" && /^[\u0000-\u0020]*[=+\-@]/.test(text)) {
    text = `'${text}`;
  }
  return /[",]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(fileName: string, headers: string[], rows: unknown[][]) {
  const csv = "\uFEFF" + [headers.map(csvCell).join(","), ...rows.map((row) => row.map(csvCell).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);

  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

type CellValue = string | number | null | undefined;

type CsvField<T> = {
  label: string;
  csvValue: (row: T) => unknown;
};

function csvField<T>(
  label: string,
  csvValue: (row: T) => unknown,
): CsvField<T> {
  return { label, csvValue };
}

type DashboardColumn<T> = TableColumn<T> & CsvField<T>;

type ValueColumnOptions<T> = Omit<
  TableColumn<T>,
  "key" | "label" | "render" | "sortValue"
> & {
  sortable?: boolean;
  missing?: ReactNode;
  render?: (value: CellValue, row: T) => ReactNode;
  csvValue?: (value: CellValue, row: T) => unknown;
  csvMissing?: unknown;
};

function valueColumn<T>(
  key: string,
  label: string,
  read: (row: T) => CellValue,
  options: ValueColumnOptions<T> = {},
): DashboardColumn<T> {
  const {
    sortable,
    missing = "—",
    render,
    csvMissing = "",
    csvValue,
    ...column
  } = options;
  return {
    key,
    label,
    ...column,
    sortValue: sortable ? read : undefined,
    render: (row) => {
      const value = read(row);
      return render ? render(value, row) : (value ?? missing);
    },
    csvValue: (row) => {
      const value = read(row);
      return csvValue ? csvValue(value, row) : (value ?? csvMissing);
    },
  };
}

function CsvDownloadButton<T>({
  fileName,
  fields,
  rows,
  disabled = false,
  className = secondaryButtonClass,
}: {
  fileName: string;
  fields: readonly CsvField<T>[];
  rows: readonly T[];
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() =>
        downloadCsv(
          fileName,
          fields.map((field) => field.label),
          rows.map((row) => fields.map((field) => field.csvValue(row))),
        )
      }
      className={className}
    >
      <Download className="h-4 w-4" />
      Download CSV
    </button>
  );
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

function DatasetUnavailableMessage({
  label,
  metadata,
}: {
  label: string;
  metadata: DatasetMetadata;
}) {
  return (
    <StatusMessage tone="error">
      {label} data is unavailable for this query.
      {metadata.error ? ` ${metadata.error}` : " Try reloading the data."}
    </StatusMessage>
  );
}

const datasetLabels: Record<keyof DashboardData["meta"]["datasets"], string> = {
  executions: "Executions",
  equity: "Account equity",
  pnl: "Strategy P&L",
  positions: "Positions",
};

function scopeIssueSummary(labels: string[]) {
  const visibleLabels = labels.slice(0, 3);
  if (visibleLabels.length === 0) {
    return "";
  }
  const remaining = labels.length - visibleLabels.length;
  return ` (${visibleLabels.join(", ")}${remaining > 0 ? `, +${remaining} more` : ""})`;
}

function datasetMetadataSummary(metadata: DatasetMetadata) {
  if (!metadata.requested) {
    return "Not requested for this view";
  }
  const total = metadata.total === null ? "total unknown" : `${metadata.total} total`;
  const details = [`${metadata.fetched} fetched`, total];
  if (metadata.truncated) {
    details.push("truncated");
  } else if (!metadata.complete) {
    details.push("partial");
  } else {
    details.push("complete");
  }
  if (metadata.invalidRows > 0) {
    details.push(
      `${metadata.invalidRows} invalid row${metadata.invalidRows === 1 ? "" : "s"} omitted`,
    );
  }
  if (metadata.scopes.incomplete > 0) {
    details.push(
      `${metadata.scopes.incomplete}/${metadata.scopes.requested} scopes incomplete${scopeIssueSummary(metadata.scopes.incompleteLabels)}`,
    );
  }
  if (metadata.scopes.failed > 0) {
    details.push(
      `${metadata.scopes.failed}/${metadata.scopes.requested} scopes failed${scopeIssueSummary(metadata.scopes.failedLabels)}`,
    );
  }
  return details.join(" · ");
}

function DataQualityNotice({ data }: { data: DashboardData }) {
  const issues = Object.entries(data.meta.datasets).filter(
    ([, metadata]) =>
      metadata.requested &&
      (!metadata.complete || metadata.truncated || metadata.invalidRows > 0),
  ) as Array<[keyof DashboardData["meta"]["datasets"], DatasetMetadata]>;

  if (issues.length === 0) {
    return null;
  }

  return (
    <StatusMessage tone="info">
      <div>
        <div className="font-semibold text-amber-100">
          Partial data — totals, charts, and CSV exports may be incomplete.
        </div>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {issues.map(([name, metadata]) => (
            <li key={name}>
              {datasetLabels[name]}: {datasetMetadataSummary(metadata)}
              {metadata.error ? ` · ${metadata.error}` : ""}
            </li>
          ))}
        </ul>
      </div>
    </StatusMessage>
  );
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

function datasetAvailable(metadata: DatasetMetadata) {
  return metadata.requested && (metadata.complete || metadata.fetched > 0);
}

function datasetDetail(detail: string, metadata: DatasetMetadata) {
  const notices: string[] = [];
  if (metadata.truncated) {
    notices.push("Result limit reached");
  } else if (!metadata.complete) {
    notices.push("Partial dataset");
  }
  if (metadata.invalidRows > 0) {
    notices.push(
      `${metadata.invalidRows} invalid row${metadata.invalidRows === 1 ? "" : "s"} omitted`,
    );
  }
  return notices.length > 0 ? `${notices.join(" · ")} · ${detail}` : detail;
}

function OverviewPanel({
  strategyScope,
  accountId,
  data,
}: {
  strategyScope: string;
  accountId: string;
  data: DashboardData;
}) {
  const kpi = computeKpis(
    data.perfRows,
    data.execRows,
    data.pnlRows,
    data.positionRows,
  );
  const { executions, equity, pnl, positions } = data.meta.datasets;
  const executionsAvailable = datasetAvailable(executions);
  const equityAvailable = datasetAvailable(equity);
  const pnlAvailable = datasetAvailable(pnl);
  const positionsAvailable = datasetAvailable(positions);
  const executionsComplete =
    executionsAvailable && executions.complete && !executions.truncated;
  const pnlComplete = pnlAvailable && pnl.complete && !pnl.truncated;
  const positionsComplete =
    positionsAvailable && positions.complete && !positions.truncated;
  const accountHistoryComplete = equity.complete && !equity.truncated;
  const currentEquityValue =
    accountHistoryComplete ? kpi.accountNav : null;
  const currentPositionsValue = accountHistoryComplete
    ? kpi.accountGrossPositionValue
    : null;
  const currentCashValue = accountHistoryComplete ? kpi.accountCash : null;
  const currentEquityAvailable = currentEquityValue !== null;
  const realizedValueCount = data.pnlRows.filter(
    (row) => toOptionalNumber(row.realized_pnl) !== null,
  ).length;
  const realizedCoverageComplete =
    realizedValueCount === data.pnlRows.length;
  const realizedValue =
    pnlComplete && realizedCoverageComplete
      ? data.pnlRows.length === 0
        ? 0
        : kpi.periodRealizedPnl
      : null;
  const realizedDetail = !pnlAvailable
    ? "Realized P&L data unavailable"
    : !pnlComplete
      ? data.pnlRows.length === 0
        ? "No records were fetched; the full-range total is unavailable"
        : `${realizedValueCount}/${data.pnlRows.length} fetched rows include realized P&L; the full-range total is unavailable`
      : !realizedCoverageComplete
        ? `${realizedValueCount}/${data.pnlRows.length} rows include realized P&L; the total is unavailable`
        : data.pnlRows.length === 0
          ? "No realized P&L records in selected range"
          : `${kpi.periodRealizedRecords} daily realized record${kpi.periodRealizedRecords === 1 ? "" : "s"}`;
  const navDetail =
    data.perfRows.length === 0
      ? "No NAV closes in selected range"
      : kpi.navChange === null || kpi.navChangePercent === null
      ? "One NAV close in selected range"
      : `${formatSignedCurrency(kpi.navChange)} (${formatSignedPercent(kpi.navChangePercent)})`;
  const accountMetricDetail = (value: number | null, label: string) => {
    let detail: string;
    if (!equityAvailable) {
      detail = "Account equity data unavailable";
    } else if (!accountHistoryComplete) {
      detail = "Latest " + label + " is not guaranteed";
    } else if (data.perfRows.length === 0) {
      detail = "No " + label + " snapshot in selected range";
    } else if (value === null) {
      detail = label + " is unavailable in the latest account snapshot";
    } else {
      detail = "Current account-wide broker value";
    }
    return datasetDetail(
      detail + " · Not affected by strategy filters",
      equity,
    );
  };
  const tradedFamilies = new Set(
    data.execRows.map((row) => strategyFamily(row)),
  ).size;
  const tradesDetail =
    kpi.totalTrades === 0
      ? `No executions in ${executionsComplete ? "selected range" : "fetched records"}`
      : `${tradedFamilies} ${tradedFamilies === 1 ? "family" : "families"} in ${executionsComplete ? "selected range" : "fetched records"}`;
  const commissionValues = data.execRows
    .map((row) => toOptionalNumber(row.commission))
    .filter((value): value is number => value !== null);
  const commissionCoverageComplete =
    commissionValues.length === data.execRows.length;
  const commissionValue =
    executionsComplete && commissionCoverageComplete
      ? commissionValues.reduce((total, value) => total + value, 0)
      : null;
  const commissionDetail = !executionsAvailable
    ? "Commission data unavailable"
    : !executionsComplete
      ? data.execRows.length === 0
        ? "No executions were fetched; the full-range commission is unavailable"
        : `${commissionValues.length}/${data.execRows.length} fetched executions include commission; the full-range total is unavailable`
      : !commissionCoverageComplete
        ? `${commissionValues.length}/${data.execRows.length} executions include commission; the total is unavailable`
        : data.execRows.length === 0
          ? "No commission in selected range"
          : `${formatCurrency(Math.abs(commissionValue ?? 0) / data.execRows.length)} average per trade`;
  const unrealizedValue = positionsComplete ? kpi.openPnl : null;
  const overviewMetrics = [
    {
      label: "Account Current Equity",
      value: currentEquityAvailable
        ? formatCurrency(currentEquityValue)
        : "Unavailable",
      delta: datasetDetail(
        `${
          currentEquityAvailable
            ? navDetail
            : "Latest NAV close is not guaranteed"
        } · Not affected by strategy filters`,
        equity,
      ),
      deltaTone: currentEquityAvailable
        ? metricTone(kpi.navChange)
        : "neutral",
      iconTone: "cyan",
    },
    {
      label: "Positions Value",
      value:
        currentPositionsValue === null
          ? "Unavailable"
          : formatCurrency(currentPositionsValue),
      delta: accountMetricDetail(currentPositionsValue, "positions value"),
      iconTone: "violet",
    },
    {
      label: "Cash",
      value:
        currentCashValue === null
          ? "Unavailable"
          : formatCurrency(currentCashValue),
      delta: accountMetricDetail(currentCashValue, "cash"),
      iconTone: "mint",
    },
    {
      label: "Total Realized P&L",
      value: realizedValue === null ? "Unavailable" : formatCurrency(realizedValue),
      delta: datasetDetail(realizedDetail, pnl),
      tone: metricTone(realizedValue),
      deltaTone: metricTone(realizedValue),
    },
    {
      label: "Total Unrealized P&L",
      value:
        !positionsAvailable || !positionsComplete
          ? "Unavailable"
          : unrealizedValue === null
            ? "Pricing incomplete"
            : formatCurrency(unrealizedValue),
      delta: datasetDetail(
        !positionsAvailable
          ? "Position data unavailable"
          : !positionsComplete
            ? `${kpi.pricedPositions}/${kpi.openPositions} fetched positions valued; the full-range total is unavailable`
            : kpi.openPositions === 0
              ? "No open positions"
              : `${kpi.pricedPositions}/${kpi.openPositions} positions valued`,
        positions,
      ),
      tone: metricTone(unrealizedValue),
    },
    {
      label: "Total Commission",
      value: commissionValue === null ? "Unavailable" : formatCurrency(commissionValue),
      delta: datasetDetail(commissionDetail, executions),
    },
    {
      label: "Total Trades",
      value: !executionsAvailable
        ? "Unavailable"
        : `${kpi.totalTrades}${executionsComplete ? "" : "+"}`,
      delta: datasetDetail(tradesDetail, executions),
    },
    {
      label: "Open Positions",
      value: !positionsAvailable
        ? "Unavailable"
        : `${kpi.openPositions}${positionsComplete ? "" : "+"}`,
      delta: datasetDetail(
        `${kpi.openStrategies} ${kpi.openStrategies === 1 ? "family" : "families"} in ${positionsComplete ? "selected range" : "fetched records"}`,
        positions,
      ),
    },
  ] satisfies Array<Parameters<typeof MetricCard>[0]>;

  return (
    <Panel title={`Portfolio Overview: ${strategyScope} (${accountId})`}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        {overviewMetrics.map((metric, index) => (
          <div
            key={metric.label}
            className={index >= 6 ? "lg:col-span-3" : "lg:col-span-2"}
          >
            <MetricCard {...metric} />
          </div>
        ))}
      </div>

      {!equityAvailable ? (
        <DatasetUnavailableMessage
          label="Account equity"
          metadata={equity}
        />
      ) : data.perfRows.length === 0 ? (
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

type StrategyTableRow = {
  strategy_name?: string;
  strategy_family?: string;
  strategy_version?: string | null;
};

function strategyColumns<T extends StrategyTableRow>(
  stickyOffset: string,
  missing: ReactNode = "—",
  csvMissing = "",
): DashboardColumn<T>[] {
  return [
    valueColumn<T>("family", "Family", strategyFamily, {
      width: "250px",
      sticky: "left",
      stickyOffset,
      stickyEdge: true,
      sortable: true,
    }),
    valueColumn<T>("version", "Version", strategyVersionLabel, {
      width: "110px",
      sortable: true,
    }),
    valueColumn<T>("strategyIdentity", "Strategy ID", (row) => row.strategy_name, {
      width: "280px",
      sortable: true,
      missing,
      csvMissing,
    }),
  ];
}

const strategyPnlHelp =
  "Daily P&L is net of commission and includes the daily open-position mark change when pricing is available. Realized P&L is the day's realized result after commission; opening-only fees do not create realized P&L. Unrealized P&L is shown separately. Empty zero-only archive rows are omitted.";

function StrategyPnlPanel({
  rows,
  metadata,
}: {
  rows: StrategyDailyPnl[];
  metadata: DatasetMetadata;
}) {
  if (!datasetAvailable(metadata)) {
    return (
      <Panel title="Strategy P&L Performance" helpText={strategyPnlHelp}>
        <DatasetUnavailableMessage label="Strategy P&L" metadata={metadata} />
      </Panel>
    );
  }

  const summary = pnlSummary(rows);
  const informativeRows = rows.filter(
    (row) =>
      isMarkToMarketRow(row) ||
      (row.daily_pnl !== null &&
        row.daily_pnl !== undefined &&
        Math.abs(toNumber(row.daily_pnl)) >= 0.005),
  );

  if (informativeRows.length === 0 && summary.length === 0) {
    return (
      <Panel title="Strategy P&L Performance" helpText={strategyPnlHelp}>
        <EmptyPanel>
          {metadata.complete
            ? "No non-zero daily strategy performance was recorded in the selected range."
            : "No non-zero strategy performance was found in the fetched records. This incomplete response cannot confirm the full selected range."}
        </EmptyPanel>
      </Panel>
    );
  }

  const orderedRows = sortByNewest(informativeRows);
  type SummaryRow = (typeof summary)[number];
  const summaryColumns: DashboardColumn<SummaryRow>[] = [
    valueColumn<SummaryRow>("strategy", "Strategy Family", (row) => row.strategy, {
      width: "24%",
      sortable: true,
    }),
    valueColumn<SummaryRow>("pnl", "P&L", (row) => row.pnl, {
      align: "right", width: "20%", sortable: true,
      render: (_, row) => formatCurrency(row.pnl),
    }),
    valueColumn<SummaryRow>("wins", "Wins", (row) => row.wins, {
      align: "right", width: "18%", sortable: true,
    }),
    valueColumn<SummaryRow>("losses", "Losses", (row) => row.losses, {
      align: "right", width: "18%", sortable: true,
    }),
    valueColumn<SummaryRow>("winRate", "Win Rate", (row) => row.winRate, {
      align: "right", width: "20%", sortable: true,
      render: (_, row) => `${row.winRate.toFixed(1)}%`,
    }),
  ];

  const rawColumns: DashboardColumn<StrategyDailyPnl>[] = [
    valueColumn<StrategyDailyPnl>("date", "Date", (row) => row.date, {
      width: "140px",
      sticky: "left",
      sortable: true,
      render: (_, row) => formatDate(row.date),
      csvValue: (_, row) => formatDate(row.date),
    }),
    ...strategyColumns<StrategyDailyPnl>("140px"),
    valueColumn<StrategyDailyPnl>("account", "Account", (row) => row.broker_account_id),
    valueColumn<StrategyDailyPnl>("dailyPnl", "Daily P&L", (row) => row.daily_pnl, {
      align: "right", render: (value) => pnlTableValue(value),
    }),
    valueColumn<StrategyDailyPnl>("realizedPnl", "Realized P&L", (row) => row.realized_pnl, {
      align: "right", render: (value) => pnlTableValue(value),
    }),
    valueColumn<StrategyDailyPnl>("unrealizedPnl", "Unrealized P&L", (row) => row.unrealized_pnl, {
      align: "right",
      render: (value, row) => pnlTableValue(value, isMarkToMarketRow(row)),
      csvValue: (value, row) => isMarkToMarketRow(row) ? (value ?? "") : "",
    }),
    valueColumn<StrategyDailyPnl>("commission", "Commission", (row) => row.commission, {
      align: "right", render: (value) => commissionTableValue(value),
    }),
    valueColumn<StrategyDailyPnl>("basis", "Data Basis", pnlDataBasis),
  ];

  return (
    <Panel title="Strategy P&L Performance" helpText={strategyPnlHelp}>
      <div className="grid gap-4">
        <DataTable rows={summary} columns={summaryColumns} />
        <div className={surfaceClass}>
          <PnlBarChart rows={rows} />
        </div>
      </div>
      <div className="space-y-3">
        <div className="flex flex-col gap-3 rounded-md bg-white/[0.05] px-3 py-3 shadow-[0_12px_30px_rgba(0,5,18,0.16)] backdrop-blur xl:flex-row xl:items-center xl:justify-between">
          <div className="font-mono text-[11px] uppercase tracking-normal text-[var(--muted-strong)]">
            {orderedRows.length} informative records
          </div>
          <CsvDownloadButton
            fileName="performance-logs.csv"
            fields={rawColumns}
            rows={orderedRows}
          />
        </div>
        <DataTable
          key={`pnl-${informativeRows.length}-${orderedRows[0]?.date ?? "empty"}`}
          rows={orderedRows}
          columns={rawColumns}
          minWidth="1900px"
          pagination={{ enabled: true, pageSize: 20 }}
        />
      </div>
    </Panel>
  );
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
  const numeric = toOptionalNumber(value);
  if (numeric === null || numeric === 0) {
    return "text-[var(--muted-strong)]";
  }
  return numeric > 0 ? "text-[var(--profit)]" : "text-[var(--loss)]";
}

function formatPositionCurrency(value: unknown, currency?: string) {
  const numeric = toOptionalNumber(value);
  if (numeric === null) {
    return "—";
  }
  const currencyCode = currency?.trim().toUpperCase();
  if (!currencyCode || !/^[A-Z]{3}$/.test(currencyCode)) {
    return `${formatNumber(numeric)} (currency unknown)`;
  }
  try {
    return formatCurrency(numeric, currencyCode);
  } catch {
    return `${formatNumber(numeric)} ${currencyCode}`;
  }
}

function formatPositionPercent(value: unknown) {
  const numeric = toOptionalNumber(value);
  return numeric === null ? "—" : formatNumber(numeric, 2) + "%";
}

function positionNumericColumn(
  key: string,
  label: string,
  width: number,
  valueKey: keyof StrategyPosition,
  options: {
    bold?: boolean;
    tone?: boolean;
    format?: (value: unknown, row: StrategyPosition) => string;
  } = {},
): TableColumn<StrategyPosition> {
  return {
    key,
    label,
    width: `${width}px`,
    resizeMinWidth: width,
    align: "right",
    sortValue: (row) => toOptionalNumber(row[valueKey]),
    render: (row) => {
      const value = row[valueKey];
      return (
        <span
          className={`font-mono${options.bold ? " font-semibold" : ""}${
            options.tone ? ` ${positionValueClass(value)}` : ""
          }`}
        >
          {options.format
            ? options.format(value, row)
            : formatPositionCurrency(value, row.currency)}
        </span>
      );
    },
  };
}

const positionTableColumns: TableColumn<StrategyPosition>[] = [
  {
    key: "symbol",
    label: "Symbol",
    width: "96px",
    resizeMinWidth: 96,
    sticky: "left",
    render: (row) => (
      <div>
        <div
          className="truncate font-mono text-sm font-bold text-cyan-300"
          title={positionInstrumentLabel(row)}
        >
          {positionInstrumentLabel(row)}
        </div>
        <div className="mt-1 text-[9px] uppercase text-[var(--muted)]">
          {row.sec_type ?? "—"} · {row.currency ?? "Currency unknown"}
        </div>
      </div>
    ),
  },
  {
    key: "description",
    label: "Description",
    width: "140px",
    resizeMinWidth: 140,
    sticky: "left",
    stickyOffset: "96px",
    stickyEdge: true,
    render: (row) => (
      <div>
        <div
          className="truncate font-medium text-[var(--foreground)]"
          title={positionDescription(row)}
        >
          {positionDescription(row)}
        </div>
        <div
          className="mt-1 truncate text-[10px] text-[var(--muted)]"
          title={row.strategy_name}
        >
          {strategyVersionLabel(row)} · {row.strategy_name ?? "Unknown"} ·{" "}
          {row.broker_account_id ?? "—"}
        </div>
      </div>
    ),
  },
  positionNumericColumn("quantity", "Qty", 72, "quantity", {
    format: (value) => formatNumber(value, 4),
  }),
  positionNumericColumn("price", "Price", 88, "mark_price"),
  positionNumericColumn("marketValue", "Mkt Val", 104, "market_value", {
    bold: true,
  }),
  positionNumericColumn("costBasis", "Cost Basis", 104, "cost_basis"),
  positionNumericColumn("dayChange", "P/L Day", 112, "day_change", {
    tone: true,
  }),
  positionNumericColumn("profitLoss", "P/L", 104, "unrealized_pnl", {
    bold: true,
    tone: true,
  }),
  positionNumericColumn(
    "profitLossPercent",
    "P/L %",
    92,
    "gain_loss_percent",
    {
      bold: true,
      tone: true,
      format: formatPositionPercent,
    },
  ),
  {
    key: "expiration",
    label: "Exp/Mat",
    width: "112px",
    resizeMinWidth: 112,
    sortValue: (row) => row.expiry_date,
    render: (row) => (
      <span className="text-[var(--muted-strong)]">{row.expiry_date ?? "—"}</span>
    ),
  },
];

function sumPositionValues(
  rows: StrategyPosition[],
  readValue: (row: StrategyPosition) => unknown,
) {
  let total = 0;
  let complete = true;
  for (const row of rows) {
    const value = toOptionalNumber(readValue(row));
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
  metadata,
}: {
  rows: StrategyPosition[];
  timezone: string;
  metadata: DatasetMetadata;
}) {
  const orderedRows = [...rows].sort((left, right) => {
    const familyOrder = strategyFamily(left).localeCompare(strategyFamily(right));
    if (familyOrder !== 0) {
      return familyOrder;
    }
    const strategyOrder = (left.strategy_name ?? "").localeCompare(right.strategy_name ?? "");
    if (strategyOrder !== 0) {
      return strategyOrder;
    }
    const leftGroup = positionAssetGroup(left.sec_type).key;
    const rightGroup = positionAssetGroup(right.sec_type).key;
    if (leftGroup !== rightGroup) {
      return leftGroup.localeCompare(rightGroup);
    }
    return Math.abs(toOptionalNumber(right.market_value) ?? 0)
      - Math.abs(toOptionalNumber(left.market_value) ?? 0);
  });

  const strategyMap = new Map<string, StrategyPosition[]>();
  for (const row of orderedRows) {
    const family = strategyFamily(row);
    strategyMap.set(family, [...(strategyMap.get(family) ?? []), row]);
  }
  const strategyGroups = [...strategyMap.entries()];
  const latestSnapshot = sortByNewest(rows)[0]?.snapshot_at;
  const [collapsedStrategies, setCollapsedStrategies] = useState<Set<string>>(
    () => new Set(),
  );
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

  const csvFields: CsvField<StrategyPosition>[] = [
    csvField("Family", strategyFamily),
    csvField("Version", strategyVersionLabel),
    csvField("Strategy ID", (row) => row.strategy_name ?? "Unattributed"),
    csvField("Account", (row) => row.broker_account_id ?? "-"),
    csvField("Symbol", positionInstrumentLabel),
    csvField("Description", positionDescription),
    csvField("Type", (row) => row.sec_type ?? "-"),
    csvField("Currency", (row) => row.currency ?? ""),
    csvField("Quantity", (row) => toOptionalNumber(row.quantity)),
    csvField("Price", (row) => toOptionalNumber(row.mark_price)),
    csvField("Market Value", (row) => toOptionalNumber(row.market_value)),
    csvField("Cost Basis", (row) => toOptionalNumber(row.cost_basis)),
    csvField("P/L Day", (row) => toOptionalNumber(row.day_change)),
    csvField("P/L", (row) => toOptionalNumber(row.unrealized_pnl)),
    csvField("P/L %", (row) => toOptionalNumber(row.gain_loss_percent)),
    csvField("Expiration", (row) => row.expiry_date ?? ""),
    csvField("As Of", (row) => formatTimestamp(row.snapshot_at, timezone)),
    csvField("Position Source", (row) => row.source ?? "LEDGER"),
  ];

  return (
    <Panel
      title="Current Holdings by Strategy Family"
      helpText="Current contracts and aggregate quantities are verified against IBKR. Holdings are grouped by family, while each row keeps its version and original strategy ID so positions from different variants are never netted together."
    >

      {!datasetAvailable(metadata) ? (
        <DatasetUnavailableMessage label="Positions" metadata={metadata} />
      ) : rows.length === 0 ? (
        <EmptyPanel>No current broker positions exist for this family/account.</EmptyPanel>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded-md border border-white/[0.08] bg-white/[0.05] px-4 py-3 shadow-[0_12px_30px_rgba(0,5,18,0.16)] md:flex-row md:items-center md:justify-between">
            <div>
              <div className="font-mono text-[11px] uppercase text-[var(--muted-strong)]">
                {rows.length} current positions across {strategyGroups.length} families
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
              <CsvDownloadButton
                fileName="current-holdings-by-family.csv"
                fields={csvFields}
                rows={orderedRows}
              />
            </div>
          </div>

          {strategyGroups.map(([strategyName, strategyRows]) => {
            const currencies = [
              ...new Set(
                strategyRows.map((row) => row.currency?.trim().toUpperCase() || "UNKNOWN"),
              ),
            ];
            const groupCurrency =
              currencies.length === 1 && currencies[0] !== "UNKNOWN"
                ? currencies[0]
                : undefined;
            const currencySummary =
              currencies.length > 1 ? "Mixed currencies" : "Currency unknown";
            const marketValue = sumPositionValues(strategyRows, (row) => row.market_value);
            const dayChange = sumPositionValues(strategyRows, (row) => row.day_change);
            const costBasis = sumPositionValues(strategyRows, (row) => row.cost_basis);
            const gainLoss = sumPositionValues(strategyRows, (row) => row.unrealized_pnl);
            const positionMetric = (
              label: string,
              summary: ReturnType<typeof sumPositionValues>,
              withTone = false,
            ) => ({
              label,
              value: groupCurrency
                ? formatPositionCurrency(summary.total, groupCurrency)
                : currencySummary,
              complete: summary.complete,
              tone: withTone ? positionValueClass(summary.total) : "",
            });
            const positionMetrics = [
              positionMetric("Market value", marketValue),
              positionMetric("Day change", dayChange, true),
              positionMetric("Cost basis", costBasis),
              positionMetric("Unrealized P/L", gainLoss, true),
            ];
            const accounts = [...new Set(strategyRows.map((row) => row.broker_account_id).filter(Boolean))];
            const variants = [
              ...new Map(
                strategyRows.map((row) => {
                  const identity = strategyIdentity(row);
                  return [identity.strategyName, identity] as const;
                }),
              ).values(),
            ];
            const reconciledCount = strategyRows.filter(
              (row) => row.source === "BROKER_RECONCILED",
            ).length;
            const isCollapsed = collapsedStrategies.has(strategyName);
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
                          {variants.map((variant) => (
                            <span
                              key={variant.strategyName}
                              title={variant.strategyName}
                              className="rounded-full bg-violet-400/15 px-2.5 py-1 font-mono text-[10px] uppercase text-violet-200"
                            >
                              {variant.version ?? "N/A"}
                            </span>
                          ))}
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
                          {variants.length} {variants.length === 1 ? "variant" : "variants"} · Account {accounts.join(", ") || "—"} · {isCollapsed ? "Show holdings" : "Hide holdings"}
                        </span>
                      </span>
                    </button>

                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:min-w-[620px]">
                      {positionMetrics.map((metric) => (
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
                          {!groupCurrency ? (
                            <div className="mt-0.5 text-[9px] uppercase text-amber-200">
                              Totals are not combined
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
                      <div
                        role="region"
                        tabIndex={0}
                        aria-label={`${strategyName} ${assetGroup.label} positions table. Scroll horizontally and vertically to view more holdings.`}
                        className="max-h-[620px] overflow-auto overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300/60"
                      >
                        <DataTable
                          key={`${strategyName}-${assetKey}-${assetGroup.rows.length}`}
                          rows={assetGroup.rows}
                          columns={positionTableColumns}
                          minWidth="1160px"
                        />
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

function EquitySummaryCard({
  label,
  value,
  detail,
  valueClassName = "text-[var(--foreground)]",
  detailClassName = "text-[var(--muted)]",
  className = "",
}: {
  label: string;
  value: ReactNode;
  detail: ReactNode;
  valueClassName?: string;
  detailClassName?: string;
  className?: string;
}) {
  return (
    <div
      className={[
        "rounded-md bg-[linear-gradient(180deg,rgba(255,255,255,0.095),rgba(255,255,255,0.055))] px-4 py-3 shadow-[0_14px_32px_var(--shadow)]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
        {label}
      </div>
      <div className={`mt-1 font-mono text-2xl font-semibold ${valueClassName}`}>
        {value}
      </div>
      <div className={`mt-1 text-xs ${detailClassName}`}>{detail}</div>
    </div>
  );
}

function AccountEquityPanel({
  rows,
  timezone,
  metadata,
}: {
  rows: AccountEquity[];
  timezone: string;
  metadata: DatasetMetadata;
}) {
  const chronologicalRows = aggregateEquityHistory(rows);
  if (
    !datasetAvailable(metadata) ||
    (chronologicalRows.length === 0 && !metadata.complete)
  ) {
    return (
      <Panel title="Account-wide Equity History">
        <DatasetUnavailableMessage label="Account equity" metadata={metadata} />
      </Panel>
    );
  }
  if (chronologicalRows.length === 0) {
    return (
      <Panel title="Account-wide Equity History">
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
  const latestPositionsValue = toOptionalNumber(
    latest?.gross_position_value,
  );
  const latestCashValue = toOptionalNumber(latest?.cash_value);
  const periodChange = dailyRows.length > 1 ? latestEquity - firstEquity : null;
  const periodChangePercent =
    periodChange === null || firstEquity === 0
      ? null
      : (periodChange / Math.abs(firstEquity)) * 100;
  const accountCount = new Set(
    rows.map((row) => row.broker_account_id).filter(Boolean),
  ).size;
  const historyComplete = metadata.complete && !metadata.truncated;
  const latestSnapshotDetail = [
    accountCount,
    accountCount === 1 ? "account" : "accounts",
    "· Updated",
    equitySnapshotTime(latest?.timestamp, timezone),
  ].join(" ");

  const columns: DashboardColumn<EquityHistoryRow>[] = [
    valueColumn<EquityHistoryRow>(
      "date",
      "Date",
      (row) => row.timestamp ?? row.date,
      {
        width: "20%",
        sortable: true,
        render: (_, row) => (
          <div>
            <div className="font-medium text-[var(--foreground)]">
              {formatDate(row.date)}
            </div>
            <div className="mt-0.5 text-[11px] text-[var(--muted)]">
              Updated {equitySnapshotTime(row.timestamp, timezone)}
            </div>
          </div>
        ),
        csvValue: (_, row) => formatDate(row.date),
      },
    ),
    valueColumn<EquityHistoryRow>(
      "account",
      "Account",
      (row) => row.broker_account_id,
      {
        width: "20%",
        render: (_, row) => (
          <span className="inline-flex rounded-full border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 font-mono text-[10px] uppercase text-[var(--muted-strong)]">
            {row.broker_account_id === "ALL"
              ? "Portfolio"
              : (row.broker_account_id ?? "—")}
          </span>
        ),
      },
    ),
    valueColumn<EquityHistoryRow>("equity", "Net Liquid", (row) => row.equity_value, {
      width: "20%",
      render: (value) => (
        <span className="font-mono font-semibold">
          {formatCurrency(toNumber(value))}
        </span>
      ),
    }),
    valueColumn<EquityHistoryRow>("dayChange", "Daily Change", (row) => row.dayChange, {
      width: "20%",
      align: "right",
      render: (value) =>
        value === null ? (
          <span className="text-[var(--muted)]">—</span>
        ) : (
          <span className={"font-mono font-medium " + positionValueClass(value)}>
            {formatSignedCurrency(toNumber(value))}
          </span>
        ),
    }),
    valueColumn<EquityHistoryRow>("dayChangePercent", "Change %", (row) => row.dayChangePercent, {
      width: "20%",
      align: "right",
      render: (value) =>
        value === null ? (
          <span className="text-[var(--muted)]">—</span>
        ) : (

          <span className={"font-mono font-medium " + positionValueClass(value)}>
            {formatSignedPercent(toNumber(value))}
          </span>
        ),
    }),
  ];
  const csvFields = [
    ...columns,
    csvField<EquityHistoryRow>("Updated", (row) =>
      formatTimestamp(row.timestamp, timezone),
    ),
  ];

  return (
    <Panel
      title="Account-wide Equity History"
      helpText="Account values are broker-account data and are not narrowed by the strategy family or version filters."
    >
      <div className="grid gap-3 md:grid-cols-6">
        <EquitySummaryCard
          className="md:col-span-2"
          label="Latest Net Liquid"
          value={historyComplete ? formatCurrency(latestEquity) : "Unavailable"}
          detail={
            historyComplete
              ? latestSnapshotDetail
              : "Latest close is not guaranteed because the history is incomplete"
          }
        />
        <EquitySummaryCard
          className="md:col-span-2"
          label="Positions Value"
          value={
            historyComplete && latestPositionsValue !== null
              ? formatCurrency(latestPositionsValue)
              : "Unavailable"
          }
          detail={
            !historyComplete
              ? "Latest close is not guaranteed because the history is incomplete"
              : latestPositionsValue === null
                ? "Unavailable in the latest account snapshot"
                : latestSnapshotDetail
          }
        />
        <EquitySummaryCard
          className="md:col-span-2"
          label="Cash"
          value={
            historyComplete && latestCashValue !== null
              ? formatCurrency(latestCashValue)
              : "Unavailable"
          }
          detail={
            !historyComplete
              ? "Latest close is not guaranteed because the history is incomplete"
              : latestCashValue === null
                ? "Unavailable in the latest account snapshot"
                : latestSnapshotDetail
          }
        />
        <EquitySummaryCard
          className="md:col-span-3"
          label="Change in Range"
          value={
            !historyComplete
              ? "Unavailable"
              : periodChange === null
                ? "—"
                : formatSignedCurrency(periodChange)
          }
          valueClassName={positionValueClass(
            historyComplete ? periodChange : null,
          )}
          detail={
            !historyComplete
              ? "Selected range is incomplete"
              : periodChangePercent === null
                ? "No earlier daily close"
                : formatSignedPercent(periodChangePercent)
          }
          detailClassName={positionValueClass(
            historyComplete ? periodChangePercent : null,
          )}
        />
        <EquitySummaryCard
          className="md:col-span-3"
          label="Daily Closes"
          value={
            <>
              {dailyRows.length}
              {historyComplete ? "" : "+"}
            </>
          }
          detail={
            historyComplete
              ? "Trading dates in selected range"
              : "Fetched trading dates; range is incomplete"
          }
        />
      </div>

      <div className={surfaceClass}>
        <div className="mb-2 text-sm font-semibold text-[var(--foreground)]">
          Account-wide equity history
        </div>
        <EquityChart rows={rows} />
      </div>

      <div className="flex justify-end">
        <CsvDownloadButton
          fileName="equity-history.csv"
          fields={csvFields}
          rows={orderedRows}
          className={`${secondaryButtonClass} w-full md:w-auto`}
        />
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
  metadata,
}: {
  rows: TradeExecution[];
  timezone: string;
  metadata: DatasetMetadata;
}) {
  if (!datasetAvailable(metadata)) {
    return (
      <Panel title="Raw Trade Executions">
        <DatasetUnavailableMessage label="Trade executions" metadata={metadata} />
      </Panel>
    );
  }

  const dashCell = { missing: "-", csvMissing: "-" };
  const columns: DashboardColumn<TradeExecution>[] = [
    valueColumn<TradeExecution>("timestamp", "Date", (row) => row.timestamp, {
      width: "205px",
      sticky: "left",
      sortable: true,
      render: (_, row) => formatTimestamp(row.timestamp, timezone),
      csvValue: (_, row) => formatTimestamp(row.timestamp, timezone),
    }),
    ...strategyColumns<TradeExecution>("205px", "-", "-"),
    valueColumn<TradeExecution>("account", "Account ID", (row) => row.broker_account_id, dashCell),
    ...TRADE_LOG_INSTRUMENT_COLUMNS.map(({ key, label, read }) =>
      valueColumn<TradeExecution>(key, label, read, dashCell),
    ),
    valueColumn<TradeExecution>("side", "Side", (row) => row.side, dashCell),
    valueColumn<TradeExecution>("qty", "Qty", (row) => row.quantity, {
      align: "right",
      render: (value) => formatNumber(value, 0),
      csvValue: (value) => toOptionalNumber(value) ?? "",
    }),
    valueColumn<TradeExecution>("price", "Price", (row) => row.price, {
      align: "right",
      render: (value) => formatNumber(value),
      csvValue: (value) => toOptionalNumber(value) ?? "",
    }),
    valueColumn<TradeExecution>("commission", "Commission", (row) => row.commission, {
      align: "right",
      render: (value) => commissionTableValue(value),
    }),
    valueColumn<TradeExecution>("pnl", "Trade P&L", (row) => row.realized_pnl, {
      align: "right",
      render: (value) => pnlTableValue(value),
    }),
    valueColumn<TradeExecution>("status", "Status", (row) => row.status, dashCell),
    valueColumn<TradeExecution>("notes", "Notes", (row) => row.notes, {
      missing: "",
      wrap: true,
    }),
  ];
  const sortedRows = sortByNewest(rows);

  return (
    <Panel title="Raw Trade Executions">
      <div className="flex flex-col gap-3 rounded-md bg-white/[0.05] px-3 py-3 shadow-[0_12px_30px_rgba(0,5,18,0.16)] backdrop-blur xl:flex-row xl:items-center xl:justify-between">
        <div className="font-mono text-[11px] uppercase tracking-normal text-[var(--muted-strong)]">
          {rows.length} records loaded
        </div>
        <CsvDownloadButton
          fileName="trade-logs.csv"
          fields={columns}
          rows={sortedRows}
          disabled={rows.length === 0}
        />
      </div>

      {rows.length === 0 ? (
        <EmptyPanel>No trades found for the selected time range.</EmptyPanel>
      ) : (
        <DataTable
          key={`trades-${rows.length}-${sortedRows[0]?.timestamp ?? "empty"}`}
          rows={sortedRows}
          columns={columns}
          minWidth="2500px"
          pagination={{ enabled: true, pageSize: 25 }}
        />
      )}
    </Panel>
  );
}

function DiagnosticsPanel({
  strategyFamilyFilter,
  strategyVersion,
  accountId,
  startDate,
  endDate,
  timezone,
  data,
  health,
}: {
  strategyFamilyFilter: string;
  strategyVersion: string;
  accountId: string;
  startDate: string;
  endDate: string;
  timezone: string;
  data: DashboardData;
  health: HealthState;
}) {
  const datasetRows = Object.entries(data.meta.datasets).map(
    ([name, metadata]) => [
      `${datasetLabels[name as keyof typeof datasetLabels]} dataset`,
      datasetMetadataSummary(metadata),
    ],
  );
  const rows = [
    ["Strategy family filter", strategyFamilyFilter],
    ["Strategy version filter", strategyVersion],
    ["Account filter", accountId],
    ["Date range", `${startDate} to ${endDate}`],
    ["Timezone", timezone],
    ["Backend health", health.status],
    ["Health checked", formatTimestamp(health.checkedAt ?? undefined, timezone)],
    ["Query requested", formatTimestamp(data.meta.requestedAt, timezone)],
    ["Query completed", formatTimestamp(data.meta.completedAt, timezone)],
    ["Query result", data.meta.partial ? "Partial" : "Complete"],
    ["Execution records", String(data.execRows.length)],
    ["Account equity records", String(data.perfRows.length)],
    ["Strategy daily P&L records", String(data.pnlRows.length)],
    ["Strategy position snapshots", String(data.positionRows.length)],
    ...datasetRows,
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
  const initialToday = todayInTimeZone("America/New_York");
  const [filters, setFilters] = useState<FilterOptions>(emptyFilters);
  const [selectedFamilies, setSelectedFamilies] = useState<string[]>(["ALL"]);
  const [selectedVersions, setSelectedVersions] = useState<string[]>(["ALL"]);
  const [accountId, setAccountId] = useState("ALL");
  const [datePreset, setDatePreset] = useState<DatePreset>("Today");
  const [timezone, setTimezone] = useState("America/New_York");
  const [customStart, setCustomStart] = useState(initialToday);
  const [customEnd, setCustomEnd] = useState(initialToday);
  const [, setCalendarDay] = useState(initialToday);
  const [section, setSection] = useState<SectionId>("overview");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loadedQueryKey, setLoadedQueryKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncResult, setLastSyncResult] =
    useState<ReconciliationSyncResult | null>(null);
  const [health, setHealth] = useState<HealthState>({
    status: "checking",
    checkedAt: null,
    error: null,
  });
  const [healthRefreshKey, setHealthRefreshKey] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const dataRequestId = useRef(0);
  const filterRequestId = useRef(0);
  const selectionsRef = useRef({ selectedFamilies, selectedVersions, accountId });

  const range = resolveDateRange(
    datePreset,
    timezone,
    customStart,
    customEnd,
  );
  const strategyScopes = useMemo<StrategyScope[]>(() => {
    if (selectedFamilies.includes("ALL")) {
      return [{ strategyFamily: "ALL", strategyVersion: "ALL" }];
    }
    return selectedFamilies.flatMap((family) => {
      if (selectedVersions.includes("ALL")) {
        return [{ strategyFamily: family, strategyVersion: "ALL" }];
      }
      const option = filters.strategy_families.find((item) => item.family === family);
      const availableVersions = new Set(
        option?.versions.map((item) => item.version).filter((item): item is string => Boolean(item)) ?? [],
      );
      return selectedVersions
        .filter((version) => availableVersions.has(version))
        .map((version) => ({ strategyFamily: family, strategyVersion: version }));
    });
  }, [filters.strategy_families, selectedFamilies, selectedVersions]);
  const querySnapshot = useMemo(
    () => ({
      strategyFamilies: selectedFamilies,
      strategyVersions: selectedVersions,
      strategyScopes,
      accountId,
      startDate: range.startDate,
      endDate: range.endDate,
      timezone,
      section,
      ...includesForSection(section),
    }),
    [
      accountId,
      range.endDate,
      range.startDate,
      section,
      selectedFamilies,
      selectedVersions,
      strategyScopes,
      timezone,
    ],
  );
  const queryKey = useMemo(() => JSON.stringify(querySnapshot), [querySnapshot]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCalendarDay(todayInTimeZone(timezone));
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [timezone]);

  useEffect(() => {
    const mobileViewport = window.matchMedia("(max-width: 1023px)");
    let disposed = false;

    function collapsedForViewport(isMobile: boolean) {
      if (isMobile) {
        return true;
      }
      return (
        window.localStorage.getItem("quant-web:sidebar-collapsed") === "true"
      );
    }

    queueMicrotask(() => {
      if (!disposed) {
        setSidebarCollapsed(collapsedForViewport(mobileViewport.matches));
      }
    });
    function handleViewportChange(event: MediaQueryListEvent) {
      setSidebarCollapsed(collapsedForViewport(event.matches));
    }
    mobileViewport.addEventListener("change", handleViewportChange);
    return () => {
      disposed = true;
      mobileViewport.removeEventListener("change", handleViewportChange);
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const requestId = ++filterRequestId.current;
    fetch("/api/dashboard/filters", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => readApi<FilterOptions>(response))
      .then((payload) => {
        if (filterRequestId.current !== requestId) {
          return;
        }
        const current = selectionsRef.current;
        const validFamilies = new Set(payload.strategy_families.map((item) => item.family));
        let nextFamilies = current.selectedFamilies.includes("ALL")
          ? ["ALL"]
          : current.selectedFamilies.filter((family) => validFamilies.has(family));
        if (current.selectedFamilies.length > 0 && nextFamilies.length === 0) {
          nextFamilies = ["ALL"];
        }
        const validVersions = new Set(
          payload.strategy_families
            .filter((item) => nextFamilies.includes(item.family))
            .flatMap((item) => item.versions)
            .map((item) => item.version)
            .filter((item): item is string => Boolean(item)),
        );
        const nextVersions =
          nextFamilies.length === 0 || nextFamilies.includes("ALL") || current.selectedVersions.includes("ALL")
            ? ["ALL"]
            : current.selectedVersions.filter((version) => validVersions.has(version));
        const validAccounts = new Set(payload.accounts.map((account) => account.account_id));
        const reconciledVersions = nextVersions.length > 0 ? nextVersions : ["ALL"];
        const nextAccountId =
          current.accountId === "ALL" || validAccounts.has(current.accountId)
            ? current.accountId
            : "ALL";
        selectionsRef.current = {
          selectedFamilies: nextFamilies,
          selectedVersions: reconciledVersions,
          accountId: nextAccountId,
        };
        setFilters(payload);
        setSelectedFamilies((previous) =>
          sameSelection(previous, nextFamilies) ? previous : nextFamilies,
        );
        setSelectedVersions((previous) =>
          sameSelection(previous, reconciledVersions)
            ? previous
            : reconciledVersions,
        );
        setAccountId((previous) =>
          previous === nextAccountId ? previous : nextAccountId,
        );
        setFilterError(null);
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError" && filterRequestId.current === requestId) {
          setFilterError(error.message);
          setHealthRefreshKey((value) => value + 1);
        }
      });
    return () => {
      controller.abort();
      if (filterRequestId.current === requestId) {
        filterRequestId.current += 1;
      }
    };
  }, [refreshKey]);

  useEffect(() => {
    let disposed = false;
    let checking = false;
    let controller: AbortController | null = null;

    async function checkHealth() {
      if (checking) {
        return;
      }
      checking = true;
      controller = new AbortController();
      try {
        const response = await fetch("/api/health", {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json()) as ApiResponse<HealthPayload>;
        if (disposed) {
          return;
        }
        const online =
          response.ok &&
          payload.ok &&
          payload.data?.backend?.reachable === true &&
          payload.data.backend.protectedAccess === true;
        setHealth({
          status: online ? "online" : "offline",
          checkedAt: payload.data?.checkedAt ?? new Date().toISOString(),
          error: online ? null : payload.error?.message ?? "Backend unavailable",
        });
      } catch (error) {
        if (!disposed && (!(error instanceof Error) || error.name !== "AbortError")) {
          setHealth({
            status: "offline",
            checkedAt: new Date().toISOString(),
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        checking = false;
      }
    }

    void checkHealth();
    const timer = window.setInterval(checkHealth, 30_000);
    return () => {
      disposed = true;
      controller?.abort();
      window.clearInterval(timer);
    };
  }, [healthRefreshKey]);

  useEffect(() => {
    const controller = new AbortController();
    const requestId = ++dataRequestId.current;

    queueMicrotask(async () => {
      if (controller.signal.aborted || dataRequestId.current !== requestId) {
        return;
      }
      setLoading(true);
      setDataError(null);

      try {
        const response = await fetch("/api/dashboard/data", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: queryKey,
        });
        const payload = await readApi<DashboardData>(response);
        if (dataRequestId.current === requestId) {
          setData(payload);
          setDataError(null);
          setLoadedQueryKey(queryKey);
        }
      } catch (error) {
        if (
          (!(error instanceof Error) || error.name !== "AbortError") &&
          dataRequestId.current === requestId
        ) {
          setLoadedQueryKey(null);
          setDataError(error instanceof Error ? error.message : String(error));
          setHealthRefreshKey((value) => value + 1);
        }
      } finally {
        if (dataRequestId.current === requestId) {
          setLoading(false);
        }
      }
    });

    return () => {
      controller.abort();
      if (dataRequestId.current === requestId) {
        dataRequestId.current += 1;
      }
    };
  }, [queryKey, refreshKey]);

  function handleStrategyFamiliesChange(values: string[]) {
    selectionsRef.current = {
      ...selectionsRef.current,
      selectedFamilies: values,
      selectedVersions: ["ALL"],
    };
    setSelectedFamilies(values);
    setSelectedVersions(["ALL"]);
  }

  function handleStrategyVersionsChange(values: string[]) {
    selectionsRef.current = {
      ...selectionsRef.current,
      selectedVersions: values,
    };
    setSelectedVersions(values);
  }

  function handleAccountChange(value: string) {
    selectionsRef.current = {
      ...selectionsRef.current,
      accountId: value,
    };
    setAccountId(value);
  }

  function handleReload() {
    setLoadedQueryKey(null);
    setRefreshKey((value) => value + 1);
  }

  async function handleRefresh() {
    setSyncing(true);
    setSyncError(null);

    try {
      const response = await fetch("/api/dashboard/sync", {
        method: "POST",
        cache: "no-store",
      });
      const result = await readApi<ReconciliationSyncResult>(response);
      setLastSyncResult(result);
      setLoadedQueryKey(null);
      setRefreshKey((value) => value + 1);
      setHealthRefreshKey((value) => value + 1);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : String(error));
    } finally {
      setSyncing(false);
    }
  }

  function handleToggleSidebar() {
    setSidebarCollapsed((value) => {
      const nextValue = !value;
      if (!window.matchMedia("(max-width: 1023px)").matches) {
        window.localStorage.setItem(
          "quant-web:sidebar-collapsed",
          String(nextValue),
        );
      }
      return nextValue;
    });
  }

  const familyLabel = selectionLabel(selectedFamilies, "ALL");
  const versionLabel = selectionLabel(selectedVersions, "ALL VERSIONS");
  const currentData = loadedQueryKey === queryKey ? data : null;

  const currentPanel = currentData ? (() => {
    if (section === "overview") {
      return (
        <OverviewPanel
          strategyScope={
            selectedVersions.includes("ALL")
              ? familyLabel
              : `${familyLabel} / ${versionLabel}`
          }
          accountId={accountId}
          data={currentData}
        />
      );
    }
    if (section === "strategy-pnl") {
      return (
        <StrategyPnlPanel
          rows={currentData.pnlRows}
          metadata={currentData.meta.datasets.pnl}
        />
      );
    }
    if (section === "account-equity") {
      return (
        <AccountEquityPanel
          rows={currentData.perfRows}
          timezone={timezone}
          metadata={currentData.meta.datasets.equity}
        />
      );
    }
    if (section === "positions") {
      return (
        <StrategyPositionsPanel
          rows={currentData.positionRows}
          timezone={timezone}
          metadata={currentData.meta.datasets.positions}
        />
      );
    }
    if (section === "trade-logs") {
      return (
        <TradeLogsPanel
          rows={currentData.execRows}
          timezone={timezone}
          metadata={currentData.meta.datasets.executions}
        />
      );
    }
    return (
      <DiagnosticsPanel
        strategyFamilyFilter={familyLabel}
        strategyVersion={versionLabel}
        accountId={accountId}
        startDate={range.startDate}
        endDate={range.endDate}
        timezone={timezone}
        data={currentData}
        health={health}
      />
    );
  })() : null;
  const queryStatus = dataError
    ? "failed"
    : loading
      ? "loading"
      : currentData
        ? currentData.meta.partial
          ? "partial"
          : "current"
        : "pending";
  const syncStatus = syncing
    ? "running"
    : syncError
      ? "failed"
      : lastSyncResult?.status === "completed_with_warnings"
        ? "warning"
        : lastSyncResult
          ? "complete"
          : "not run";
  const operationalStatuses = [
    { label: "Query", status: queryStatus, icon: RadioTower },
    { label: "Reconciliation", status: syncStatus, icon: ShieldCheck },
  ] as const;

  return (
    <div className="relative min-h-screen text-[var(--foreground)] lg:flex">
      <SidebarFilters
        collapsed={sidebarCollapsed}
        apiStatus={health.status}
        filters={filters}
        strategyFamilies={selectedFamilies}
        strategyVersions={selectedVersions}
        accountId={accountId}
        datePreset={datePreset}
        timezone={timezone}
        customStart={customStart}
        customEnd={customEnd}
        onStrategyFamiliesChange={handleStrategyFamiliesChange}
        onStrategyVersionsChange={handleStrategyVersionsChange}
        onAccountChange={handleAccountChange}
        onPresetChange={setDatePreset}
        onTimezoneChange={setTimezone}
        onCustomStartChange={setCustomStart}
        onCustomEndChange={setCustomEnd}
        onToggleCollapsed={handleToggleSidebar}
      />

      <main className="min-w-0 flex-1 p-5 md:p-8 xl:p-10">
        <div className="mb-8 space-y-6 pt-1">
          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
            <div className="min-w-0 space-y-4 pr-14 md:pr-0">
              <div className="flex flex-wrap gap-3 font-mono text-[10px] uppercase tracking-normal text-[var(--muted)]">
                <span
                  role="status"
                  title={health.error ?? undefined}
                  className={`${statusPillClass} ${
                    health.status === "online"
                      ? "border-[#9cf62f]/20 bg-[rgba(156,246,47,0.1)] text-[#b8ff5d]"
                      : health.status === "offline"
                        ? "border-rose-300/20 bg-rose-400/[0.1] text-rose-200"
                        : "border-amber-300/20 bg-amber-400/[0.1] text-amber-200"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`inline-block h-2 w-2 rounded-full ${
                      health.status === "online"
                        ? "bg-[#9cf62f] shadow-[0_0_0_4px_rgba(156,246,47,0.12),0_0_18px_rgba(156,246,47,0.34)]"
                        : health.status === "offline"
                          ? "bg-rose-400 shadow-[0_0_0_4px_rgba(251,113,133,0.12)]"
                          : "bg-amber-300 shadow-[0_0_0_4px_rgba(252,211,77,0.12)]"
                    }`}
                  />
                  Backend {health.status}
                </span>
                {operationalStatuses.map(({ label, status, icon }) => {
                  const visual = operationalStatusVisuals[status];
                  return (
                    <span
                      key={label}
                      role="status"
                      className={`${statusPillClass} ${visual.className}`}
                    >
                      <SignalIcon
                        icon={icon}
                        tone={visual.tone}
                        className="h-5 w-5"
                        iconClassName="h-3 w-3"
                      />
                      {label} {status}
                    </span>
                  );
                })}
              </div>
              <h1 className="text-3xl font-semibold text-[var(--foreground)] md:text-4xl">
                Quant Alpha Dashboard
              </h1>
              <div className="flex flex-wrap gap-3 text-xs text-[var(--muted)]">
                <span className={`${metaPillClass} border-[rgba(45,212,191,0.18)] bg-[rgba(45,212,191,0.09)] text-[var(--accent-strong)]`}>
                  {familyLabel}
                </span>
                {!selectedFamilies.includes("ALL") ? (
                  <span className={`${metaPillClass} border-[rgba(192,132,252,0.18)] bg-[rgba(192,132,252,0.08)] text-[#ddd6fe]`}>
                    {versionLabel}
                  </span>
                ) : null}
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
              <div className="flex w-full flex-col gap-2 sm:flex-row md:w-auto">
                <button
                  type="button"
                  title="Reload the current query without running reconciliation"
                  disabled={loading || syncing}
                  onClick={handleReload}
                  className={`${secondaryButtonClass} w-full whitespace-nowrap sm:w-auto`}
                >
                  <RefreshCw className={`h-4 w-4 ${loading && !syncing ? "animate-spin" : ""}`} aria-hidden="true" />
                  {loading && !syncing ? "Reloading..." : dataError ? "Retry data" : "Reload data"}
                </button>
              <button
                type="button"
                title="Run broker reconciliation, then reload dashboard data"
                disabled={loading || syncing}
                onClick={handleRefresh}
                className={`${primaryButtonClass} w-full max-w-none shrink-0 self-start whitespace-nowrap sm:w-auto md:max-w-max md:self-end`}
              >
                <SignalIcon
                  icon={RefreshCw}
                  tone="mint"
                  className="h-6 w-6"
                  iconClassName={`h-3.5 w-3.5 ${loading || syncing ? "animate-spin" : ""}`}
                />
                {syncing ? "Reconciling..." : "Reconcile & refresh"}
              </button>
              </div>
              <div className="w-full max-w-full rounded-md bg-white/[0.05] px-3 py-1.5 text-center font-mono text-[10px] uppercase leading-5 tracking-normal text-[var(--muted)] md:w-auto md:text-right">
                <div>
                  Query completed: {formatTimestamp(currentData?.meta.completedAt, timezone)}
                </div>
                <div>
                  Reconciliation: {lastSyncResult ? formatTimestamp(lastSyncResult.completed_at, timezone) : "Not run this session"}
                </div>
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
              Dashboard data unavailable: {dataError}. Use Retry data to try this query again.
            </StatusMessage>
          ) : null}
          {syncError ? (
            <StatusMessage tone="error">
              Trading data sync failed: {syncError}
            </StatusMessage>
          ) : null}
          {!syncing &&
          !syncError &&
          lastSyncResult?.status === "completed_with_warnings" ? (
            <StatusMessage tone="info">
              Reconciliation completed with warnings: {lastSyncResult.warnings.length
                ? lastSyncResult.warnings.join(" ")
                : "one or more phases reported a warning."}
            </StatusMessage>
          ) : null}
          {syncing ? (
            <StatusMessage tone="loading">Reconciling trading data with IBKR...</StatusMessage>
          ) : loading ? (
            <StatusMessage tone="loading">Loading dashboard data...</StatusMessage>
          ) : null}
          {currentData ? <DataQualityNotice data={currentData} /> : null}
          {!loading && !dataError && !currentData ? (
            <StatusMessage tone="loading">Preparing the dashboard query...</StatusMessage>
          ) : null}
          {!loading && !dataError ? currentPanel : null}
        </div>
      </main>
    </div>
  );
}
