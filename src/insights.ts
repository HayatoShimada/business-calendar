import { getAccessToken, isGoogleConfigured, type GoogleEnv } from "./google";
import { isValidDate } from "./calendar";

// Googleビジネスプロフィールの数値（表示回数・ルート検索・電話・Webクリック・検索語句）を、
// サーバー間でだけ読めるようにする（例: 店の CRM が毎日取り込んで、施策の効果を測る）。
//
// - INSIGHTS_TOKEN（secret）を `Authorization: Bearer` で送ったときだけ答える。未設定なら 404（機能ごと無効）
// - ブラウザから読ませるものではないので CORS ヘッダーは付けない
// - Google Cloud で「Business Profile Performance API」を有効にしておく（スコープは既存の business.manage で足りる）

export interface InsightsEnv extends GoogleEnv {
  INSIGHTS_TOKEN?: string;
  // テスト用: Performance API のエンドポイントを差し替える
  GOOGLE_PERFORMANCE_API_BASE?: string;
}

// 取得する日次指標（Performance API の DailyMetric）
export const DAILY_METRICS = [
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
  "BUSINESS_DIRECTION_REQUESTS",
  "CALL_CLICKS",
  "WEBSITE_CLICKS",
] as const;

// 一度に読める日数（Google 側の上限より十分小さく、取り込みの用途には足りる）
export const MAX_INSIGHTS_DAYS = 120;
// 検索語句の読み込みページ数の上限（1ページ100語）
const MAX_KEYWORD_PAGES = 5;

export class InsightsError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

// 長さが違っても所要時間が変わらない比較（トークンを1文字ずつ当てられないようにする）
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// 認証。機能が無効なら 404、トークン違いは 401
export function checkInsightsAuth(request: Request, env: InsightsEnv): void {
  if (!env.INSIGHTS_TOKEN) throw new InsightsError("Not Found", 404);
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !safeEqual(token, env.INSIGHTS_TOKEN)) throw new InsightsError("Unauthorized", 401);
}

const dateParts = (ymd: string) => {
  const [year, month, day] = ymd.split("-").map(Number);
  return { year, month, day };
};

const pad = (n: number) => String(n).padStart(2, "0");

export function parseInsightsRange(url: URL): { from: string; to: string } {
  const from = url.searchParams.get("from") || "";
  const to = url.searchParams.get("to") || "";
  if (!isValidDate(from) || !isValidDate(to)) throw new InsightsError("from and to must be YYYY-MM-DD", 400);
  if (from > to) throw new InsightsError("from must be on or before to", 400);
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1;
  if (days > MAX_INSIGHTS_DAYS) throw new InsightsError(`range must be at most ${MAX_INSIGHTS_DAYS} days`, 400);
  return { from, to };
}

interface DatedValue {
  date?: { year?: number; month?: number; day?: number };
  value?: string;
}
interface MultiDailyResponse {
  multiDailyMetricTimeSeries?: {
    dailyMetricTimeSeries?: { dailyMetric?: string; timeSeries?: { datedValues?: DatedValue[] } }[];
  }[];
}

// Performance API の応答を「日付 → 指標 → 値」に並べ替える。値が無い日は 0（Google は 0 を省く）
export function toDailyRows(body: MultiDailyResponse, from: string, to: string) {
  const byDate = new Map<string, Record<string, number>>();
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86400000) {
    byDate.set(new Date(t).toISOString().slice(0, 10), Object.fromEntries(DAILY_METRICS.map((m) => [m, 0])));
  }
  for (const group of body.multiDailyMetricTimeSeries ?? []) {
    for (const series of group.dailyMetricTimeSeries ?? []) {
      if (!series.dailyMetric) continue;
      for (const dv of series.timeSeries?.datedValues ?? []) {
        const d = dv.date;
        if (!d?.year || !d.month || !d.day) continue;
        const row = byDate.get(`${d.year}-${pad(d.month)}-${pad(d.day)}`);
        if (row) row[series.dailyMetric] = Number(dv.value ?? 0) || 0;
      }
    }
  }
  return [...byDate.entries()].map(([date, metrics]) => ({ date, metrics }));
}

