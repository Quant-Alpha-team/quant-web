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

const levelWeights = {
  DEBUG: 10,
  INFO: 20,
  WARNING: 30,
  ERROR: 40,
};

const defaultLogDir = "logs";
const defaultLogFile = "dashboard.log";
const defaultTimeZone = "America/New_York";
const defaultLevel = "INFO";
const defaultRetentionDays = 7;

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

function normalizeLevel(value) {
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

function callerSource() {
  const stack = new Error().stack?.split("\n").slice(1) ?? [];
  for (const line of stack) {
    if (
      line.includes("/lib/logger-core.") ||
      line.includes("\\lib\\logger-core.") ||
      /\b(callerSource|formatLine|writeLine|initializeLogger|logInfo|logWarning|logError|log)\b/.test(
        line,
      )
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

function cleanFieldValue(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  let text;
  if (typeof value === "object") {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  } else {
    text = String(value);
  }
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 4000
    ? `${normalized.slice(0, 3999)}…`
    : normalized;
}

function formatFields(fields) {
  const entries = Object.entries(fields ?? {});
  if (entries.length === 0) {
    return "";
  }
  return ` — ${entries
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

/**
 * @param {{ baseDir?: string, readySource?: string }} [options]
 */
export function createLogger({
  baseDir,
  readySource = "logger-core.mjs:0",
} = {}) {
  let initialized = false;
  let fileLoggingEnabled = true;
  let logFilePath = null;
  let logFileDate = null;
  let lastPrunedDate = null;
  let config = null;

  function loggerConfig() {
    if (config) {
      return config;
    }
    const rawDir = process.env.LOG_DIR?.trim() || defaultLogDir;
    config = {
      dir: isAbsolute(rawDir)
        ? rawDir
        : join(
            /* turbopackIgnore: true */ baseDir ?? process.cwd(),
            rawDir,
          ),
      level: normalizeLevel(process.env.LOG_LEVEL),
      fileName: process.env.LOG_FILE?.trim() || defaultLogFile,
      retentionDays: retentionDays(),
    };
    return config;
  }

  function pruneOldLogs(dir, retainDays) {
    const cutoff = Date.now() - retainDays * 24 * 60 * 60 * 1000;
    const fileName = loggerConfig().fileName;
    const patterns = [
      archivedLogPattern(fileName),
      legacyArchivedLogPattern(fileName),
    ];
    for (const file of readdirSync(/* turbopackIgnore: true */ dir)) {
      if (!patterns.some((pattern) => pattern.test(file))) {
        continue;
      }
      const path = join(/* turbopackIgnore: true */ dir, file);
      if (statSync(/* turbopackIgnore: true */ path).mtimeMs < cutoff) {
        unlinkSync(/* turbopackIgnore: true */ path);
      }
    }
  }

  function archivedLogPath(dir, fileName, date) {
    const basePath = join(/* turbopackIgnore: true */ dir, `${fileName}.${date}`);
    if (!existsSync(/* turbopackIgnore: true */ basePath)) {
      return basePath;
    }
    for (let index = 1; index < 1000; index += 1) {
      const path = join(/* turbopackIgnore: true */ dir, `${fileName}.${date}-${index}`);
      if (!existsSync(/* turbopackIgnore: true */ path)) {
        return path;
      }
    }
    return join(/* turbopackIgnore: true */ dir, `${fileName}.${date}-${Date.now()}`);
  }

  function fileLocalDate(path) {
    return localDate(statSync(/* turbopackIgnore: true */ path).mtime);
  }

  function rotateLogFile(current = loggerConfig()) {
    if (!fileLoggingEnabled) {
      return;
    }
    const date = localDate();
    const activePath = join(/* turbopackIgnore: true */ current.dir, current.fileName);
    if (!logFileDate && existsSync(/* turbopackIgnore: true */ activePath)) {
      logFileDate = fileLocalDate(activePath);
    }
    if (logFilePath && logFileDate === date) {
      return;
    }
    if (
      existsSync(/* turbopackIgnore: true */ activePath) &&
      logFileDate &&
      logFileDate !== date
    ) {
      renameSync(
        /* turbopackIgnore: true */ activePath,
        archivedLogPath(current.dir, current.fileName, logFileDate),
      );
    }
    logFileDate = date;
    logFilePath = activePath;
    if (lastPrunedDate !== date) {
      pruneOldLogs(current.dir, current.retentionDays);
      lastPrunedDate = date;
    }
  }

  function writeLine(level, line) {
    consoleWrite(level, line);
    if (!fileLoggingEnabled) {
      return;
    }
    try {
      rotateLogFile();
      if (logFilePath) {
        appendFileSync(/* turbopackIgnore: true */ logFilePath, `${line}\n`, "utf8");
      }
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
      mkdirSync(/* turbopackIgnore: true */ current.dir, { recursive: true });
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
        readySource,
      ),
    );
    return current;
  }

  function log(level, message, fields) {
    const current = initializeLogger();
    if (levelWeights[level] < levelWeights[current.level]) {
      return;
    }
    writeLine(level, formatLine(level, message, fields));
  }

  return {
    logInfo(message, fields) {
      log("INFO", message, fields);
    },
    logWarning(message, fields) {
      log("WARNING", message, fields);
    },
    logError(message, fields) {
      log("ERROR", message, fields);
    },
  };
}
