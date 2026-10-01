// 営業日カレンダーの画像（SNS 投稿・共有用）をブラウザの canvas で作る ES モジュール
// 管理画面・埋め込み部品・サイトから読み込んで使う:
//   const { renderCalendarImage, shareFiles } = await import("https://calendar.example.com/calendar-image.js");
//   const blob = await renderCalendarImage({ data, month: "2026-10", format: "feed" });
// data は /v1/calendar の応答（その月の days を含むもの）。

export const FORMATS = {
  feed: { width: 1080, height: 1350 }, // 4:5（Instagram のフィード・X）
  story: { width: 1080, height: 1920 }, // 9:16（ストーリーズ）
};

export const DEFAULT_COLORS = {
  bg: "#ffffff",
  ink: "#000000",
  muted: "#62656a",
  rule: "#d9d9d4",
  surface: "#f4f4f1",
  closed: "#ff6b35", // 休業日の面
  onClosed: "#000000",
  hours: "#1f5c45", // 営業時間を変更した日の面
  onHours: "#ffffff",
};

export const DEFAULT_FONTS = {
  sans: '"IBM Plex Sans JP", "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif',
  display: '"Archivo", "Helvetica Neue", Arial, sans-serif',
};

const CAT_PATH = "M6 5 9.5 10C11.5 9.2 13.6 8.8 16 8.8s4.5.4 6.5 1.2L26 5l.6 7.4c2.4 2.2 3.9 4.9 3.9 7.6 0 4-6.5 6-14.5 6S1.5 24 1.5 20c0-2.7 1.5-5.4 3.9-7.6L6 5Z";

const TEXT = {
  ja: {
    weekdays: ["日", "月", "火", "水", "木", "金", "土"],
    kicker: "営業日カレンダー",
    subtitle: (m) => `${m}月の営業日`,
    closed: "お休み",
    hours: "営業時間の変更",
    regular: (o, c) => `営業時間 ${o}〜${c}`,
    note: (m, d, w, text) => `${m}/${d}（${w}）${text}`,
    range: (o, c) => `${o}〜${c}`,
    more: (n) => `ほか ${n} 件`,
  },
  en: {
    weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    kicker: "Business calendar",
    subtitle: (m) => ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1],
    closed: "Closed",
    hours: "Special hours",
    regular: (o, c) => `Regular hours ${o}–${c}`,
    note: (m, d, w, text) => `${w} ${m}/${d}  ${text}`,
    range: (o, c) => `${o}–${c}`,
    more: (n) => `+${n} more`,
  },
};

const pad = (n) => String(n).padStart(2, "0");
const weekdayOf = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();

// その日の営業（例外の日 → 定休曜日 → 通常の順）
export function resolveDay(data, date) {
  const o = data.days[date];
  if (o && o.kind === "closed") return { closed: true, note: o.note };
  if (o && o.kind === "hours") return { closed: false, special: true, opens: o.opens, closes: o.closes, note: o.note };
  if (data.regular.closedWeekdays.includes(weekdayOf(date))) return { closed: true, regular: true };
  return { closed: false, opens: data.regular.opens, closes: data.regular.closes };
}

/**
 * カレンダー画像を作る
 * @param {object} options
 * @param {object} options.data /v1/calendar の応答
 * @param {string} options.month YYYY-MM
 * @param {"feed"|"story"} [options.format]
 * @param {"ja"|"en"} [options.language]
 * @param {string} [options.storeName] 左上に出す店名
 * @param {string} [options.footer] 下に出す文字（URL など）
 * @param {"cat"|"dot"} [options.closedMark] 休業日の印
 * @param {object} [options.colors] DEFAULT_COLORS の一部を上書き
 * @param {object} [options.fonts] { sans, display }（CSS の font-family）
 * @param {string} [options.type] "image/png"（既定）か "image/jpeg"
 * @returns {Promise<Blob>}
 */
