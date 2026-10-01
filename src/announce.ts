// SNS などに投稿するお知らせ文を作る（管理画面で確認・修正してから共有する）
import type { CalendarResponse, ChangeRow, Regular } from "./calendar";
import type { Language } from "./i18n";

export interface AnnounceOptions {
  language: Language;
  storeName?: string;
  shareUrl?: string;
  today: string; // お店のタイムゾーンでの今日（YYYY-MM-DD）
}

export interface AnnouncementDraft {
  mode: "changes" | "month";
  text: string;
  // お知らせ済みにするときに渡す（変更のお知らせのとき）
  uptoId: number | null;
  // 画像にする月（YYYY-MM）。最初のものを初期表示にする
  months: string[];
}

const WEEKDAYS = {
  ja: ["日", "月", "火", "水", "木", "金", "土"],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
};
const WEEKDAYS_LONG_EN = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const partsOf = (date: string) => date.split("-").map(Number) as [number, number, number];

function dayLabel(date: string, language: Language): string {
  const [, m, d] = partsOf(date);
  const w = WEEKDAYS[language][weekdayOf(date)];
  return language === "en" ? `${w}, ${MONTHS_EN[m - 1]} ${d}` : `${m}/${d}（${w}）`;
}

const range = (opens: string, closes: string, language: Language) => (language === "en" ? `${opens}–${closes}` : `${opens}〜${closes}`);
const withNote = (text: string, note: string | null | undefined, language: Language) =>
  note ? (language === "en" ? `${text} (${note})` : `${text}（${note}）`) : text;

function regularLine(regular: Regular, language: Language): string {
  const hours = range(regular.opens, regular.closes, language);
  const days = [...regular.closedWeekdays].sort((a, b) => a - b);
  if (language === "en") {
    const closed = days.length ? `closed on ${days.map((d) => WEEKDAYS_LONG_EN[d]).join(", ")}` : "open every day";
    return `Regular hours are now ${hours}, ${closed}`;
  }
  const closed = days.length ? `定休日は${days.map((d) => WEEKDAYS.ja[d]).join("・")}曜` : "定休日なし";
  return `通常の営業時間を ${hours}（${closed}）に変更しました`;
}

function header(storeName: string | undefined, title: string, language: Language): string {
  if (language === "en") return storeName ? `${storeName}: ${title}` : title;
  return storeName ? `【${storeName} ${title}】` : `【${title}】`;
}

function footer(shareUrl: string | undefined, language: Language): string[] {
  if (!shareUrl) return [];
  return ["", language === "en" ? `Latest hours: ${shareUrl}` : `最新の営業日はこちら\n${shareUrl}`];
}

const monthKey = (date: string) => date.slice(0, 7);

// まだお知らせしていない変更から文面を作る。今日より前の日付は除く。同じ日を何度も変えたときは最後の内容だけ
export function composeChanges(changes: ChangeRow[], regular: Regular, options: AnnounceOptions): AnnouncementDraft | null {
  const { language, today } = options;
  const latestByDate = new Map<string, ChangeRow>();
  let regularChange: ChangeRow | null = null;
  for (const change of changes) {
    if (change.target === "regular") regularChange = change;
    else if (change.date && change.date >= today) latestByDate.set(change.date, change);
  }
  if (latestByDate.size === 0 && !regularChange) return null;

  const lines: string[] = [];
  for (const [date, change] of [...latestByDate].sort(([a], [b]) => a.localeCompare(b))) {
    const label = dayLabel(date, language);
    let text: string;
    if (change.kind === "closed") {
      text = language === "en" ? `${label}: closed` : `${label}お休み`;
    } else if (change.kind === "hours") {
      const hours = range(change.opens ?? "", change.closes ?? "", language);
      text = language === "en" ? `${label}: open ${hours}` : `${label}${hours} で営業`;
    } else if (regular.closedWeekdays.includes(weekdayOf(date))) {
      // 通常どおりに戻した日が定休曜日なら「定休日」
      text = language === "en" ? `${label}: closed (regular holiday)` : `${label}定休日`;
    } else {
      const hours = range(regular.opens, regular.closes, language);
      text = language === "en" ? `${label}: regular hours ${hours}` : `${label}通常どおり ${hours} で営業`;
    }
    lines.push(`${language === "en" ? "• " : "・"}${withNote(text, change.kind === "default" ? null : change.note, language)}`);
  }
  if (regularChange) {
    const updated: Regular = {
      opens: regularChange.opens ?? regular.opens,
      closes: regularChange.closes ?? regular.closes,
      closedWeekdays: regularChange.closed_weekdays ? JSON.parse(regularChange.closed_weekdays) : regular.closedWeekdays,
    };
    lines.push(`${language === "en" ? "• " : "・"}${regularLine(updated, language)}`);
  }

  const months = [...new Set([...latestByDate.keys()].sort().map(monthKey))];
  if (months.length === 0) months.push(monthKey(today));
  return {
    mode: "changes",
    text: [header(options.storeName, language === "en" ? "Schedule update" : "営業日のお知らせ", language), ...lines, ...footer(options.shareUrl, language)].join("\n"),
    uptoId: changes.length ? changes[changes.length - 1].id : null,
    months,
  };
}

// 月ごとのお知らせ（その月のお休み・営業時間の変更をまとめる）
export function composeMonth(month: string, calendar: CalendarResponse, options: AnnounceOptions): AnnouncementDraft {
  const { language } = options;
  const [year, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const closed: number[] = [];
  const special: string[] = [];
  for (let d = 1; d <= last; d++) {
    const date = `${month}-${String(d).padStart(2, "0")}`;
    const override = calendar.days[date];
    if (override?.kind === "closed" || (!override && calendar.regular.closedWeekdays.includes(weekdayOf(date)))) {
      closed.push(d);
    } else if (override?.kind === "hours") {
      const hours = range(override.opens, override.closes, language);
      special.push(withNote(language === "en" ? `${MONTHS_EN[m - 1]} ${d} ${hours}` : `${d}日 ${hours}`, override.note, language));
    }
  }

  const lines: string[] = [];
  const hours = range(calendar.regular.opens, calendar.regular.closes, language);
  if (language === "en") {
    lines.push(`Closed: ${closed.length ? `${MONTHS_EN[m - 1]} ${closed.join(", ")}` : "none"}`);
    if (special.length) lines.push(`Special hours: ${special.join(", ")}`);
    lines.push(`Regular hours: ${hours}`);
  } else {
    lines.push(`お休み：${closed.length ? `${closed.join("・")}日` : "なし"}`);
    if (special.length) lines.push(`営業時間の変更：${special.join("、")}`);
    lines.push(`営業時間：${hours}`);
  }

  const title = language === "en" ? `${MONTHS_LONG_EN[m - 1]} hours` : `${m}月の営業日`;
  return {
    mode: "month",
    text: [header(options.storeName, title, language), ...lines, ...footer(options.shareUrl, language)].join("\n"),
    uptoId: null,
    months: [month],
  };
}
