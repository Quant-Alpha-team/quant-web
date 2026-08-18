import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateEquityHistory,
  computeKpis,
  downsample,
  formatNumber,
  resolveDateRange,
  strategyIdentity,
  todayInTimeZone,
  toOptionalNumber,
} from "../lib/dashboard.ts";
import {
  TRADE_EXECUTION_ROW_SCHEMA,
  TRADE_LOG_INSTRUMENT_COLUMNS,
} from "../lib/trade-executions.ts";

test("trade logs retain exchange data between symbol and type", () => {
  assert.equal(TRADE_EXECUTION_ROW_SCHEMA.exchange, "string?");
  assert.deepEqual(
    TRADE_LOG_INSTRUMENT_COLUMNS.map(({ label }) => label),
    ["Symbol", "Exchange", "Type"],
  );
  assert.equal(TRADE_LOG_INSTRUMENT_COLUMNS[1].field, "exchange");
});

test("numeric helpers preserve zero and distinguish missing values", () => {
  assert.equal(toOptionalNumber(0), 0);
  assert.equal(toOptionalNumber("0"), 0);
  assert.equal(toOptionalNumber(""), null);
  assert.equal(toOptionalNumber("not-a-number"), null);
  assert.equal(formatNumber(0), "0.00");
  assert.equal(formatNumber(undefined), "—");
});

test("legacy strategy names keep their version when modern fields are null", () => {
  assert.deepEqual(
    strategyIdentity({ strategy_name: "ETF_ROTATION_V12", strategy_version: null }),
    {
      family: "ETF_ROTATION",
      version: "V12",
      strategyName: "ETF_ROTATION_V12",
    },
  );
});

test("last one year preset describes its actual 365-day window", () => {
  const timezone = "America/New_York";
  const range = resolveDateRange("Last 1 Year", timezone, "", "");
  assert.equal(range.endDate, todayInTimeZone(timezone));
  const elapsedDays =
    (Date.parse(range.endDate) - Date.parse(range.startDate)) / 86_400_000;
  assert.equal(elapsedDays, 365);
});

test("year to date starts on January 1 in the selected timezone", () => {
  const timezone = "Asia/Taipei";
  const range = resolveDateRange("Year to Date", timezone, "", "");

  assert.equal(range.endDate, todayInTimeZone(timezone));
  assert.equal(range.startDate, `${range.endDate.slice(0, 4)}-01-01`);
});

test("equity aggregation ignores invalid NAV rows and keeps the latest valid close", () => {
  const rows = aggregateEquityHistory([
    {
      broker_account_id: "A1",
      date: "2026-08-01",
      timestamp: "2026-08-01T19:00:00Z",
      equity_value: "100",
    },
    {
      broker_account_id: "A1",
      date: "2026-08-01",
      timestamp: "2026-08-01T20:00:00Z",
      equity_value: "invalid",
    },
    {
      broker_account_id: "A1",
      date: "2026-08-01",
      timestamp: "2026-08-01T21:00:00Z",
      equity_value: 125,
      cash_value: 25,
      gross_position_value: 100,
    },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].equity_value, 125);
  assert.equal(rows[0].cash_value, 25);
  assert.equal(rows[0].gross_position_value, 100);
});

test("KPI and equity chart aggregation choose the same row on timestamp ties", () => {
  const rows = [
    {
      broker_account_id: "A1",
      date: "2026-08-01",
      timestamp: "2026-08-01T20:00:00Z",
      equity_value: 100,
      cash_value: 20,
      gross_position_value: 80,
    },
    {
      broker_account_id: "A1",
      date: "2026-08-01",
      timestamp: "2026-08-01T20:00:00Z",
      equity_value: 125,
      cash_value: 25,
      gross_position_value: 100,
    },
  ];

  assert.equal(aggregateEquityHistory(rows)[0].equity_value, 125);
  assert.equal(computeKpis(rows, [], [], []).accountNav, 125);
  assert.equal(computeKpis(rows, [], [], []).accountCash, 25);
  assert.equal(computeKpis(rows, [], [], []).accountGrossPositionValue, 100);
});

test("account metrics require complete coverage before summing accounts", () => {
  const rows = [
    {
      broker_account_id: "A1",
      date: "2026-08-01",
      timestamp: "2026-08-01T20:00:00Z",
      equity_value: 100,
      cash_value: 20,
      gross_position_value: 80,
    },
    {
      broker_account_id: "A2",
      date: "2026-08-01",
      timestamp: "2026-08-01T20:00:00Z",
      equity_value: 200,
      cash_value: 30,
      gross_position_value: null,
    },
  ];

  const aggregated = aggregateEquityHistory(rows)[0];
  assert.equal(aggregated.equity_value, 300);
  assert.equal(aggregated.cash_value, 50);
  assert.equal(aggregated.gross_position_value, null);

  const kpi = computeKpis(rows, [], [], []);
  assert.equal(kpi.accountNav, 300);
  assert.equal(kpi.accountCash, 50);
  assert.equal(kpi.accountGrossPositionValue, null);
});

test("downsample keeps both endpoints", () => {
  assert.deepEqual(downsample([0, 1, 2, 3, 4], 3), [0, 2, 4]);
});
