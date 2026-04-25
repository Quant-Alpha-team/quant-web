#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (strict) {
      console.error(`API preflight failed: ${message}`);
      process.exit(1);
    }
    console.warn(`API preflight unavailable: ${message}. Starting UI anyway.`);
  } finally {
    clearTimeout(timer);
  }
}

function runNext() {
  const args = process.argv.slice(2);
  const command = args[0] === "start" ? "start" : "dev";
  const passThrough =
    args[0] === "start" || args[0] === "dev" ? args.slice(1) : args;
  const nextBin = resolve(rootDir, "node_modules", ".bin", "next");
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
