import adminHtml from "./admin.html";
import widgetJs from "./widget.embed.js";
import { AccessError, requireAdmin, type AccessEnv } from "./access";
import { readSyncStatus, syncToGoogle, type GoogleEnv } from "./google";
import { getMessages, type Messages } from "./i18n";
import { DEFAULT_TIMEZONE } from "./time";
import {
  ValidationError,
  deleteDay,
  isValidDate,
  parseDayOverride,
  parseRange,
  parseRegular,
  readCalendar,
  upsertDay,
  updateRegular,
} from "./calendar";

interface Env extends AccessEnv, GoogleEnv {
  DB: D1Database;
  ADMIN_HOST: string;
  TIMEZONE?: string; // お店のタイムゾーン（IANA 名）。既定は Asia/Tokyo
  LANGUAGE?: string; // 管理画面とメッセージの言語（ja / en）。既定は ja
  STORE_NAME?: string; // 管理画面の見出しに出す店名
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...init.headers },
  });

// 営業日は公開情報なので、どのサイト（本番・プレビュー・ローカル）からでも読めるようにする
const PUBLIC_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

// 管理画面の基本的なセキュリティヘッダー
const ADMIN_HTML_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; frame-ancestors 'none'",
};

const timeZoneOf = (env: Env) => env.TIMEZONE || DEFAULT_TIMEZONE;

async function handlePublic(request: Request, env: Env, url: URL, m: Messages): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: PUBLIC_HEADERS });
  if (request.method !== "GET") return json({ error: "Method Not Allowed" }, { status: 405, headers: { ...PUBLIC_HEADERS, Allow: "GET" } });
  const timezone = timeZoneOf(env);
  const { from, to } = parseRange(url, timezone, m);
  return json({ ...(await readCalendar(env.DB, from, to)), timezone }, { headers: PUBLIC_HEADERS });
}

// サイトに埋め込むカレンダー・営業状況の部品（Web Components）
function handleWidget(request: Request): Response {
  if (request.method !== "GET") return json({ error: "Method Not Allowed" }, { status: 405 });
  return new Response(widgetJs, {
    headers: {
      ...PUBLIC_HEADERS,
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}

async function handleAdmin(request: Request, env: Env, url: URL, ctx: ExecutionContext, m: Messages): Promise<Response> {
  const email = await requireAdmin(request, env);

  if (url.pathname === "/" && request.method === "GET") {
    // 言語・タイムゾーン・店名を管理画面に渡す
    const config = JSON.stringify({ language: env.LANGUAGE === "en" ? "en" : "ja", timezone: timeZoneOf(env), storeName: env.STORE_NAME || "" });
    const html = adminHtml
      .replace("__LANG__", env.LANGUAGE === "en" ? "en" : "ja")
      .replace("/*__CONFIG__*/null", config.replace(/</g, "\\u003c"));
    return new Response(html, { headers: ADMIN_HTML_HEADERS });
  }

  // 書き込みは同じオリジンの JSON リクエストだけを受け付ける（CSRF対策）
  if (request.method !== "GET") {
    if (request.headers.get("Origin") !== `https://${env.ADMIN_HOST}` && request.headers.get("Origin") !== url.origin) {
      return json({ error: "Forbidden origin" }, { status: 403 });
    }
    if (!request.headers.get("Content-Type")?.includes("application/json") && request.method !== "DELETE") {
      return json({ error: "Content-Type must be application/json" }, { status: 415 });
    }
  }

  if (url.pathname === "/api/me" && request.method === "GET") {
    return json({ email });
  }

  if (url.pathname === "/api/calendar" && request.method === "GET") {
    const { from, to } = parseRange(url, timeZoneOf(env), m);
    return json(await readCalendar(env.DB, from, to));
  }

  if (url.pathname === "/api/sync-status" && request.method === "GET") {
    return json(await readSyncStatus(env));
  }

  // Googleマップへの反映をやり直す（結果を待って返す）
  if (url.pathname === "/api/sync" && request.method === "POST") {
    return json(await syncToGoogle(env));
  }

  // 保存のたびに、応答を返したあとで Googleマップにも反映する（未設定なら何もしない）
  const syncLater = () => ctx.waitUntil(syncToGoogle(env));

  if (url.pathname === "/api/settings" && request.method === "PUT") {
    await updateRegular(env.DB, parseRegular(await request.json(), m), email);
    syncLater();
    return json({ ok: true });
  }

  const dayMatch = url.pathname.match(/^\/api\/days\/(\d{4}-\d{2}-\d{2})$/);
  if (dayMatch) {
    const date = dayMatch[1];
    if (!isValidDate(date)) return json({ error: m.invalidDate }, { status: 400 });
    if (request.method === "PUT") {
      await upsertDay(env.DB, date, parseDayOverride(await request.json(), m), email);
      syncLater();
      return json({ ok: true });
    }
    if (request.method === "DELETE") {
      await deleteDay(env.DB, date);
      syncLater();
      return json({ ok: true });
    }
  }

  return json({ error: "Not Found" }, { status: 404 });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const m = getMessages(env.LANGUAGE);
    try {
      // 公開の読み取りAPIと埋め込み部品はどのホストでも同じ（管理ホストでも読める）
      if (url.pathname === "/v1/calendar") return await handlePublic(request, env, url, m);
      if (url.pathname === "/widget.js") return handleWidget(request);
      // 管理画面・書き込みAPIは管理ホストだけで提供する
      if (url.hostname === env.ADMIN_HOST) return await handleAdmin(request, env, url, ctx, m);
      return json({ error: "Not Found" }, { status: 404 });
    } catch (error) {
      if (error instanceof AccessError) return json({ error: error.message }, { status: error.status });
      if (error instanceof ValidationError) return json({ error: error.message }, { status: 400 });
      if (error instanceof SyntaxError) return json({ error: m.invalidJson }, { status: 400 });
      console.error(error);
      return json({ error: "Internal Server Error" }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
