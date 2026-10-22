export class ReconciliationRequestError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Serial polling; releasing a lease conveys no completion result. */
export function monitorReconciliation(
  onIdle: () => void,
  onError: (message: string | null) => void,
  request: typeof fetch = fetch,
  delay = 5000,
) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function poll() {
    try {
      const response = await request("/api/dashboard/sync/status", { cache: "no-store", signal: controller.signal });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error?.message || "Unable to check synchronization status.");
      if (controller.signal.aborted) return;
      if (payload.data.status === "idle") { onIdle(); return; }
      if (payload.data.status !== "in_progress") throw new Error("Invalid synchronization status.");
      onError(null);
    } catch (error) {
      if (controller.signal.aborted) return;
      onError(error instanceof Error ? error.message : String(error));
    }
    timer = setTimeout(poll, delay);
  }
  timer = setTimeout(poll, delay);
  return () => { controller.abort(); clearTimeout(timer); };
}
