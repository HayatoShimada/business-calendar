// お店のタイムゾーン（環境変数 TIMEZONE、IANA 名。例: Asia/Tokyo）での日付

export const DEFAULT_TIMEZONE = "Asia/Tokyo";

// そのタイムゾーンでの今日（YYYY-MM-DD）
export function todayIn(timeZone: string, now = new Date()): string {
  // en-CA は YYYY-MM-DD 形式で出力される
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return true;
  } catch {
    return false;
  }
}
