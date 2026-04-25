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
import {
  CHART_COLORS,
  downsample,
  formatCurrency,
  formatDate,
  formatTimestamp,
  strategyColor,
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

function centeredYAxisDomain(values: number[]): [number, number] {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (finiteValues.length === 0) {
    return [0, 1];
  }

  const dataMin = Math.min(...finiteValues);
  const dataMax = Math.max(...finiteValues);
  const span = dataMax - dataMin;
  const base = Math.max(Math.abs(dataMax), Math.abs(dataMin), 1);
  const padding = span > 0 ? span * 0.55 : base * 0.06;

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

export function EquityChart({
  rows,
  timezone,
}: {
  rows: AccountEquity[];
  timezone: string;
}) {
  const data = downsample(rows, 3000).map((row) => ({
    label: row.timestamp
      ? formatTimestamp(row.timestamp, timezone)
      : formatDate(row.date),
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
  const strategies = [...new Set(rows.map((row) => row.strategy_name || "Unknown"))];
  const byDate = new Map<string, Record<string, string | number>>();

  for (const row of rows) {
    const date = formatDate(row.date);
    const strategy = row.strategy_name || "Unknown";
    const entry = byDate.get(date) ?? { date };
    entry[strategy] = toNumber(entry[strategy]) + toNumber(row.daily_pnl);
    byDate.set(date, entry);
  }

  const data = downsample([...byDate.values()], 3000);

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
            contentStyle={tooltipStyle}
            formatter={(value, name) => [formatCurrency(Number(value)), name]}
            labelStyle={{ color: "#91a9b8" }}
          />
          {strategies.map((strategy, index) => (
            <Bar key={strategy} dataKey={strategy} fill={strategyColor(strategy, index)}>
              {data.map((item, itemIndex) => (
                <Cell
                  key={`${strategy}-${itemIndex}`}
                  fill={
                    toNumber(item[strategy]) < 0
                      ? CHART_COLORS.loss
                      : strategyColor(strategy, index)
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
