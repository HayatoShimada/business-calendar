// 営業日データの型・検証・D1 の読み書き
import type { Messages } from "./i18n";
import { addDays, todayIn } from "./time";

export type DayOverride =
  | { kind: "closed"; note?: string }
  | { kind: "hours"; opens: string; closes: string; note?: string };

export interface Regular {
  opens: string;
  closes: string;
  closedWeekdays: number[]; // 0=日曜 … 6=土曜
}

export interface CalendarResponse {
  regular: Regular;
  days: Record<string, DayOverride>;
  updatedAt: string;
  timezone?: string; // お店のタイムゾーン（公開APIで返す）
}

export class ValidationError extends Error {}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const NOTE_MAX = 100;
const MAX_RANGE_DAYS = 400;

export function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function assertTime(value: unknown, label: string, m: Messages): string {
  if (typeof value !== "string" || !TIME_RE.test(value)) {
    throw new ValidationError(m.timeFormat(label));
  }
  return value;
}

function assertHours(opens: unknown, closes: unknown, m: Messages): { opens: string; closes: string } {
  const o = assertTime(opens, m.opensLabel, m);
  const c = assertTime(closes, m.closesLabel, m);
  if (o >= c) throw new ValidationError(m.closesAfterOpens);
  return { opens: o, closes: c };
}

function assertNote(note: unknown, m: Messages): string | undefined {
  if (note === undefined || note === null || note === "") return undefined;
  if (typeof note !== "string") throw new ValidationError(m.noteType);
  const trimmed = note.trim();
  if (trimmed.length > NOTE_MAX) throw new ValidationError(m.noteLength(NOTE_MAX));
  return trimmed || undefined;
}

export function parseDayOverride(body: unknown, m: Messages): DayOverride {
  const input = (body ?? {}) as Record<string, unknown>;
  const note = assertNote(input.note, m);
  if (input.kind === "closed") return { kind: "closed", ...(note && { note }) };
  if (input.kind === "hours") return { kind: "hours", ...assertHours(input.opens, input.closes, m), ...(note && { note }) };
  throw new ValidationError(m.kind);
}

export function parseRegular(body: unknown, m: Messages): Regular {
  const input = (body ?? {}) as Record<string, unknown>;
  const weekdays = input.closedWeekdays;
  if (!Array.isArray(weekdays) || !weekdays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) {
    throw new ValidationError(m.weekdays);
  }
  return { ...assertHours(input.opens, input.closes, m), closedWeekdays: [...new Set(weekdays as number[])].sort() };
}

// 取得範囲。指定がなければ「お店のタイムゾーンでの今日の7日前〜120日後」
export function parseRange(url: URL, timeZone: string, m: Messages): { from: string; to: string } {
  const today = todayIn(timeZone);
  const from = url.searchParams.get("from") ?? addDays(today, -7);
  const to = url.searchParams.get("to") ?? addDays(today, 120);
  if (!isValidDate(from) || !isValidDate(to)) throw new ValidationError(m.rangeFormat);
  if (from > to) throw new ValidationError(m.rangeOrder);
  const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (span > MAX_RANGE_DAYS) throw new ValidationError(m.rangeLength(MAX_RANGE_DAYS));
  return { from, to };
}

interface SettingsRow {
  opens: string;
  closes: string;
  closed_weekdays: string;
  updated_at: string;
}

interface DayRow {
  date: string;
  kind: "closed" | "hours";
  opens: string | null;
  closes: string | null;
  note: string | null;
  updated_at: string;
}

export async function readCalendar(db: D1Database, from: string, to: string): Promise<CalendarResponse> {
  const [settingsResult, daysResult] = await db.batch([
    db.prepare("SELECT opens, closes, closed_weekdays, updated_at FROM settings WHERE id = 1"),
    db.prepare("SELECT date, kind, opens, closes, note, updated_at FROM days WHERE date BETWEEN ? AND ? ORDER BY date").bind(from, to),
  ]);
  const settings = (settingsResult.results as unknown as SettingsRow[])[0];
  if (!settings) throw new Error("settings row is missing (run the D1 migration)");

  let updatedAt = settings.updated_at;
  const days: Record<string, DayOverride> = {};
  for (const row of daysResult.results as unknown as DayRow[]) {
    const note = row.note ?? undefined;
    days[row.date] =
      row.kind === "closed"
        ? { kind: "closed", ...(note && { note }) }
        : { kind: "hours", opens: row.opens ?? "", closes: row.closes ?? "", ...(note && { note }) };
    if (row.updated_at > updatedAt) updatedAt = row.updated_at;
  }

  return {
    regular: { opens: settings.opens, closes: settings.closes, closedWeekdays: JSON.parse(settings.closed_weekdays) },
    days,
    updatedAt,
  };
}

