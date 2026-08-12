export type ReconciliationPhaseStatus =
  | "completed"
  | "completed_with_warnings"
  | "failed"
  | "skipped";

export type ReconciliationPhaseResult = {
  phase: string;
  status: ReconciliationPhaseStatus;
  counts: Record<string, number>;
  warnings: string[];
  error?: string;
};

export type ReconciliationSyncResult = {
  status: "completed" | "completed_with_warnings";
  ok: true;
  counts: Record<string, Record<string, number>>;
  warnings: string[];
  phases: ReconciliationPhaseResult[];
  completed_at: string;
  elapsed_seconds: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeWarnings(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((warning) => typeof warning !== "string")) {
    throw new TypeError("Reconciliation warnings must be an array of strings.");
  }
  return value.map((warning) => warning.trim()).filter(Boolean);
}

function normalizeCounts(value: unknown): Record<string, number> {
  if (!isRecord(value)) {
    throw new TypeError("Reconciliation counts must be an object.");
  }
  const counts: Record<string, number> = {};
  for (const [name, count] of Object.entries(value)) {
    if (typeof count !== "number" || !Number.isInteger(count)) {
      throw new TypeError("Reconciliation counts must contain integers.");
    }
    counts[name] = count;
  }
  return counts;
}

function normalizePhase(value: unknown): ReconciliationPhaseResult {
  if (!isRecord(value)) {
    throw new TypeError("Reconciliation phase must be an object.");
  }
  const phase = typeof value.phase === "string" ? value.phase.trim() : "";
  const validStatuses = new Set<ReconciliationPhaseStatus>([
    "completed",
    "completed_with_warnings",
    "failed",
    "skipped",
  ]);
  const status = value.status;
  if (!phase || typeof status !== "string" || !validStatuses.has(status as ReconciliationPhaseStatus)) {
    throw new TypeError("Reconciliation phase fields are invalid.");
  }
  const normalized: ReconciliationPhaseResult = {
    phase,
    status: status as ReconciliationPhaseStatus,
    counts: normalizeCounts(value.counts),
    warnings: normalizeWarnings(value.warnings),
  };
  if (value.error !== undefined) {
    if (typeof value.error !== "string" || !value.error.trim()) {
      throw new TypeError("Reconciliation phase error is invalid.");
    }
    normalized.error = value.error.trim();
  }
  return normalized;
}

export function normalizeReconciliationSyncResult(
  value: unknown,
): ReconciliationSyncResult {
  if (!isRecord(value)) {
    throw new TypeError("Reconciliation result must be an object.");
  }
  if (
    value.status !== "completed" &&
    value.status !== "completed_with_warnings"
  ) {
    throw new TypeError("Reconciliation result status is not successful.");
  }
  if (value.ok !== true) {
    throw new TypeError("Reconciliation result is not successful.");
  }
  if (!Array.isArray(value.phases)) {
    throw new TypeError("Reconciliation phases must be an array.");
  }
  const completedAt =
    typeof value.completed_at === "string" ? value.completed_at.trim() : "";
  if (!completedAt || !Number.isFinite(Date.parse(completedAt))) {
    throw new TypeError("Reconciliation completion time is invalid.");
  }
  if (
    typeof value.elapsed_seconds !== "number" ||
    !Number.isFinite(value.elapsed_seconds) ||
    value.elapsed_seconds < 0
  ) {
    throw new TypeError("Reconciliation elapsed time is invalid.");
  }

  const counts: Record<string, Record<string, number>> = {};
  if (!isRecord(value.counts)) {
    throw new TypeError("Reconciliation aggregate counts must be an object.");
  }
  for (const [phase, phaseCounts] of Object.entries(value.counts)) {
    counts[phase] = normalizeCounts(phaseCounts);
  }

  return {
    status: value.status,
    ok: true,
    counts,
    warnings: normalizeWarnings(value.warnings),
    phases: value.phases.map(normalizePhase),
    completed_at: completedAt,
    elapsed_seconds: value.elapsed_seconds,
  };
}