async function googleGet(env: InsightsEnv, path: string, params: URLSearchParams): Promise<unknown> {
  const accessToken = await getAccessToken(env);
  const base = env.GOOGLE_PERFORMANCE_API_BASE || "https://businessprofileperformance.googleapis.com";
  const response = await fetch(`${base}/v1/locations/${env.GOOGLE_LOCATION_ID}${path}?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new InsightsError(`Google Performance API ${response.status}: ${detail}`, 502);
  }
  return response.json();
}

export async function fetchDailyMetrics(env: InsightsEnv, from: string, to: string) {
  const params = new URLSearchParams();
  for (const m of DAILY_METRICS) params.append("dailyMetrics", m);
  const [s, e] = [dateParts(from), dateParts(to)];
  params.set("dailyRange.start_date.year", String(s.year));
  params.set("dailyRange.start_date.month", String(s.month));
  params.set("dailyRange.start_date.day", String(s.day));
  params.set("dailyRange.end_date.year", String(e.year));
  params.set("dailyRange.end_date.month", String(e.month));
  params.set("dailyRange.end_date.day", String(e.day));
  const body = (await googleGet(env, ":fetchMultiDailyMetricsTimeSeries", params)) as MultiDailyResponse;
  return toDailyRows(body, from, to);
}

interface KeywordsResponse {
  searchKeywordsCounts?: { searchKeyword?: string; insightsValue?: { value?: string; threshold?: string } }[];
  nextPageToken?: string;
}

// 検索語句は月単位。表示が少ない語は値の代わりに「threshold 未満」とだけ返ってくる
export function toKeywordRows(body: KeywordsResponse) {
  return (body.searchKeywordsCounts ?? [])
    .filter((k) => k.searchKeyword)
    .map((k) => {
      const v = k.insightsValue ?? {};
      return v.value !== undefined
        ? { keyword: k.searchKeyword!, impressions: Number(v.value) || 0, belowThreshold: false }
        : { keyword: k.searchKeyword!, impressions: Number(v.threshold ?? 0) || 0, belowThreshold: true };
    });
}

export async function fetchSearchKeywords(env: InsightsEnv, month: string) {
  const [year, mon] = month.split("-").map(Number);
  const rows: ReturnType<typeof toKeywordRows> = [];
  let pageToken = "";
  for (let page = 0; page < MAX_KEYWORD_PAGES; page++) {
    const params = new URLSearchParams({
      "monthlyRange.start_month.year": String(year),
      "monthlyRange.start_month.month": String(mon),
      "monthlyRange.end_month.year": String(year),
      "monthlyRange.end_month.month": String(mon),
      pageSize: "100",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const body = (await googleGet(env, "/searchkeywords/impressions/monthly", params)) as KeywordsResponse;
    rows.push(...toKeywordRows(body));
    if (!body.nextPageToken) break;
    pageToken = body.nextPageToken;
  }
  return rows;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

// GET /v1/insights?from=&to= と GET /v1/insights/keywords?month=YYYY-MM
export async function handleInsights(request: Request, env: InsightsEnv, url: URL): Promise<Response> {
  try {
    checkInsightsAuth(request, env);
    if (request.method !== "GET") return json({ error: "Method Not Allowed" }, 405);
    if (!isGoogleConfigured(env)) throw new InsightsError("Google is not configured", 503);
    if (url.pathname === "/v1/insights") {
      const { from, to } = parseInsightsRange(url);
      return json({ from, to, metrics: DAILY_METRICS, days: await fetchDailyMetrics(env, from, to) });
    }
    if (url.pathname === "/v1/insights/keywords") {
      const month = url.searchParams.get("month") || "";
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new InsightsError("month must be YYYY-MM", 400);
      return json({ month, keywords: await fetchSearchKeywords(env, month) });
    }
    return json({ error: "Not Found" }, 404);
  } catch (error) {
    if (error instanceof InsightsError) return json({ error: error.message }, error.status);
    // トークン交換の失敗など
    console.error("insights failed:", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 502);
  }
}