// 変更は changes にも記録する（お知らせ文を作るため）
export async function upsertDay(db: D1Database, date: string, day: DayOverride, by: string): Promise<void> {
  const now = new Date().toISOString();
  const opens = day.kind === "hours" ? day.opens : null;
  const closes = day.kind === "hours" ? day.closes : null;
  const note = day.note ?? null;
  await db.batch([
    // 内容が変わるときだけ記録する（保存し直しただけの日をお知らせに出さない）
    db
      .prepare(
        `INSERT INTO changes (target, date, kind, opens, closes, note, changed_at, changed_by)
         SELECT 'day', ?1, ?2, ?3, ?4, ?5, ?6, ?7
         WHERE NOT EXISTS (SELECT 1 FROM days WHERE date = ?1 AND kind = ?2 AND opens IS ?3 AND closes IS ?4 AND note IS ?5)`
      )
      .bind(date, day.kind, opens, closes, note, now, by),
    db
      .prepare(
        `INSERT INTO days (date, kind, opens, closes, note, updated_at, updated_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(date) DO UPDATE SET kind = ?2, opens = ?3, closes = ?4, note = ?5, updated_at = ?6, updated_by = ?7`
      )
      .bind(date, day.kind, opens, closes, note, now, by),
  ]);
}

export async function deleteDay(db: D1Database, date: string, by: string): Promise<void> {
  await db.batch([
    // 設定がある日を戻したときだけ記録する
    db
      .prepare(
        `INSERT INTO changes (target, date, kind, changed_at, changed_by)
         SELECT 'day', ?1, 'default', ?2, ?3 WHERE EXISTS (SELECT 1 FROM days WHERE date = ?1)`
      )
      .bind(date, new Date().toISOString(), by),
    db.prepare("DELETE FROM days WHERE date = ?").bind(date),
  ]);
}

export async function updateRegular(db: D1Database, regular: Regular, by: string): Promise<void> {
  const now = new Date().toISOString();
  const weekdays = JSON.stringify(regular.closedWeekdays);
  await db.batch([
    db
      .prepare(
        `INSERT INTO changes (target, opens, closes, closed_weekdays, changed_at, changed_by)
         SELECT 'regular', ?1, ?2, ?3, ?4, ?5
         WHERE NOT EXISTS (SELECT 1 FROM settings WHERE id = 1 AND opens = ?1 AND closes = ?2 AND closed_weekdays = ?3)`
      )
      .bind(regular.opens, regular.closes, weekdays, now, by),
    db
      .prepare("UPDATE settings SET opens = ?, closes = ?, closed_weekdays = ?, updated_at = ?, updated_by = ? WHERE id = 1")
      .bind(regular.opens, regular.closes, weekdays, now, by),
  ]);
}

export interface ChangeRow {
  id: number;
  target: "day" | "regular";
  date: string | null;
  kind: "closed" | "hours" | "default" | null;
  opens: string | null;
  closes: string | null;
  note: string | null;
  closed_weekdays: string | null;
}

// まだお知らせしていない変更（古い順）
export async function readPendingChanges(db: D1Database): Promise<ChangeRow[]> {
  const { results } = await db
    .prepare("SELECT id, target, date, kind, opens, closes, note, closed_weekdays FROM changes WHERE announced_at IS NULL ORDER BY id")
    .all<ChangeRow>();
  return results;
}

// uptoId までの変更をお知らせ済みにする
export async function markAnnounced(db: D1Database, uptoId: number): Promise<void> {
  await db.prepare("UPDATE changes SET announced_at = ? WHERE announced_at IS NULL AND id <= ?").bind(new Date().toISOString(), uptoId).run();
}
