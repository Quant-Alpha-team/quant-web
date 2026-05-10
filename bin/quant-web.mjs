#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultLogDir = "log";
const defaultLogFile = "dashboard.log";
const defaultTimeZone = "America/New_York";
const defaultLogLevel = "INFO";
const defaultRetentionDays = 7;
const levelWeights = {
  DEBUG: 10,
  INFO: 20,
  WARNING: 30,
  ERROR: 40,
};
let loggerInitialized = false;
let loggerConfig = null;
let fileLoggingEnabled = true;
let logFilePath = null;
let logFileDate = null;
let lastPrunedDate = null;

function validTimeZone(value) {
  const raw = value?.trim();
  if (!raw) {
    return undefined;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: raw }).format(new Date(0));
    return raw;
  } catch {
    return undefined;
  }
}

function systemTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

function logTimeZone() {
  return (
    validTimeZone(process.env.TZ) ||
    validTimeZone(systemTimeZone()) ||
    defaultTimeZone
  );
}

function localDateTimeParts(date = new Date()) {
  const timeZone = logTimeZone();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = values.hour === "24" ? "00" : values.hour;

  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${hour}:${values.minute}:${values.second}`,
    timeZone,
  };
}

function localTimestamp(date = new Date()) {
  const parts = localDateTimeParts(date);
  return `${parts.date} ${parts.time} ${parts.timeZone}`;
}

function localDate(date = new Date()) {
  return localDateTimeParts(date).date;
}

function normalizeLogLevel(value) {
  const normalized = value?.trim().toUpperCase();
  return ["DEBUG", "INFO", "WARNING", "ERROR"].includes(normalized)
    ? normalized
    : defaultLogLevel;
}

function getRetentionDays() {
  const raw = Number(process.env.LOG_RETENTION_DAYS ?? defaultRetentionDays);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : defaultRetentionDays;
}

function getLoggerConfig() {
  if (loggerConfig) {
    return loggerConfig;
  }

  const rawDir = process.env.LOG_DIR?.trim() || defaultLogDir;
  loggerConfig = {
    dir: resolve(rootDir, rawDir),
    level: normalizeLogLevel(process.env.LOG_LEVEL),
    fileName: process.env.LOG_FILE?.trim() || defaultLogFile,
    retentionDays: getRetentionDays(),
  };
  return loggerConfig;
}

function escapedRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function archivedLogPattern(fileName) {
  return new RegExp(
    `^${escapedRegExp(fileName)}\\.\\d{4}-\\d{2}-\\d{2}(?:-\\d+)?$`,
  );
}

function legacyArchivedLogPattern(fileName) {
  const extensionIndex = fileName.lastIndexOf(".");
  const stem = extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName;
  const extension = extensionIndex > 0 ? fileName.slice(extensionIndex) : "";
  return new RegExp(
    `^${escapedRegExp(stem)}-\\d{4}-\\d{2}-\\d{2}(?:-\\d+)?${escapedRegExp(
      extension,
    )}$`,
  );
}

function pruneOldLogs(dir, retainDays) {
  const cutoff = Date.now() - retainDays * 24 * 60 * 60 * 1000;
  const fileName = getLoggerConfig().fileName;
  const patterns = [archivedLogPattern(fileName), legacyArchivedLogPattern(fileName)];
  for (const file of readdirSync(dir)) {
    if (!patterns.some((pattern) => pattern.test(file))) {
      continue;
    }
    const path = join(dir, file);
    if (statSync(path).mtimeMs < cutoff) {
      unlinkSync(path);
    }
  }
}

function archivedLogPath(dir, fileName, date) {
  const basePath = join(dir, `${fileName}.${date}`);
  if (!existsSync(basePath)) {
    return basePath;
  }

  for (let index = 1; index < 1000; index += 1) {
    const path = join(dir, `${fileName}.${date}-${index}`);
    if (!existsSync(path)) {
      return path;
    }
  }
  return join(dir, `${fileName}.${date}-${Date.now()}`);
}

function fileLocalDate(path) {
  return localDate(statSync(path).mtime);
}

function rotateLogFile(config = getLoggerConfig()) {
  if (!fileLoggingEnabled) {
    return;
  }

  const date = localDate();
  const activePath = join(config.dir, config.fileName);
  if (!logFileDate && existsSync(activePath)) {
    logFileDate = fileLocalDate(activePath);
  }

  if (logFilePath && logFileDate === date) {
    return;
  }

  if (existsSync(activePath) && logFileDate && logFileDate !== date) {
    renameSync(activePath, archivedLogPath(config.dir, config.fileName, logFileDate));
  }

  logFileDate = date;
  logFilePath = activePath;
  if (lastPrunedDate !== date) {
    pruneOldLogs(config.dir, config.retentionDays);
    lastPrunedDate = date;
  }
}

function callerSource() {
  const stack = new Error().stack?.split("\n").slice(2) ?? [];
  for (const line of stack) {
    if (
      line.includes("callerSource") ||
      line.includes("formatLine") ||
      line.includes("writeLine") ||
      line.includes("initializeLogger") ||
      line.includes("logInfo") ||
      line.includes("logWarning") ||
      line.includes("logError") ||
      line.includes(" log ")
    ) {
      continue;
    }

    const match = line.match(/(?:\()?((?:file:\/\/)?[^()]+?):(\d+):\d+\)?$/);
    if (match) {
      return `${basename(match[1].replace(/^file:\/\//, ""))}:${match[2]}`;
    }
  }
  return "unknown:0";
}

function loggerSource() {
  const stack = new Error().stack?.split("\n").slice(1) ?? [];
  for (const line of stack) {
    if (!line.includes("/bin/quant-web.mjs")) {
      continue;
    }

    const match = line.match(/(?:\()?((?:file:\/\/)?[^()]+?):(\d+):\d+\)?$/);
    if (match) {
      return `${basename(match[1].replace(/^file:\/\//, ""))}:${match[2]}`;
    }
  }
  return "quant-web.mjs:0";
}

function cleanFieldValue(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  return String(value).replace(/\s+/g, " ").trim();
}

function formatFields(fields) {
  const entries = Object.entries(fields ?? {});
  if (entries.length === 0) {
    return "";
  }
  return ` \u2014 ${entries
    .map(([key, value]) => `${key}=${cleanFieldValue(value)}`)
    .join(" ")}`;
}

function formatLine(level, message, fields, source = callerSource()) {
  return `${localTimestamp()} | ${level} | [${source}] | ${message}${formatFields(
    fields,
  )}`;
}

function consoleWrite(level, line) {
  if (level === "ERROR") {
    console.error(line);
    return;
  }
  if (level === "WARNING") {
    console.warn(line);
    return;
  }
  console.log(line);
}

function writeLine(level, line) {
  consoleWrite(level, line);
  if (!fileLoggingEnabled) {
    return;
  }

  try {
    rotateLogFile();
    if (!logFilePath) {
      return;
    }
    appendFileSync(logFilePath, `${line}\n`, "utf8");
  } catch (error) {
    fileLoggingEnabled = false;
    const message = error instanceof Error ? error.message : String(error);
    console.warn(formatLine("WARNING", "Logger file write disabled", { error: message }));
  }
}

function initializeLogger() {
  const config = getLoggerConfig();
  if (loggerInitialized) {
    return config;
  }

  loggerInitialized = true;
  try {
    mkdirSync(config.dir, { recursive: true });
    rotateLogFile(config);
  } catch (error) {
    fileLoggingEnabled = false;
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      formatLine("WARNING", "Logger file setup failed", {
        dir: config.dir,
        error: message,
      }),
    );
  }

  writeLine(
    "INFO",
    formatLine(
      "INFO",
      "Logger ready",
      {
        dir: config.dir,
        file: config.fileName,
        level: config.level,
        retain: `${config.retentionDays}d`,
      },
      loggerSource(),
    ),
  );
  return config;
}

