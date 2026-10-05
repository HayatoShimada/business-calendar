import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { notifyWebhook } from "../../src/webhook";

test("webhook: 設定が無ければ送らない", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => new Response("ok"));
  await notifyWebhook({});
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("webhook: 本文に WEBHOOK_BODY を足し、HMAC-SHA256 の署名を指定のヘッダーに入れる", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => new Response("ok"));
  await notifyWebhook(
    {
      WEBHOOK_URL: "https://example.com/api/revalidate",
      WEBHOOK_SECRET: "secret",
      WEBHOOK_SIGNATURE_HEADER: "x-cms-signature",
      WEBHOOK_BODY: '{"api":"business-calendar"}',
    },
    new Date("2026-10-05T00:00:00Z"),
  );
  assert.equal(fetchMock.mock.callCount(), 1);
  const [url, init] = fetchMock.mock.calls[0].arguments as [string, RequestInit];
  assert.equal(url, "https://example.com/api/revalidate");
  const body = init.body as string;
  assert.deepEqual(JSON.parse(body), { api: "business-calendar", event: "calendar.updated", updatedAt: "2026-10-05T00:00:00.000Z" });
  const headers = init.headers as Record<string, string>;
  assert.equal(headers["x-cms-signature"], createHmac("sha256", "secret").update(body).digest("hex"));
});

test("webhook: 送れなくても例外にしない", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("network");
  });
  t.mock.method(console, "error", () => {});
  await notifyWebhook({ WEBHOOK_URL: "https://example.com", WEBHOOK_SECRET: "s" });
});
