import assert from "node:assert/strict";
import test from "node:test";
import { monitorReconciliation } from "../lib/reconciliation-monitor.ts";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const reply = (status: string) => Response.json({ ok: true, data: { status } });

test("polls serially until idle, then stops without inventing a result", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  let idle = 0;
  const stop = monitorReconciliation(() => idle++, (error) => assert.equal(error, null), async () => {
    calls++;
    return reply(calls === 1 ? "in_progress" : "idle");
  });
  t.mock.timers.tick(5000);
  await flush();
  assert.equal(calls, 1);
  assert.equal(idle, 0);
  t.mock.timers.tick(5000);
  await flush();
  assert.equal(idle, 1);
  t.mock.timers.tick(15000);
  assert.equal(calls, 2);
  stop();
});

test("unmount aborts an outstanding request and prevents duplicate polls", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  let signal: AbortSignal | undefined;
  let resolve!: (response: Response) => void;
  const stop = monitorReconciliation(assert.fail, () => assert.fail("Unexpected callback after unmount"), async (_, options) => {
    calls++;
    signal = options?.signal as AbortSignal;
    return new Promise<Response>((done) => { resolve = done; });
  });
  t.mock.timers.tick(5000);
  t.mock.timers.tick(20000);
  assert.equal(calls, 1);
  stop();
  assert.equal(signal?.aborted, true);
  resolve(reply("idle"));
  await flush();
  t.mock.timers.tick(20000);
  assert.equal(calls, 1);
});

test("status errors remain errors and polling can recover", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const errors: (string | null)[] = [];
  let calls = 0;
  let idle = false;
  const stop = monitorReconciliation(() => { idle = true; }, (error) => errors.push(error), async () => {
    if (++calls === 1) return Response.json({ ok: false, error: { message: "Unavailable" } }, { status: 503 });
    return reply(calls === 2 ? "in_progress" : "idle");
  });
  t.mock.timers.tick(5000);
  await flush();
  assert.deepEqual(errors, ["Unavailable"]);
  assert.equal(idle, false);
  t.mock.timers.tick(5000);
  await flush();
  assert.deepEqual(errors, ["Unavailable", null]);
  assert.equal(idle, false);
  t.mock.timers.tick(5000);
  await flush();
  assert.equal(idle, true);
  stop();
});
