"use client";

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

const chartFrameClass = "h-[360px] min-h-[360px] min-w-0 w-full";
const chartInitialDimension = { width: 640, height: 360 };
const minimumVisiblePnl = 0.005;

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
  const data = downsample(aggregateEquityHistory(rows), 3000).map((row) => ({
    label: formatDate(row.date),
    equity: toNumber(row.equity_value),
  }));
  const yDomain = centeredYAxisDomain(data.map((item) => item.equity));

  return (
    <div className={chartFrameClass}>
      <ResponsiveContainer
        debounce={50}
        height="100%"
        initialDimension={chartInitialDimension}
        minHeight={360}
        minWidth={0}
        width="100%"
      >
        <LineChart data={data} margin={{ left: 8, right: 20, top: 20, bottom: 8 }}>
          <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={axisStyle} minTickGap={42} />
          <YAxis
            tick={axisStyle}
            tickFormatter={(value) => `$${Number(value).toLocaleString()}`}
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
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PnlBarChart({ rows }: { rows: StrategyDailyPnl[] }) {
  const byDate = new Map<string, Record<string, string | number>>();

  for (const row of rows) {
    if (row.daily_pnl === null || row.daily_pnl === undefined) {
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
    .filter((entry) => Object.keys(entry).length > 1);
  const strategies = [
    ...new Set(
      nonZeroData.flatMap((entry) =>
        Object.keys(entry).filter((key) => key !== "date"),
      ),
    ),
  ];
  const data = downsample(nonZeroData, 3000);

  if (data.length === 0 || strategies.length === 0) {
    return (
      <div className="flex min-h-24 items-center justify-center rounded-md border border-dashed border-white/[0.1] px-4 text-center text-sm text-[var(--muted)]">
        No non-zero daily P&amp;L in the selected range.
      </div>
    );
  }

  return (
    <div className={chartFrameClass}>
      <ResponsiveContainer
        debounce={50}
        height="100%"
        initialDimension={chartInitialDimension}
        minHeight={360}
        minWidth={0}
        width="100%"
      >
        <BarChart data={data} margin={{ left: 8, right: 20, top: 20, bottom: 8 }}>
          <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={axisStyle} minTickGap={30} />
          <YAxis
            tick={axisStyle}
            tickFormatter={(value) => `$${Number(value).toLocaleString()}`}
            width={86}
          />
          <Tooltip
            content={PnlTooltip}
            cursor={{ fill: "rgba(125, 211, 252, 0.055)" }}
          />
          {strategies.map((strategy) => (
            <Bar key={strategy} dataKey={strategy} fill={CHART_COLORS.profit}>
              {data.map((item, itemIndex) => (
                <Cell
                  key={`${strategy}-${itemIndex}`}
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
      </ResponsiveContainer>
    </div>
  );
}
