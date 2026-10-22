import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Execute the production server modules with logging and unrelated data imports
// stubbed; fetch is the only external boundary used by these requests.
const compile = (source: string) => "data:text/javascript;base64," + Buffer.from(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText).toString("base64");
const backendSource = readFileSync(new URL("../lib/backend-api.ts", import.meta.url), "utf8")
  .replace(/import[\s\S]*?from ["'][^"']+["'];/g, "");
process.env.API_AUTH_DISABLED = "true";
const backendUrl = compile("const TRADE_EXECUTION_ROW_SCHEMA = {}; const logError = () => {}; const logWarning = () => {};\n" + backendSource);
const backend = await import(backendUrl);
const routeSource = readFileSync(new URL("../app/api/dashboard/sync/route.ts", import.meta.url), "utf8")
  .replace('"@/lib/backend-api"', JSON.stringify(backendUrl))
  .replace(/import .* from "@\/lib\/logger";/, "const logError = () => {}; const logInfo = () => {}; const logWarning = () => {};");
const route = await import(compile(routeSource));

test("backend typed error and actual sync proxy preserve conflict; failures stay distinct", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ ok: false, error: {
    code: "sync_in_progress", message: "Already running",
  } }, { status: 409 }));
  await assert.rejects(backend.syncTradingData(), (error: unknown) => {
    assert.equal((error as { status: number }).status, 409);
    assert.equal((error as { code: string }).code, "sync_in_progress");
    return true;
  });
  const response = await route.POST();
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "sync_in_progress");
  t.mock.method(globalThis, "fetch", async () => Response.json({ ok: false, error: {
    code: "reconciliation_failed", message: "Failed",
  } }, { status: 502 }));
  const failed = await route.POST();
  assert.equal(failed.status, 503);
  assert.equal((await failed.json()).error.code, "synchronization_failed");
});

test("headers timeout checks the lease without repeating POST; only active leases become conflicts", async (t) => {
  for (const status of ["in_progress", "idle", "unavailable"]) {
    const calls: string[] = [];
    t.mock.method(globalThis, "fetch", async (url: string | URL | Request, options?: RequestInit) => {
      calls.push(`${options?.method} ${new URL(String(url)).pathname}`);
      if (options?.method === "POST") {
        throw new TypeError("fetch failed", { cause: Object.assign(new Error("Headers Timeout Error"), { code: "UND_ERR_HEADERS_TIMEOUT" }) });
      }
      if (status === "unavailable") throw new Error("status connection failed");
      return Response.json({ ok: true, data: { status, expires_at: null } });
    });
    const response = await route.POST();
    assert.equal(response.status, status === "in_progress" ? 409 : 503);
    assert.equal((await response.json()).error.code, status === "in_progress" ? "sync_in_progress" : "synchronization_failed");
    assert.deepEqual(calls, [
      "POST /api/trading/reconciliation/sync/",
      "GET /api/trading/reconciliation/status/",
    ]);
  }
});