export async function renderCalendarImage(options) {
  const { data, month, format = "feed", language = "ja", storeName = "", footer = "", closedMark = "dot", type = "image/png" } = options;
  const t = TEXT[language] || TEXT.ja;
  const colors = { ...DEFAULT_COLORS, ...options.colors };
  const fonts = { ...DEFAULT_FONTS, ...options.fonts };
  const { width: W, height: H } = FORMATS[format] || FORMATS.feed;
  const story = format === "story";
  const [year, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const firstWeekday = new Date(Date.UTC(year, m - 1, 1)).getUTCDay();
  const rows = Math.ceil((firstWeekday + last) / 7);

  // その月の補足（営業時間の変更・メモ）
  const notes = [];
  for (let d = 1; d <= last; d++) {
    const date = `${month}-${pad(d)}`;
    const day = resolveDay(data, date);
    if (!day.special && !day.note) continue;
    const text = [day.closed ? t.closed : day.special ? t.range(day.opens, day.closes) : "", day.note || ""].filter(Boolean).join("  ");
    notes.push(t.note(m, d, t.weekdays[weekdayOf(date)], text));
  }

  // 使う文字を先に読み込む（日本語フォントは文字ごとに分割配信されることがあるため）
  const title = `${year}.${pad(m)}`;
  const sample = [storeName, footer, title, t.kicker, t.subtitle(m), t.closed, t.hours, t.regular(data.regular.opens, data.regular.closes), ...t.weekdays, ...notes, t.more(0), "0123456789:–〜"].join("");
  await loadFonts(fonts, sample);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if ("fontStretch" in ctx) ctx.fontStretch = "normal";
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "alphabetic";

  const X = 72;
  const innerW = W - X * 2;
  const cellW = innerW / 7;
  const titleGap = story ? 200 : 170;
  const weekdayGap = story ? 70 : 56;
  const gridTopRel = 28 + titleGap + weekdayGap + 18; // 店名の行からマスの上端まで

  // 下に置くもの（凡例・補足・フッター）の高さから、マスの高さを決める
  const maxNotes = story ? 7 : 3;
  const noteLines = Math.min(notes.length, maxNotes);
  const safeTop = story ? 230 : 96; // ストーリーズは上下の UI に隠れない範囲に収める
  const bottomPad = story ? 260 : 72;
  const below = 40 + 44 + (noteLines ? 20 + noteLines * 44 : 0) + (footer ? 64 : 0);
  const cellH = Math.min(cellW, (H - bottomPad - below - safeTop - gridTopRel) / rows);
  // ストーリーズは縦に余るので、全体を上下の中央に置く
  const contentH = gridTopRel + rows * cellH + 56 + (noteLines ? 20 + noteLines * 44 : 0) + (footer ? 90 : 0);
  let y = story ? safeTop + Math.max(0, (H - bottomPad - safeTop - contentH) / 2) : safeTop;
  const footerY = story ? y + contentH : H - bottomPad;

  // 見出し: 店名（左）・「営業日カレンダー」（右）・罫線
  ctx.fillStyle = colors.ink;
  setFont(ctx, 800, 44, fonts.display, storeName ? "expanded" : "normal");
  ctx.textAlign = "left";
  fitText(ctx, storeName, X, y, innerW * 0.6);
  setFont(ctx, 600, 28, fonts.sans);
  ctx.fillStyle = colors.muted;
  ctx.textAlign = "right";
  ctx.fillText(t.kicker, W - X, y);
  y += 28;
  ctx.fillStyle = colors.ink;
  ctx.fillRect(X, y, innerW, 3);

  // 年月（大きく）と「10月の営業日」
  y += titleGap;
  ctx.textAlign = "left";
  setFont(ctx, 800, story ? 176 : 150, fonts.display, "expanded");
  fitText(ctx, title, X - 6, y, innerW * 0.68);
  setFont(ctx, 700, 40, fonts.sans);
  ctx.textAlign = "right";
  ctx.fillText(t.subtitle(m), W - X, y - 8);

  // 曜日
  y += weekdayGap;
  setFont(ctx, 600, 26, fonts.sans);
  ctx.fillStyle = colors.muted;
  ctx.textAlign = "center";
  t.weekdays.forEach((w, i) => ctx.fillText(w, X + cellW * i + cellW / 2, y));
  y += 18;
  const gridTop = y;

  for (let i = 0; i < rows * 7; i++) {
    const col = i % 7;
    const row = Math.floor(i / 7);
    const d = i - firstWeekday + 1;
    const cx = X + col * cellW;
    const cy = gridTop + row * cellH;
    if (d < 1 || d > last) {
      ctx.fillStyle = colors.surface;
      ctx.fillRect(cx, cy, cellW, cellH);
      continue;
    }
    const date = `${month}-${pad(d)}`;
    const day = resolveDay(data, date);
    let fg = colors.ink;
    if (day.closed) {
      ctx.fillStyle = colors.closed;
      ctx.fillRect(cx, cy, cellW, cellH);
      fg = colors.onClosed;
    } else if (day.special) {
      ctx.fillStyle = colors.hours;
      ctx.fillRect(cx, cy, cellW, cellH);
      fg = colors.onHours;
    }
    ctx.fillStyle = fg;
    ctx.textAlign = "left";
    setFont(ctx, 700, Math.round(Math.min(36, cellH * 0.32)), fonts.display);
    ctx.fillText(String(d), cx + 14, cy + Math.min(44, cellH * 0.4));
    if (day.closed) {
      drawMark(ctx, closedMark, cx + cellW / 2, cy + cellH * 0.68, Math.min(cellW, cellH) * 0.42, fg);
    } else if (day.special) {
      ctx.textAlign = "center";
      setFont(ctx, 700, Math.round(Math.min(26, cellH * 0.22)), fonts.display);
      ctx.fillText(day.opens, cx + cellW / 2, cy + cellH * 0.66);
      ctx.fillText(`–${day.closes}`, cx + cellW / 2, cy + cellH * 0.66 + Math.min(28, cellH * 0.24));
    }
  }

  // 罫線
  ctx.strokeStyle = colors.rule;
  ctx.lineWidth = 2;
  for (let r = 0; r <= rows; r++) line(ctx, X, gridTop + r * cellH, X + innerW, gridTop + r * cellH);
  for (let c = 0; c <= 7; c++) line(ctx, X + c * cellW, gridTop, X + c * cellW, gridTop + rows * cellH);

  // 凡例と通常の営業時間
  y = gridTop + rows * cellH + 56;
  ctx.textAlign = "left";
  setFont(ctx, 600, 26, fonts.sans);
  let lx = X;
  for (const [fill, fg, label, mark] of [
    [colors.closed, colors.onClosed, t.closed, true],
    [colors.hours, colors.onHours, t.hours, false],
  ]) {
    ctx.fillStyle = fill;
    ctx.fillRect(lx, y - 28, 36, 36);
    if (mark) drawMark(ctx, closedMark, lx + 18, y - 9, 26, fg);
    ctx.fillStyle = colors.ink;
    ctx.fillText(label, lx + 48, y);
    lx += 48 + ctx.measureText(label).width + 40;
  }
  ctx.textAlign = "right";
  ctx.fillStyle = colors.muted;
  ctx.fillText(t.regular(data.regular.opens, data.regular.closes), W - X, y);

  // 補足（営業時間の変更・メモ）
  if (noteLines) {
    y += 20;
    ctx.textAlign = "left";
    setFont(ctx, 400, 28, fonts.sans);
    ctx.fillStyle = colors.ink;
    const shown = notes.length > maxNotes ? notes.slice(0, maxNotes - 1) : notes;
    for (const note of shown) {
      y += 44;
      fitText(ctx, note, X, y, innerW);
    }
    if (notes.length > maxNotes) {
      y += 44;
      ctx.fillStyle = colors.muted;
      ctx.fillText(t.more(notes.length - shown.length), X, y);
    }
  }

  // フッター（URL など）
  if (footer) {
    ctx.textAlign = "left";
    ctx.fillStyle = colors.ink;
    setFont(ctx, 700, 30, fonts.display);
    fitText(ctx, footer, X, footerY, innerW);
  }

  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))), type, 0.92)
  );
}

