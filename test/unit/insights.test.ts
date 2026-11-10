import { test } from "node:test";
import assert from "node:assert/strict";
import { checkInsightsAuth, handleInsights, parseInsightsRange, safeEqual, toDailyRows, toKeywordRows } from "../../src/insights";

const req = (auth?: string, method = "GET") =>
  new Request("https://calendar.example.com/v1/insights", { method, headers: auth ? { Authorization: auth } : {} });

test("トークンが未設定なら機能ごと無効（404）、違えば 401", () => {
  assert.throws(() => checkInsightsAuth(req("Bearer x"), {} as never), { status: 404 });
  const env = { INSIGHTS_TOKEN: "secret-token" } as never;
  assert.throws(() => checkInsightsAuth(req(), env), { status: 401 });
  assert.throws(() => checkInsightsAuth(req("Bearer secret-tokeN"), env), { status: 401 });
  assert.throws(() => checkInsightsAuth(req("secret-token"), env), { status: 401 });
  checkInsightsAuth(req("Bearer secret-token"), env);
});

test("safeEqual は長さ違いでも false", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abcd"), false);
  assert.equal(safeEqual("", "a"), false);
});

test("期間は YYYY-MM-DD・順序・120日まで", () => {
  const u = (q: string) => new URL(`https://x/v1/insights?${q}`);
  assert.deepEqual(parseInsightsRange(u("from=2026-11-01&to=2026-11-07")), { from: "2026-11-01", to: "2026-11-07" });
  assert.throws(() => parseInsightsRange(u("from=2026-11-07&to=2026-11-01")), { status: 400 });
  assert.throws(() => parseInsightsRange(u("from=2026-02-30&to=2026-03-01")), { status: 400 });
  assert.throws(() => parseInsightsRange(u("from=2026-01-01&to=2026-06-01")), { status: 400 });
});

test("日次の応答は日付ごとに並べ、値の無い日・指標は 0", () => {
  const rows = toDailyRows(
    {
      multiDailyMetricTimeSeries: [
        {
          dailyMetricTimeSeries: [
            {
              dailyMetric: "BUSINESS_DIRECTION_REQUESTS",
              timeSeries: { datedValues: [{ date: { year: 2026, month: 11, day: 1 }, value: "4" }, { date: { year: 2026, month: 11, day: 2 } }] },
            },
            {
              dailyMetric: "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
              timeSeries: { datedValues: [{ date: { year: 2026, month: 11, day: 2 }, value: "120" }] },
            },
          ],
        },
      ],
    },
    "2026-11-01",
    "2026-11-03"
  );
  assert.deepEqual(rows.map((r) => r.date), ["2026-11-01", "2026-11-02", "2026-11-03"]);
  assert.equal(rows[0].metrics.BUSINESS_DIRECTION_REQUESTS, 4);
  assert.equal(rows[1].metrics.BUSINESS_DIRECTION_REQUESTS, 0);
  assert.equal(rows[1].metrics.BUSINESS_IMPRESSIONS_MOBILE_MAPS, 120);
  assert.equal(rows[2].metrics.CALL_CLICKS, 0);
});

test("検索語句は threshold 未満を区別する", () => {
  assert.deepEqual(
    toKeywordRows({
      searchKeywordsCounts: [
        { searchKeyword: "古着 富山", insightsValue: { value: "52" } },
        { searchKeyword: "85store", insightsValue: { threshold: "15" } },
        { insightsValue: { value: "1" } },
      ],
    }),
    [
      { keyword: "古着 富山", impressions: 52, belowThreshold: false },
      { keyword: "85store", impressions: 15, belowThreshold: true },
    ]
  );
});

test("handleInsights: Google 未設定は 503、POST は 405、正常系は Google を叩いて返す", async () => {
  const env = { INSIGHTS_TOKEN: "t" } as never;
  const url = new URL("https://x/v1/insights?from=2026-11-01&to=2026-11-01");
  assert.equal((await handleInsights(req("Bearer t"), env, url)).status, 503);
  assert.equal((await handleInsights(req("Bearer t", "POST"), env, url)).status, 405);

  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const u = String(input);
    calls.push(u);
    if (u.endsWith("/token")) return Response.json({ access_token: "a" });
    return Response.json({
      multiDailyMetricTimeSeries: [
        { dailyMetricTimeSeries: [{ dailyMetric: "WEBSITE_CLICKS", timeSeries: { datedValues: [{ date: { year: 2026, month: 11, day: 1 }, value: "3" }] } }] },
      ],
    });
  }) as typeof fetch;
  try {
    const full = {
      INSIGHTS_TOKEN: "t",
      GOOGLE_CLIENT_ID: "c",
      GOOGLE_CLIENT_SECRET: "s",
      GOOGLE_REFRESH_TOKEN: "r",
      GOOGLE_LOCATION_ID: "123",
      GOOGLE_TOKEN_URL: "http://mock/token",
      GOOGLE_PERFORMANCE_API_BASE: "http://mock",
    } as never;
    const res = await handleInsights(req("Bearer t"), full, url);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { days: { metrics: Record<string, number> }[] };
    assert.equal(body.days[0].metrics.WEBSITE_CLICKS, 3);
    assert.match(calls[1], /^http:\/\/mock\/v1\/locations\/123:fetchMultiDailyMetricsTimeSeries\?dailyMetrics=/);
    assert.match(calls[1], /dailyRange\.start_date\.year=2026/);
  } finally {
    globalThis.fetch = original;
  }
});
