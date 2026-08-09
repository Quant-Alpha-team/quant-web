"use client";

import { useId } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TooltipContentProps } from "recharts";
import {
  CHART_COLORS,
  aggregateEquityHistory,
  downsample,
  formatCurrency,
  formatDate,
  strategyFamily,
  toNumber,
} from "@/lib/dashboard";
import type { AccountEquity, StrategyDailyPnl } from "@/lib/types";

const axisStyle = {
  fill: "#91a9b8",
  fontSize: 12,
};

const gridStroke = "rgba(145, 169, 184, 0.16)";
const tooltipStyle = {
  background: "rgba(8, 24, 42, 0.94)",
  border: "0",
  borderRadius: 6,
  boxShadow: "0 18px 42px rgba(0, 5, 18, 0.34)",
  color: "#f4fbff",
};

const minimumVisiblePnl = 0.005;

function ChartFrame({ children }: { children: React.ReactElement }) {
  return (
    <div
      aria-hidden="true"
      className="h-[300px] min-h-[300px] min-w-0 w-full sm:h-[360px] sm:min-h-[360px]"
    >
      <ResponsiveContainer
        debounce={50}
        height="100%"
        initialDimension={{ width: 640, height: 360 }}
        minHeight={300}
        minWidth={0}
        width="100%"
      >
        {children}
      </ResponsiveContainer>
    </div>
  );
}

function ChartEmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="status"
      className="flex min-h-24 items-center justify-center rounded-md border border-dashed border-white/[0.1] px-4 text-center text-sm text-[var(--muted)]"
    >
      {children}
    </div>
  );
}

function currencyTickFormatter(value: unknown) {
  return "$" + Number(value).toLocaleString();
}