function setFont(ctx, weight, size, family, stretch = "normal") {
  ctx.font = `${weight} ${size}px ${family}`;
  if ("fontStretch" in ctx) ctx.fontStretch = stretch;
}

// 幅に収まるように文字を小さくして描く
function fitText(ctx, text, x, y, maxWidth) {
  if (!text) return;
  const match = ctx.font.match(/(\d+)px/);
  let size = match ? Number(match[1]) : 16;
  while (ctx.measureText(text).width > maxWidth && size > 12) {
    size -= 2;
    ctx.font = ctx.font.replace(/\d+px/, `${size}px`);
  }
  ctx.fillText(text, x, y);
}

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function drawMark(ctx, mark, cx, cy, size, color) {
  ctx.save();
  ctx.fillStyle = color;
  if (mark === "cat" && typeof Path2D === "function") {
    const scale = size / 32;
    ctx.translate(cx - 16 * scale, cy - 13 * scale);
    ctx.scale(scale, scale);
    ctx.fill(new Path2D(CAT_PATH));
  } else {
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

async function loadFonts(fonts, text) {
  if (!document.fonts || !document.fonts.load) return;
  const specs = [`800 150px ${fonts.display}`, `700 36px ${fonts.display}`, `700 40px ${fonts.sans}`, `600 26px ${fonts.sans}`, `400 28px ${fonts.sans}`];
  await Promise.all(specs.map((spec) => document.fonts.load(spec, text).catch(() => [])));
}

// ---- 共有 ----

// ファイルを共有できるか（iOS / Android / 対応しているデスクトップのブラウザ）
export function canShareFiles(files) {
  try {
    return typeof navigator.canShare === "function" && navigator.canShare({ files });
  } catch {
    return false;
  }
}

/**
 * OS の共有シートで共有する（iOS: 共有シート / Android: Sharesheet / Web: Web Share API）
 * @returns {Promise<"shared"|"cancelled"|"unsupported">}
 */
export async function shareFiles({ files, text, title, url }) {
  const data = { files, ...(title && { title }), ...(text && { text }), ...(url && { url }) };
  if (!canShareFiles(files)) return "unsupported";
  try {
    await navigator.share(data);
    return "shared";
  } catch (error) {
    if (error && error.name === "AbortError") return "cancelled";
    // 画像の準備に時間がかかり、タップ直後の扱いでなくなったときなど
    if (error && error.name === "NotAllowedError") return "unsupported";
    throw error;
  }
}

export function toFile(blob, name) {
  return new File([blob], name, { type: blob.type });
}

// 画像を保存（共有シートが使えないブラウザ向け）
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// 画像をクリップボードにコピー（PNG のみ）
export async function copyImage(blob) {
  if (!navigator.clipboard || typeof ClipboardItem !== "function") return false;
  try {
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    return true;
  } catch {
    return false;
  }
}
