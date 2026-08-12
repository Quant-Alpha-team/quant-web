import assert from "node:assert/strict";
import test from "node:test";

import { normalizeReconciliationSyncResult } from "../lib/reconciliation.ts";

function resultFixture() {
  return {
    status: "completed_with_warnings",
    ok: true,
    counts: {
      spx_daily_closes: { close_prices: 0 },
      portfolio_snapshot: { positions: 8, priced: 8, unpriced: 0 },
    },
    warnings: ["spx_daily_closes: SPX close was unavailable."],
    phases: [
      {
        phase: "spx_daily_closes",
        status: "completed_with_warnings",
        counts: { close_prices: 0 },
        warnings: ["SPX close was unavailable."],
      },
      {
        phase: "portfolio_snapshot",
        status: "completed",
        counts: { positions: 8, priced: 8, unpriced: 0 },
        warnings: [],
      },
    ],
    completed_at: "2026-08-12T00:32:09Z",
    elapsed_seconds: 129.125,
  } as const;
}

test("accepts completed_with_warnings and preserves diagnostics", () => {
  const fixture = resultFixture();
  assert.deepEqual(normalizeReconciliationSyncResult(fixture), fixture);
});

test("accepts a clean completed result", () => {
  const fixture = {
    ...resultFixture(),
    status: "completed",
    warnings: [],
    phases: resultFixture().phases.map((phase) => ({
      ...phase,
      status: "completed",
      warnings: [],
    })),
  };
  assert.equal(normalizeReconciliationSyncResult(fixture).status, "completed");
});

test("rejects failed aggregate states and ok=false", () => {
  for (const status of ["partial_failure", "failed"]) {
    assert.throws(() =>
      normalizeReconciliationSyncResult({ ...resultFixture(), status }),
    );
  }
  assert.throws(() =>
    normalizeReconciliationSyncResult({ ...resultFixture(), ok: false }),
  );
});

test("rejects malformed warning, phase, count, and timing fields", () => {
  const invalidValues = [
    { ...resultFixture(), warnings: [123] },
    { ...resultFixture(), phases: [{ phase: "spx", status: "unknown", counts: {}, warnings: [] }] },
    { ...resultFixture(), counts: { spx: { close_prices: "zero" } } },
    { ...resultFixture(), completed_at: "not-a-date" },
    { ...resultFixture(), elapsed_seconds: -1 },
  ];
  for (const value of invalidValues) {
    assert.throws(() => normalizeReconciliationSyncResult(value));
  }
});