function chronologicalLabel(
  left: Record<string, string | number>,
  right: Record<string, string | number>,
) {
  const leftLabel = String(left.date ?? left.label ?? "");
  const rightLabel = String(right.date ?? right.label ?? "");
  const leftTime = Date.parse(leftLabel);
  const rightTime = Date.parse(rightLabel);

  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
    return leftTime - rightTime;
  }
  if (Number.isFinite(leftTime) !== Number.isFinite(rightTime)) {
    return Number.isFinite(leftTime) ? -1 : 1;
  }
  return leftLabel.localeCompare(rightLabel, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function PnlTooltip({
  active,
  label,
  payload,
}: TooltipContentProps) {
  const items = payload.filter(
    (item) =>
      item.value !== undefined &&
      Number.isFinite(Number(item.value)) &&
      Math.abs(Number(item.value)) >= minimumVisiblePnl,
  );

  if (!active || items.length === 0) {
    return null;
  }

  return (
    <div className="min-w-56 rounded-lg border border-white/[0.08] bg-[#08182a]/95 px-4 py-3 shadow-2xl backdrop-blur-sm">
      <div className="mb-2 text-sm font-medium text-[#9bb3c3]">{label}</div>
      <div className="space-y-1.5">
        {items.map((item) => {
          const value = Number(item.value);
          const color = value < 0 ? CHART_COLORS.loss : CHART_COLORS.profit;
          const name = String(item.name ?? item.dataKey ?? "Strategy");
          return (
            <div
              className="flex items-center justify-between gap-5 font-mono text-sm"
              key={`${name}-${value}`}
            >
              <span className="flex min-w-0 items-center gap-2 text-[#d6e7ef]">
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className="truncate">{name}</span>
              </span>
              <span className="shrink-0 font-semibold" style={{ color }}>
                {formatCurrency(value)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function centeredYAxisDomain(values: number[]): [number, number] {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (finiteValues.length === 0) {
    return [0, 1];
  }

  const dataMin = Math.min(...finiteValues);
  const dataMax = Math.max(...finiteValues);
  const span = dataMax - dataMin;
  const base = Math.max(Math.abs(dataMax), Math.abs(dataMin), 1);
  const padding = span > 0 ? span * 0.12 : base * 0.005;

  let lower = dataMin - padding;
  const upper = dataMax + padding;

  if (dataMin >= 0 && lower < 0) {
    lower = 0;
  }

  const niceUnit = Math.max(
    1,
    10 ** Math.max(0, Math.floor(Math.log10(Math.max(Math.abs(lower), Math.abs(upper), 1))) - 2),
  );
  const niceLower = Math.floor(lower / niceUnit) * niceUnit;
  const niceUpper = Math.ceil(upper / niceUnit) * niceUnit;

  if (niceLower === niceUpper) {
    return [niceLower - 1, niceUpper + 1];
  }
  return [niceLower, niceUpper];
}

export function EquityChart({ rows }: { rows: AccountEquity[] }) {
  const titleId = useId();
  const summaryId = useId();
  const series = aggregateEquityHistory(rows).map((row) => ({
    label: formatDate(row.date),
    equity: toNumber(row.equity_value),
  }));
  const data = downsample(series, 3000);
  const yDomain = centeredYAxisDomain(data.map((item) => item.equity));
  const firstPoint = series[0];
  const lastPoint = series.at(-1);

  if (!firstPoint || !lastPoint) {
    return (
      <ChartEmptyState>
        No valid equity points are available in the selected range.
      </ChartEmptyState>
    );
  }

  const equityValues = series.map((item) => item.equity);
  const summary =
    `Equity history from ${firstPoint.label} to ${lastPoint.label} across ${series.length} daily closes. It began at ${formatCurrency(firstPoint.equity)}, ended at ${formatCurrency(lastPoint.equity)}, reached a low of ${formatCurrency(Math.min(...equityValues))}, and a high of ${formatCurrency(Math.max(...equityValues))}.` +
    (data.length < series.length
      ? ` The visual chart is sampled to ${data.length} points.`
      : "");

  return (
    <figure
      role="img"
      aria-labelledby={titleId}
      aria-describedby={summaryId}
      className="min-w-0 space-y-2"
    >
      <figcaption className="sr-only">
        <span id={titleId}>Equity history chart.</span>{" "}
        <span id={summaryId}>{summary}</span>
      </figcaption>
      <div
        aria-hidden="true"
        className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-[var(--muted-strong)]"
      >
        <span className="inline-flex items-center gap-2">
          <span className="size-2 rounded-full bg-[#34d399]" />
          Equity
        </span>
        <span>
          {series.length} daily {series.length === 1 ? "close" : "closes"}
        </span>
      </div>
      <ChartFrame>
        <LineChart
          data={data}
          margin={{ left: 8, right: 20, top: 20, bottom: 8 }}
        >
          <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={axisStyle} minTickGap={42} />
          <YAxis
            tick={axisStyle}
            tickFormatter={currencyTickFormatter}
            domain={yDomain}
            tickCount={5}
            width={86}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(value) => [formatCurrency(Number(value)), "Equity"]}
            labelStyle={{ color: "#91a9b8" }}
          />
          <Line
            type="monotone"
            dataKey="equity"
            stroke={CHART_COLORS.profit}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ChartFrame>
    </figure>
  );
}

export function PnlBarChart({ rows }: { rows: StrategyDailyPnl[] }) {
  const titleId = useId();
  const summaryId = useId();
  const byDate = new Map<string, Record<string, string | number>>();

  for (const row of rows) {
    if (
      !row.date?.trim() ||
      row.daily_pnl === null ||
      row.daily_pnl === undefined
    ) {
      continue;
    }
    const pnl = toNumber(row.daily_pnl);
    const date = formatDate(row.date);
    const strategy = strategyFamily(row);
    const entry = byDate.get(date) ?? { date };
    entry[strategy] = toNumber(entry[strategy]) + pnl;
    byDate.set(date, entry);
  }

  const nonZeroData = [...byDate.values()]
    .map((entry) => {
      const cleaned: Record<string, string | number> = { date: entry.date };
      for (const [key, value] of Object.entries(entry)) {
        if (key !== "date" && Math.abs(toNumber(value)) >= minimumVisiblePnl) {
          cleaned[key] = value;
        }
      }
      return cleaned;
    })
    .filter((entry) => Object.keys(entry).length > 1)
    .sort(chronologicalLabel);
  const strategies = [
    ...new Set(
      nonZeroData.flatMap((entry) =>
        Object.keys(entry).filter((key) => key !== "date"),
      ),
    ),
  ].sort((left, right) =>
    left.localeCompare(right, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
  const data = downsample(nonZeroData, 3000);

  if (data.length === 0 || strategies.length === 0) {
    return (
      <ChartEmptyState>
        No non-zero daily P&amp;L in the selected range.
      </ChartEmptyState>
    );
  }

  const plottedValues = data.flatMap((entry) =>
    strategies
      .map((strategy) => toNumber(entry[strategy]))
      .filter((value) => Math.abs(value) >= minimumVisiblePnl),
  );
  const netPnl = plottedValues.reduce((total, value) => total + value, 0);
  const positiveObservations = plottedValues.filter((value) => value > 0).length;
  const negativeObservations = plottedValues.filter((value) => value < 0).length;
  const firstDate = String(data[0].date);
  const lastDate = String(data.at(-1)?.date);
  const summary =
    `Daily strategy P&L from ${firstDate} to ${lastDate} across ${data.length} plotted trading dates and ${strategies.length} strategy families. Net plotted P&L is ${formatCurrency(netPnl)}, with ${positiveObservations} positive and ${negativeObservations} negative observations. Green bars are positive and pink bars are negative.` +
    (data.length < nonZeroData.length
      ? ` The visual chart is sampled from ${nonZeroData.length} trading dates.`
      : "");

  return (
    <figure
      role="img"
      aria-labelledby={titleId}
      aria-describedby={summaryId}
      className="min-w-0 space-y-2"
    >
      <figcaption className="sr-only">
        <span id={titleId}>Daily strategy P&amp;L chart.</span>{" "}
        <span id={summaryId}>{summary}</span>
      </figcaption>
      <div
        aria-hidden="true"
        className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-[var(--muted-strong)]"
      >
        <span className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2">
            <span className="size-2 rounded-sm bg-[#34d399]" />
            Positive
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="size-2 rounded-sm bg-[#fb7185]" />
            Negative
          </span>
        </span>
        <span>
          {strategies.length}{" "}
          {strategies.length === 1 ? "strategy family" : "strategy families"}
          {" · "}
          <span
            className={
              netPnl < 0
                ? "text-[#fb7185]"
                : netPnl > 0
                  ? "text-[#34d399]"
                  : ""
            }
          >
            Net {formatCurrency(netPnl)}
          </span>
        </span>
      </div>
      <ChartFrame>
        <BarChart
          data={data}
          margin={{ left: 8, right: 20, top: 20, bottom: 8 }}
        >
          <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={axisStyle} minTickGap={30} />
          <YAxis
            tick={axisStyle}
            tickFormatter={currencyTickFormatter}
            width={86}
          />
          <Tooltip
            content={PnlTooltip}
            cursor={{ fill: "rgba(125, 211, 252, 0.055)" }}
          />
          {strategies.map((strategy) => (
            <Bar
              key={strategy}
              dataKey={strategy}
              fill={CHART_COLORS.profit}
              isAnimationActive={false}
            >
              {data.map((item, itemIndex) => (
                <Cell
                  key={strategy + "-" + itemIndex}
                  fill={
                    toNumber(item[strategy]) < 0
                      ? CHART_COLORS.loss
                      : CHART_COLORS.profit
                  }
                />
              ))}
            </Bar>
          ))}
        </BarChart>
      </ChartFrame>
    </figure>
  );
}
