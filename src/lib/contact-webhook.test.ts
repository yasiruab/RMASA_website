import { strict as assert } from "node:assert";
import { test } from "node:test";
import { postContactWebhook } from "./contact-webhook.ts";

const respondWith = (status: number): typeof fetch =>
  (async () => new Response("{}", { status })) as typeof fetch;

// Never resolves on its own; rejects when the request's abort signal fires.
const hangUntilAborted: typeof fetch = ((_url: string, init?: RequestInit) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  })) as typeof fetch;

test("returns true on a 2xx response", async () => {
  assert.equal(await postContactWebhook("https://hook.example", { a: 1 }, respondWith(200)), true);
});

test("returns false on a non-2xx response", async () => {
  assert.equal(await postContactWebhook("https://hook.example", { a: 1 }, respondWith(500)), false);
});

test("returns false when fetch throws", async () => {
  const failing = (async () => {
    throw new Error("network down");
  }) as typeof fetch;
  assert.equal(await postContactWebhook("https://hook.example", {}, failing), false);
});

test("gives up on a hung receiver after the timeout", async () => {
  const started = Date.now();
  assert.equal(await postContactWebhook("https://hook.example", {}, hangUntilAborted, 50), false);
  assert.ok(Date.now() - started < 2_000, "should abort promptly");
});

test("sends the payload as JSON", async () => {
  let sent: RequestInit | undefined;
  const capture = (async (_url: string, init?: RequestInit) => {
    sent = init;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  await postContactWebhook("https://hook.example", { name: "Nimal" }, capture);
  assert.equal(sent?.method, "POST");
  assert.equal(sent?.body, JSON.stringify({ name: "Nimal" }));
});
