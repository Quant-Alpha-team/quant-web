import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { basename, isAbsolute, join } from "node:path";

type LogLevel = "DEBUG" | "INFO" | "WARNING" | "ERROR";
type LogFields = Record<string, unknown>;

const levelWeights: Record<LogLevel, number> = {
  DEBUG: 10,
  INFO: 20,
  WARNING: 30,
  ERROR: 40,
};

const defaultLogDir = "log";
const defaultLogFile = "dashboard.log";
const defaultTimeZone = "America/New_York";
const defaultLevel: LogLevel = "INFO";
const defaultRetentionDays = 7;
let initialized = false;
let fileLoggingEnabled = true;
let logFilePath: string | null = null;
let logFileDate: string | null = null;
let lastPrunedDate: string | null = null;
let config: {
  dir: string;
  level: LogLevel;
  fileName: string;
  retentionDays: number;
} | null = null;

function validTimeZone(value: string | undefined) {
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

function normalizeLevel(value: string | undefined): LogLevel {
  const normalized = value?.trim().toUpperCase();
  return normalized === "DEBUG" ||
    normalized === "INFO" ||
    normalized === "WARNING" ||
    normalized === "ERROR"
    ? normalized
    : defaultLevel;
}

function retentionDays() {
  const raw = Number(process.env.LOG_RETENTION_DAYS ?? defaultRetentionDays);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : defaultRetentionDays;
}

function loggerConfig() {
  if (config) {
    return config;
  }

  const rawDir = process.env.LOG_DIR?.trim() || defaultLogDir;
  config = {
    dir: isAbsolute(rawDir)
      ? rawDir
      : join(/*turbopackIgnore: true*/ process.cwd(), rawDir),
    level: normalizeLevel(process.env.LOG_LEVEL),
    fileName: process.env.LOG_FILE?.trim() || defaultLogFile,
    retentionDays: retentionDays(),
  };
  return config;
}

function escapedRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function archivedLogPattern(fileName: string) {
  const extensionIndex = fileName.lastIndexOf(".");
  const stem = extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName;
  const extension = extensionIndex > 0 ? fileName.slice(extensionIndex) : "";
  return new RegExp(
    `^${escapedRegExp(stem)}-\\d{4}-\\d{2}-\\d{2}(?:-\\d+)?${escapedRegExp(
      extension,
    )}$`,
  );
}

function pruneOldLogs(dir: string, retainDays: number) {
  const cutoff = Date.now() - retainDays * 24 * 60 * 60 * 1000;
  const pattern = archivedLogPattern(loggerConfig().fileName);
  for (const file of readdirSync(dir)) {
    if (!pattern.test(file)) {
      continue;
    }

    const path = join(dir, file);
    if (statSync(path).mtimeMs < cutoff) {
      unlinkSync(path);
    }
  }
}

function archivedLogPath(dir: string, fileName: string, date: string) {
  const extensionIndex = fileName.lastIndexOf(".");
  const stem = extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName;
  const extension = extensionIndex > 0 ? fileName.slice(extensionIndex) : "";
  const basePath = join(dir, `${stem}-${date}${extension}`);
  if (!existsSync(basePath)) {
    return basePath;
  }

  for (let index = 1; index < 1000; index += 1) {
    const path = join(dir, `${stem}-${date}-${index}${extension}`);
    if (!existsSync(path)) {
      return path;
    }
  }
  return join(dir, `${stem}-${date}-${Date.now()}${extension}`);
}

function fileLocalDate(path: string) {
  return localDate(statSync(path).mtime);
}

function rotateLogFile(current = loggerConfig()) {
  if (!fileLoggingEnabled) {
    return;
  }

  const date = localDate();
  const activePath = join(current.dir, current.fileName);
  if (!logFileDate && existsSync(activePath)) {
    logFileDate = fileLocalDate(activePath);
  }

  if (logFilePath && logFileDate === date) {
    return;
  }

  if (existsSync(activePath) && logFileDate && logFileDate !== date) {
    renameSync(activePath, archivedLogPath(current.dir, current.fileName, logFileDate));
  }

  logFileDate = date;
  logFilePath = activePath;
  if (lastPrunedDate !== date) {
    pruneOldLogs(current.dir, current.retentionDays);
    lastPrunedDate = date;
  }
}

function callerSource() {
  const stack = new Error().stack?.split("\n").slice(2) ?? [];
  for (const line of stack) {
    if (line.includes("/lib/logger.") || line.includes("\\lib\\logger.")) {
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
    if (!line.includes("/lib/logger.") && !line.includes("\\lib\\logger.")) {
      continue;
    }

    const match = line.match(/(?:\()?((?:file:\/\/)?[^()]+?):(\d+):\d+\)?$/);
    if (match) {
      return `${basename(match[1].replace(/^file:\/\//, ""))}:${match[2]}`;
    }
  }
  return "logger.ts:0";
}

function cleanFieldValue(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  return String(value).replace(/\s+/g, " ").trim();
}

function formatFields(fields?: LogFields) {
  const entries = Object.entries(fields ?? {});
  if (entries.length === 0) {
    return "";
  }
  return ` \u2014 ${entries
    .map(([key, value]) => `${key}=${cleanFieldValue(value)}`)
    .join(" ")}`;
}

function formatLine(
  level: LogLevel,
  message: string,
  fields?: LogFields,
  source = callerSource(),
) {
  return `${localTimestamp()} | ${level} | [${source}] | ${message}${formatFields(
    fields,
  )}`;
}

function consoleWrite(level: LogLevel, line: string) {
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

function writeLine(level: LogLevel, line: string) {
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
    console.warn(
      formatLine("WARNING", "Logger file write disabled", { error: message }),
    );
  }
}

function initializeLogger() {
  const current = loggerConfig();
  if (initialized) {
    return current;
  }

  initialized = true;
  try {
    mkdirSync(current.dir, { recursive: true });
    rotateLogFile(current);
  } catch (error) {
    fileLoggingEnabled = false;
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      formatLine("WARNING", "Logger file setup failed", {
        dir: current.dir,
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
        dir: current.dir,
        file: current.fileName,
        level: current.level,
        retain: `${current.retentionDays}d`,
      },
      loggerSource(),
    ),
  );
  return current;
}

function log(level: LogLevel, message: string, fields?: LogFields) {
  const current = initializeLogger();
  if (levelWeights[level] < levelWeights[current.level]) {
    return;
  }
  writeLine(level, formatLine(level, message, fields));
}

export function logDebug(message: string, fields?: LogFields) {
  log("DEBUG", message, fields);
}

export function logInfo(message: string, fields?: LogFields) {
  log("INFO", message, fields);
}

export function logWarning(message: string, fields?: LogFields) {
  log("WARNING", message, fields);
}

export function logError(message: string, fields?: LogFields) {
  log("ERROR", message, fields);
}
