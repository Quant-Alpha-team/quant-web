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

test("last ten years preset describes its actual 3650-day window", () => {
  const timezone = "America/New_York";
  const range = resolveDateRange("Last 10 Years", timezone, "", "");
  assert.equal(range.endDate, todayInTimeZone(timezone));
  const elapsedDays =
    (Date.parse(range.endDate) - Date.parse(range.startDate)) / 86_400_000;
  assert.equal(elapsedDays, 3650);
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
    },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].equity_value, 125);
});

test("KPI and equity chart aggregation choose the same row on timestamp ties", () => {
  const rows = [
    {
      broker_account_id: "A1",
      date: "2026-08-01",
      timestamp: "2026-08-01T20:00:00Z",
      equity_value: 100,
    },
    {
      broker_account_id: "A1",
      date: "2026-08-01",
      timestamp: "2026-08-01T20:00:00Z",
      equity_value: 125,
    },
  ];

  assert.equal(aggregateEquityHistory(rows)[0].equity_value, 125);
  assert.equal(computeKpis(rows, [], [], []).accountNav, 125);
});

test("downsample keeps both endpoints", () => {
  assert.deepEqual(downsample([0, 1, 2, 3, 4], 3), [0, 2, 4]);
});
