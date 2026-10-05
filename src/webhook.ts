// 保存のたびに、外部（サイトなど）に変更を知らせる（任意）。WEBHOOK_URL と WEBHOOK_SECRET が無ければ何もしない。
// サイトがカレンダーをサーバー側でキャッシュしているとき（AI・検索向けの構造化データなど）に、すぐ取り直してもらうため。
// 本文は JSON（WEBHOOK_BODY の内容 + event・updatedAt）、署名は本文の HMAC-SHA256（16進）を
// WEBHOOK_SIGNATURE_HEADER（既定 x-signature）に入れる。
export interface WebhookEnv {
  WEBHOOK_URL?: string;
  WEBHOOK_SECRET?: string;
  WEBHOOK_SIGNATURE_HEADER?: string;
  WEBHOOK_BODY?: string; // 本文に足す JSON（例: {"api":"business-calendar"}）
}

export function isWebhookConfigured(env: WebhookEnv): boolean {
  return !!(env.WEBHOOK_URL && env.WEBHOOK_SECRET);
}

export async function sign(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function notifyWebhook(env: WebhookEnv, now = new Date()): Promise<void> {
  if (!isWebhookConfigured(env)) return;
  const extra = env.WEBHOOK_BODY ? (JSON.parse(env.WEBHOOK_BODY) as Record<string, unknown>) : {};
  const body = JSON.stringify({ ...extra, event: "calendar.updated", updatedAt: now.toISOString() });
  try {
    const response = await fetch(env.WEBHOOK_URL!, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [env.WEBHOOK_SIGNATURE_HEADER || "x-signature"]: await sign(body, env.WEBHOOK_SECRET!),
      },
      body,
    });
    if (!response.ok) console.error(`webhook: ${response.status} ${await response.text()}`);
  } catch (error) {
    // 知らせられなくても保存は済んでいる（サイトは自分のキャッシュの期限で取り直す）
    console.error("webhook:", error);
  }
}