function log(level, message, fields) {
  const config = initializeLogger();
  if (levelWeights[level] < levelWeights[config.level]) {
    return;
  }
  writeLine(level, formatLine(level, message, fields));
}

function logInfo(message, fields) {
  log("INFO", message, fields);
}

function logWarning(message, fields) {
  log("WARNING", message, fields);
}

function logError(message, fields) {
  log("ERROR", message, fields);
}

function loadEnvFile(filename) {
  const filePath = resolve(rootDir, filename);
  if (!existsSync(filePath)) {
    return;
  }

  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }
    const [rawKey, ...rawValue] = trimmed.split("=");
    const key = rawKey.trim().replace(/^export\s+/, "");
    const value = rawValue.join("=").trim().replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function boolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined) {
    return fallback;
  }
  return ["1", "true", "yes", "y", "on"].includes(raw.trim().toLowerCase());
}

async function preflight() {
  const strict = boolEnv("API_PREFLIGHT_STRICT", false);
  const baseUrl = (
    process.env.API_BASE_URL ||
    process.env.BASE_URL ||
    "http://127.0.0.1:8000"
  ).replace(/\/+$/, "");
  const timeoutSeconds = Number(process.env.API_TIMEOUT_SECONDS || "15");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

  try {
    const response = await fetch(`${baseUrl}/api/health/`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    logInfo("API preflight ready", { base_url: baseUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (strict) {
      logError(`API preflight failed: ${message}`);
      process.exit(1);
    }
    logWarning(
      `API preflight unavailable: ${message}. Continue in UI-only mode (no backend data).`,
    );
  } finally {
    clearTimeout(timer);
  }
}

function optionValue(args, names, fallback) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    for (const name of names) {
      if (arg === name && args[index + 1]) {
        return args[index + 1];
      }
      if (arg.startsWith(`${name}=`)) {
        return arg.slice(name.length + 1);
      }
    }
  }
  return fallback;
}

function runNext() {
  const args = process.argv.slice(2);
  const command = args[0] === "start" ? "start" : "dev";
  const passThrough =
    args[0] === "start" || args[0] === "dev" ? args.slice(1) : args;
  const port = optionValue(passThrough, ["--port", "-p"], process.env.PORT || "3000");
  const host = optionValue(
    passThrough,
    ["--hostname", "-H"],
    process.env.HOSTNAME || "localhost",
  );
  const displayHost = host === "0.0.0.0" || host === "::" ? "localhost" : host;
  const nextBin = resolve(rootDir, "node_modules", ".bin", "next");
  logInfo(`Starting dashboard on http://${displayHost}:${port}`);
  logInfo("Launching Next.js", { command, port });
  const child = spawn(nextBin, [command, ...passThrough], {
    cwd: rootDir,
    env: process.env,
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

loadEnvFile(".env.local");
loadEnvFile(".env");
await preflight();
runNext();
