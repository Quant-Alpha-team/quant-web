import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { checkRequest, DEFAULT_ALLOWED_HOSTS, parseAllowedHosts } from "../lib/request-guard.ts";

const defaults = parseAllowedHosts(undefined);
const request = (method: string, headers: Record<string, string>) => ({ method, headers: new Headers(headers) });
const check = (method: string, headers: Record<string, string>, allowed = defaults, trustProxyHeaders = false) => {
  const result = checkRequest(request(method, headers), allowed, trustProxyHeaders);
  return result.ok ? "ok" : result.code;
};
const checkBehindProxy = (method: string, headers: Record<string, string>) => check(method, headers, defaults, true);

test("loopback hosts are allowed on any port and in any case", () => {
  assert.deepEqual([...defaults], DEFAULT_ALLOWED_HOSTS);
  for (const host of ["localhost:3000", "127.0.0.1:3998", "[::1]:3000", "localhost", "LOCALHOST:3000", "[0:0:0:0:0:0:0:1]:3000"]) {
    assert.equal(check("GET", { host }), "ok", host);
  }
});

test("DNS-rebound, missing, and malformed hosts are rejected for every method", () => {
  for (const method of ["GET", "POST"]) {
    assert.equal(check(method, { host: "rebind.example:3000" }), "forbidden_host");
    assert.equal(check(method, { host: "127.0.0.1.nip.io:3000" }), "forbidden_host");
    assert.equal(check(method, {}), "forbidden_host");
    assert.equal(check(method, { host: "localhost:3000/evil" }), "forbidden_host");
    assert.equal(check(method, { host: "user@localhost:3000" }), "forbidden_host");
  }
});

test("forwarded headers are ignored unless a trusted proxy sets them", () => {
  // A rebound page can add X-Forwarded-Host to its own same-origin fetch.
  assert.equal(check("GET", { host: "rebind.example:3000", "x-forwarded-host": "localhost:3000" }), "forbidden_host");
  assert.equal(check("GET", { host: "localhost:3000", "x-forwarded-host": "rebind.example" }), "ok");
  assert.equal(check("POST", {
    host: "localhost", "x-forwarded-proto": "https", origin: "https://localhost",
  }), "forbidden_origin");
});

test("behind a trusted proxy the first forwarded host and scheme win", () => {
  assert.equal(checkBehindProxy("GET", { host: "localhost:3000", "x-forwarded-host": "rebind.example" }), "forbidden_host");
  assert.equal(checkBehindProxy("GET", { host: "rebind.example", "x-forwarded-host": "localhost:3000, rebind.example" }), "ok");
  assert.equal(checkBehindProxy("GET", { host: "localhost:3000" }), "ok");
  assert.equal(checkBehindProxy("POST", {
    host: "localhost:3000", "x-forwarded-host": "127.0.0.1:3000", origin: "http://localhost:3000",
  }), "forbidden_origin");
  assert.equal(checkBehindProxy("POST", {
    host: "web:3000", "x-forwarded-host": "localhost", "x-forwarded-proto": "https", origin: "https://localhost:443",
  }), "ok");
});

test("WEB_ALLOWED_HOSTS replaces the default allowlist", () => {
  const custom = parseAllowedHosts(" Dashboard.LAN , ::1, 192.168.1.20:3000 ");
  assert.deepEqual([...custom], ["dashboard.lan", "[::1]", "192.168.1.20"]);
  assert.equal(check("GET", { host: "dashboard.lan:3000" }, custom), "ok");
  assert.equal(check("GET", { host: "[::1]:3000" }, custom), "ok");
  assert.equal(check("GET", { host: "localhost:3000" }, custom), "forbidden_host");
  assert.deepEqual([...parseAllowedHosts("   ")], DEFAULT_ALLOWED_HOSTS);
});

