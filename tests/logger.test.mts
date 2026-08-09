import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { createLogger } from "../lib/logger-core.mjs";
import { logError, logInfo, logWarning } from "../lib/logger.ts";

const logEnvKeys = [
  "LOG_DIR",
  "LOG_FILE",
  "LOG_LEVEL",
  "LOG_RETENTION_DAYS",
  "TZ",
] as const;

type LogEnv = Partial<Record<(typeof logEnvKeys)[number], string>>;

const defaultLogEnv = {
  LOG_DIR: "logs",
  LOG_FILE: "dashboard.log",
  LOG_LEVEL: "INFO",
  LOG_RETENTION_DAYS: "7",
  TZ: "UTC",
} satisfies LogEnv;

function loggerFixture(t: TestContext, prefix: string, values: LogEnv = {}) {
  const root = mkdtempSync(join(tmpdir(), `quant-web-logger-${prefix}-`));
  const cwd = process.cwd();
  const previous = new Map(
    logEnvKeys.map((key) => [key, process.env[key]] as const),
  );
  Object.assign(process.env, defaultLogEnv, values);
  t.after(() => {
    process.chdir(cwd);
    rmSync(root, { recursive: true, force: true });
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
  return { cwd, root };
}

function captureConsole(run: () => void) {
  const output = {
    log: [] as string[],
    warn: [] as string[],
    error: [] as string[],
  };
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };
  for (const method of ["log", "warn", "error"] as const) {
    console[method] = (...values) =>
      output[method].push(values.map(String).join(" "));
  }
  try {
    run();
    return output;
  } finally {
    Object.assign(console, original);
  }
}

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function writeDatedFile(path: string, contents: string, modifiedAt: Date) {
  writeFileSync(path, contents, "utf8");
  utimesSync(path, modifiedAt, modifiedAt);
}

test("logger facade keeps the public logging API", () => {
  assert.equal(typeof logInfo, "function");
  assert.equal(typeof logWarning, "function");
  assert.equal(typeof logError, "function");
});

test("relative log directories use the configured base and retain caller source", (t) => {
  const { cwd: originalCwd, root } = loggerFixture(t, "paths", {
    LOG_DIR: "relative-logs",
    LOG_FILE: "test.log",
  });
  const projectDir = join(root, "project");
  const serverDir = join(root, "server");
  const executionDir = join(root, "execution");
  for (const directory of [projectDir, serverDir, executionDir]) {
    mkdirSync(directory);
  }

  process.chdir(executionDir);
  const launcherLogger = createLogger({
    baseDir: projectDir,
    readySource: "quant-web.mjs:0",
  });
  process.chdir(serverDir);
  const serverLogger = createLogger({ readySource: "logger.ts:0" });

  const output = captureConsole(() => {
    launcherLogger.logInfo("Launcher event", { details: { account: "A1" } });
    serverLogger.logWarning("Server event");
  });
  process.chdir(originalCwd);

  const readLog = (base: string) =>
    readFileSync(join(base, "relative-logs", "test.log"), "utf8");
  const launcherContents = readLog(projectDir);
  const serverContents = readLog(serverDir);
  assert.match(launcherContents, /\[quant-web\.mjs:0\] \| Logger ready/);
  assert.match(
    launcherContents,
    /\| INFO \| \[logger\.test\.mts:\d+\] \| Launcher event/,
  );
  assert.match(launcherContents, /details={"account":"A1"}/);
  assert.match(serverContents, /\[logger\.ts:0\] \| Logger ready/);
  assert.match(serverContents, /\| WARNING \| .* \| Server event/);
  assert.equal(output.log.length, 3);
  assert.equal(output.warn.length, 1);
  assert.equal(output.error.length, 0);
});

test("daily rotation retains recent archives and prunes both archive formats", (t) => {
  const { root } = loggerFixture(t, "rotation");
  const logDir = join(root, "logs");
  mkdirSync(logDir);
  const recentDate = new Date(Date.now() - 2 * 86_400_000);
  const staleDate = new Date(Date.now() - 40 * 86_400_000);
  const recentStamp = dateOnly(recentDate);
  const staleStamp = dateOnly(staleDate);
  const activePath = join(logDir, "dashboard.log");
  const recentArchive = join(logDir, `dashboard.log.${recentStamp}`);
  const staleArchive = join(logDir, `dashboard.log.${staleStamp}`);
  const staleLegacyArchive = join(logDir, `dashboard-${staleStamp}.log`);
  const unrelatedFile = join(logDir, "keep.txt");

  writeDatedFile(activePath, "previous day\n", recentDate);
  writeDatedFile(staleArchive, "stale current format\n", staleDate);
  writeDatedFile(staleLegacyArchive, "stale legacy format\n", staleDate);
  writeDatedFile(unrelatedFile, "keep\n", staleDate);

  captureConsole(() => {
    createLogger({ baseDir: root }).logWarning("Rotated event");
  });

  assert.equal(readFileSync(recentArchive, "utf8"), "previous day\n");
  assert.equal(existsSync(staleArchive), false);
  assert.equal(existsSync(staleLegacyArchive), false);
  assert.equal(existsSync(unrelatedFile), true);
  assert.match(readFileSync(activePath, "utf8"), /Rotated event/);
});

test("file setup failure falls back to console logging", (t) => {
  const { root } = loggerFixture(t, "fallback", { LOG_DIR: "blocked" });
  writeFileSync(join(root, "blocked"), "not a directory", "utf8");

  const output = captureConsole(() => {
    createLogger({ baseDir: root }).logError("Console-only event");
  });
  assert.equal(output.warn.length, 1);
  assert.match(output.warn[0], /Logger file setup failed/);
  assert.equal(output.log.length, 1);
  assert.match(output.log[0], /Logger ready/);
  assert.equal(output.error.length, 1);
  assert.match(output.error[0], /Console-only event/);
});