test("unsafe methods require a same-origin Origin when one is present", () => {
  const host = "localhost:3000";
  assert.equal(check("POST", { host, origin: "http://localhost:3000" }), "ok");
  assert.equal(check("post", { host, origin: "http://LOCALHOST:3000" }), "ok");
  assert.equal(check("POST", { host }), "ok");
  for (const origin of ["https://evil.example", "http://localhost:8080", "http://127.0.0.1:3000", "https://localhost:3000", "null", "not a url"]) {
    assert.equal(check("POST", { host, origin }), "forbidden_origin", origin);
  }
  for (const method of ["PUT", "PATCH", "DELETE"]) {
    assert.equal(check(method, { host, origin: "https://evil.example" }), "forbidden_origin");
  }
});

test("default ports and scheme compare canonically in both directions", () => {
  assert.equal(check("POST", { host: "localhost:80", origin: "http://localhost" }), "ok");
  assert.equal(check("POST", { host: "localhost", origin: "http://localhost:80" }), "ok");
  assert.equal(check("POST", { host: "localhost", origin: "https://localhost" }), "forbidden_origin");
});

test("safe methods ignore a foreign Origin once the host is allowed", () => {
  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    assert.equal(check(method, { host: "localhost:3000", origin: "https://evil.example" }), "ok");
  }
});

// Execute proxy.ts with next/server and the logger stubbed; the guard itself is real.
const proxySource = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8")
  .replace(/import .* from "next\/server";/, "const NextResponse = { next: () => new Response(null, { headers: { \"x-middleware-next\": \"1\" } }) };")
  .replace(/import .* from "@\/lib\/logger";/, "const logWarning = () => {};")
  .replace('"@/lib/request-guard"', JSON.stringify(new URL("../lib/request-guard.ts", import.meta.url).href));
const proxyModule = await import("data:text/javascript;base64," + Buffer.from(ts.transpileModule(proxySource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText).toString("base64"));
const proxyRequest = (path: string, init: RequestInit) => {
  const url = `http://localhost:3000${path}`;
  return Object.assign(new Request(url, init), { nextUrl: new URL(url) });
};

test("proxy answers API rejections with JSON, pages with text, and passes allowed requests", async () => {
  const api = await proxyModule.proxy(proxyRequest("/api/dashboard/data", {
    method: "POST", headers: { host: "localhost:3000", origin: "https://evil.example" },
  }));
  assert.equal(api.status, 403);
  assert.deepEqual(await api.json(), { ok: false, error: {
    code: "forbidden_origin", message: "Cross-origin requests are not allowed.",
  } });

  const page = await proxyModule.proxy(proxyRequest("/", { headers: { host: "rebind.example:3000" } }));
  assert.equal(page.status, 403);
  assert.match(page.headers.get("content-type"), /^text\/plain/);

  const allowed = await proxyModule.proxy(proxyRequest("/api/dashboard/sync", {
    method: "POST", headers: { host: "localhost:3000", origin: "http://localhost:3000" },
  }));
  assert.equal(allowed.headers.get("x-middleware-next"), "1");
});

const { unstable_doesMiddlewareMatch: matches } = createRequire(import.meta.url)("next/experimental/testing/server");

test("proxy matcher covers pages, APIs, RSC requests, public files, and the image endpoint", () => {
  const config = proxyModule.config;
  for (const url of [
    "/", "/api/health", "/api/dashboard/data", "/api/dashboard/sync", "/api/dashboard/sync/status",
    "/api/dashboard/filters", "/?_rsc=abc", "/index.rsc", "/index.segments/_tree.segment.rsc", "/QuantAlpha-logo.png", "/icon.png", "/_next/image?url=%2Fapi%2Fdashboard%2Fsync&w=64&q=75",
  ]) {
    assert.equal(matches({ config, url }), true, url);
  }
  assert.equal(matches({ config, url: "/", headers: { rsc: "1", "next-router-prefetch": "1" } }), true);
  assert.equal(matches({ config, url: "/_next/static/chunks/app.js" }), false);
});
