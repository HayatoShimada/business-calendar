// Business Calendar 埋め込み部品（Web Components）
// どんなサイトでも script タグ1つで使える:
//   <script src="https://calendar.example.com/widget.js" defer></script>
//   <business-status></business-status>
//   <business-calendar months="2"></business-calendar>
// データは同じ Worker の /v1/calendar から読み、60秒ごと・タブに戻ったときに更新する。
(() => {
  if (customElements.get("business-calendar")) return;

  const SCRIPT_ORIGIN = (() => {
    try {
      return new URL(document.currentScript.src).origin;
    } catch {
      return "";
    }
  })();
  const REFRESH_MS = 60_000;

  const I18N = {
    ja: {
      weekdays: ["日", "月", "火", "水", "木", "金", "土"],
      caption: (y, m) => `${y}年${m}月`,
      open: (c) => `営業中　${c}まで`,
      before: (o) => `本日 ${o} オープン`,
      after: "本日の営業は終了しました",
      regularClosed: "本日は定休日です",
      closed: "本日はお休みです",
      hours: (o, c) => `${o}〜${c}`,
      cellClosed: "お休み",
      cellOpen: "営業",
      legendClosed: "お休み",
      legendHours: "時刻の表示がある日は営業時間が変わります",
      loading: "営業時間を読み込んでいます",
      share: "カレンダーを共有",
      shareText: (name) => (name ? `${name}の営業日カレンダー` : "営業日カレンダー"),
      saved: "画像を保存し、リンクをコピーしました",
      dayLabel: (m, d, w) => `${m}月${d}日（${w}）`,
      noteSep: "、",
      listItem: (m, d, text) => `${m}/${d} ${text}`,
    },
    en: {
      weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
      caption: (y, m) => new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { year: "numeric", month: "long", timeZone: "UTC" }),
      open: (c) => `Open now · until ${c}`,
      before: (o) => `Opens today at ${o}`,
      after: "Closed for today",
      regularClosed: "Closed today (regular holiday)",
      closed: "Closed today",
      hours: (o, c) => `${o}–${c}`,
      cellClosed: "Closed",
      cellOpen: "Open",
      legendClosed: "Closed",
      legendHours: "Days with a time have special hours",
      loading: "Loading opening hours",
      share: "Share calendar",
      shareText: (name) => (name ? `${name} opening calendar` : "Opening calendar"),
      saved: "Image saved and link copied",
      dayLabel: (m, d, w) => `${w}, ${m}/${d}`,
      noteSep: ", ",
      listItem: (m, d, text) => `${m}/${d} ${text}`,
    },
  };

  // ---- データの取得（API ごとに1つ、ページ内の部品で共有）----
  const stores = new Map();

  function getStore(apiBase) {
    let store = stores.get(apiBase);
    if (store) return store;
    store = { data: null, listeners: new Set(), timer: null };
    const refresh = async () => {
      try {
        // 表示できる最大6か月分（前月の初日〜5か月後の末日）を読む
        const now = new Date();
        const from = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1)).toISOString().slice(0, 10);
        const to = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 6, 0)).toISOString().slice(0, 10);
        const res = await fetch(`${apiBase}/v1/calendar?from=${from}&to=${to}`, { cache: "no-store" });
        if (!res.ok) return;
        store.data = await res.json();
        store.listeners.forEach((l) => l());
      } catch {
        // 取得できなければ前回の内容のまま
      }
    };
    store.subscribe = (listener) => {
      store.listeners.add(listener);
      if (store.listeners.size === 1) {
        refresh();
        store.timer = setInterval(refresh, REFRESH_MS);
        document.addEventListener("visibilitychange", store.onVisible);
      } else if (store.data) {
        listener();
      }
      return () => {
        store.listeners.delete(listener);
        if (store.listeners.size === 0) {
          clearInterval(store.timer);
          document.removeEventListener("visibilitychange", store.onVisible);
        }
      };
    };
    store.onVisible = () => document.visibilityState === "visible" && refresh();
    stores.set(apiBase, store);
    return store;
  }

  // ---- 判定（お店のタイムゾーンで）----
  const pad = (n) => String(n).padStart(2, "0");
  const toMinutes = (hhmm) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  };
  const weekdayOf = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();

  function nowIn(timeZone) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
        .formatToParts(new Date())
        .map((p) => [p.type, p.value])
    );
    return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
  }

  function resolveDay(data, date) {
    const o = data.days[date];
    if (o && o.kind === "closed") return { closed: true, special: true, note: o.note };
    if (o && o.kind === "hours") return { closed: false, special: true, opens: o.opens, closes: o.closes, note: o.note };
    const regularClosed = data.regular.closedWeekdays.includes(weekdayOf(date));
    return regularClosed
      ? { closed: true, regularClosed: true, special: false }
      : { closed: false, special: false, opens: data.regular.opens, closes: data.regular.closes };
  }

  function statusOf(data) {
    const { date, minutes } = nowIn(data.timezone || "Asia/Tokyo");
    const day = resolveDay(data, date);
    if (day.closed) return { ...day, state: "closed" };
    if (minutes < toMinutes(day.opens)) return { ...day, state: "before" };
    if (minutes >= toMinutes(day.closes)) return { ...day, state: "after" };
    return { ...day, state: "open" };
  }

  // ---- 共通 ----
  const BASE_STYLE = `
    :host { display: block; font: inherit; color: var(--bc-ink, currentColor); }
    :host([hidden]) { display: none; }
    .muted { color: var(--bc-muted, #62656a); }
  `;

  class Base extends HTMLElement {
    connectedCallback() {
      if (!this.shadowRoot) this.attachShadow({ mode: "open" });
      const api = (this.getAttribute("src") || SCRIPT_ORIGIN).replace(/\/$/, "");
      this.api = api;
      this.t = I18N[(this.getAttribute("lang") || document.documentElement.lang || "ja").slice(0, 2)] || I18N.ja;
      this.store = getStore(api);
      this.unsubscribe = this.store.subscribe(() => this.render());
      this.tick = setInterval(() => this.store.data && this.render(), 30_000);
      this.render();
    }
    disconnectedCallback() {
      this.unsubscribe?.();
      clearInterval(this.tick);
    }
  }

  // ---- <business-status> ----
  class BusinessStatus extends Base {
    render() {
      const t = this.t;
      const data = this.store.data;
      const s = data ? statusOf(data) : null;
      const label = !s
        ? t.loading
        : s.state === "open"
          ? t.open(s.closes)
          : s.state === "before"
            ? t.before(s.opens)
            : s.state === "after"
              ? t.after
              : s.regularClosed
                ? t.regularClosed
                : t.closed;
      this.shadowRoot.innerHTML = `
        <style>${BASE_STYLE}
          :host { display: inline-block; }
          .status { display: inline-flex; align-items: center; gap: .5em; border: 1px solid var(--bc-ink, currentColor); border-radius: 999px; padding: .25em .75em; font-weight: 600; font-size: .875em; }
          .status::before { content: ""; width: .5em; height: .5em; border-radius: 50%; background: currentColor; }
          .status.open { background: var(--bc-open-bg, #1f5c45); color: var(--bc-open-ink, #fff); border-color: var(--bc-open-bg, #1f5c45); }
          .note { display: block; margin-top: .4em; font-size: .875em; }
        </style>
        <span part="status" class="status ${s && s.state === "open" ? "open" : ""}" role="status" aria-live="polite">${escapeHtml(label)}</span>
        ${s && s.note ? `<span part="note" class="note muted">${escapeHtml(s.note)}</span>` : ""}`;
    }
  }

  // ---- <business-calendar months="2"> ----
  const CAT = `<svg viewBox="0 0 32 26" width="24" height="20" aria-hidden="true" fill="currentColor"><path d="M6 5 9.5 10C11.5 9.2 13.6 8.8 16 8.8s4.5.4 6.5 1.2L26 5l.6 7.4c2.4 2.2 3.9 4.9 3.9 7.6 0 4-6.5 6-14.5 6S1.5 24 1.5 20c0-2.7 1.5-5.4 3.9-7.6L6 5Z"/></svg>`;
  const SHARE_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>`;
  const DOT = `<svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" fill="currentColor"><circle cx="5" cy="5" r="4"/></svg>`;

  class BusinessCalendar extends Base {
    render() {
      const t = this.t;
      const data = this.store.data;
      const months = Math.max(1, Math.min(6, Number(this.getAttribute("months")) || 2));
      const mark = this.getAttribute("closed-mark") === "cat" ? CAT : DOT;
      if (!data) {
        this.shadowRoot.innerHTML = `<style>${BASE_STYLE} .skeleton { min-height: 320px; background: var(--bc-surface, #f4f4f1); }</style><div class="skeleton" aria-label="${t.loading}"></div>`;
        return;
      }
      const today = nowIn(data.timezone || "Asia/Tokyo").date;
      const [y0, m0] = today.split("-").map(Number);
      let html = "";
      this.shownMonths = [];
      for (let i = 0; i < months; i++) {
        const d = new Date(Date.UTC(y0, m0 - 1 + i, 1));
        this.shownMonths.push(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`);
        html += this.month(data, d.getUTCFullYear(), d.getUTCMonth() + 1, today, mark);
      }
      const sharing = this.hasAttribute("share");
      this.shadowRoot.innerHTML = `
        <style>${BASE_STYLE}
          .months { display: grid; gap: 2em; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); }
          table { width: 100%; border-collapse: collapse; table-layout: fixed; text-align: center; }
          caption { text-align: left; font-weight: 600; font-size: 1.1em; margin-bottom: .5em; font-variant-numeric: tabular-nums; }
          th { font-size: .75em; font-weight: 500; padding-bottom: .25em; }
          td { border: 1px solid var(--bc-rule, #e2e2de); height: 3.25em; vertical-align: top; padding: .25em 0 0; font-size: .8em; font-variant-numeric: tabular-nums; }
          td.empty { background: var(--bc-surface, #f4f4f1); }
          td.past { opacity: .5; }
          td.today { outline: 2px solid var(--bc-ink, currentColor); outline-offset: -2px; }
          .cell { display: flex; flex-direction: column; align-items: center; gap: .15em; }
          .mark { color: var(--bc-closed, currentColor); line-height: 0; }
          .time { font-size: .8em; }
          ul { margin: .75em 0 0; padding: 0; list-style: none; font-size: .875em; }
          .legend { margin-top: 1em; display: flex; flex-wrap: wrap; gap: .25em 1em; align-items: center; font-size: .75em; }
          .legend span { display: inline-flex; align-items: center; gap: .3em; }
          .share { margin-top: 1em; min-height: 44px; padding: 0 1.25em; border: 1px solid var(--bc-ink, currentColor); background: transparent; color: inherit; font: inherit; font-weight: 600; font-size: .875em; cursor: pointer; display: inline-flex; align-items: center; gap: .5em; }
          .share:disabled { opacity: .5; cursor: progress; }
          .share-status { font-size: .75em; margin: .5em 0 0; }
        </style>
        <div class="months" part="months">${html}</div>
        <p class="legend muted" part="legend"><span><span class="mark">${mark}</span>${t.legendClosed}</span><span>${t.legendHours}</span></p>
        ${sharing ? `<button type="button" class="share" part="share-button">${SHARE_ICON}${t.share}</button><p class="share-status muted" role="status" aria-live="polite"></p>` : ""}`;
      if (sharing) {
        this.shadowRoot.querySelector(".share").addEventListener("click", () => this.share());
        this.prepareShare(data);
      }
    }

    // ---- 共有（iOS: 共有シート / Android: Sharesheet / デスクトップ: Web Share API、使えなければ画像を保存）----
    imageLib() {
      return (this.lib ??= import(`${this.api}/calendar-image.js`));
    }

    // タップした瞬間に共有シートを開けるよう、画像は先に作っておく
    prepareShare(data) {
      const key = `${data.updatedAt}|${this.shownMonths.join(",")}`;
      if (this.shareKey === key) return;
      this.shareKey = key;
      this.files = null;
      const run = () => this.buildFiles(data, key).catch(() => {});
      if ("requestIdleCallback" in window) requestIdleCallback(run, { timeout: 3000 });
      else setTimeout(run, 1000);
    }

    async buildFiles(data, key = this.shareKey) {
      const lib = await this.imageLib();
      const style = getComputedStyle(this);
      const color = (name) => style.getPropertyValue(name).trim() || undefined;
      const storeName = this.getAttribute("store-name") || data.store?.name || "";
      const url = data.store?.url || location.origin;
      const lang = (this.getAttribute("lang") || document.documentElement.lang || "ja").slice(0, 2) === "en" ? "en" : "ja";
      const files = [];
      for (const month of this.shownMonths) {
        const blob = await lib.renderCalendarImage({
          data,
          month,
          language: lang,
          storeName,
          footer: url.replace(/^https?:\/\//, "").replace(/\/$/, ""),
          closedMark: this.getAttribute("closed-mark") || data.store?.closedMark || "dot",
          fonts: { sans: this.getAttribute("image-font") || style.fontFamily, display: this.getAttribute("image-display-font") || style.fontFamily },
          colors: { closed: color("--bc-image-closed"), hours: color("--bc-image-hours") },
        });
        files.push(lib.toFile(blob, `calendar-${month}.png`));
      }
      if (key === this.shareKey) this.files = files;
      return files;
    }

    async share() {
      const button = this.shadowRoot.querySelector(".share");
      const status = this.shadowRoot.querySelector(".share-status");
      const data = this.store.data;
      if (!data) return;
      button.disabled = true;
      try {
        const lib = await this.imageLib();
        const files = this.files || (await this.buildFiles(data));
        const url = this.getAttribute("share-url") || location.href;
        const text = this.getAttribute("share-text") || this.t.shareText(this.getAttribute("store-name") || data.store?.name);
        const result = await lib.shareFiles({ files, text, url });
        if (result === "unsupported") {
          // 共有シートが使えないブラウザ: 画像を保存し、リンクをコピー
          files.forEach((file) => lib.downloadBlob(file, file.name));
          await navigator.clipboard?.writeText(url).catch(() => {});
          status.textContent = this.t.saved;
        }
      } catch {
        // 共有をやめた・失敗したときは何もしない
      } finally {
        button.disabled = false;
      }
    }

    month(data, year, month, today, mark) {
      const t = this.t;
      const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
      const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const cells = [];
      const notes = [];
      for (let i = 0; i < first; i++) cells.push('<td class="empty"></td>');
      for (let d = 1; d <= last; d++) {
        const date = `${year}-${pad(month)}-${pad(d)}`;
        const day = resolveDay(data, date);
        const changed = !day.closed && day.special;
        if ((changed || day.note) && date >= today) {
          notes.push(t.listItem(month, d, `${changed ? t.hours(day.opens, day.closes) : t.cellClosed}${day.note ? ` (${day.note})` : ""}`));
        }
        const label = `${t.dayLabel(month, d, t.weekdays[weekdayOf(date)])} ${day.closed ? t.cellClosed : changed ? t.hours(day.opens, day.closes) : t.cellOpen}${day.note ? t.noteSep + day.note : ""}`;
        const cls = [date === today ? "today" : "", date < today ? "past" : ""].filter(Boolean).join(" ");
        cells.push(
          `<td class="${cls}" aria-label="${escapeHtml(label)}"><div class="cell" aria-hidden="true"><span>${d}</span>${day.closed ? `<span class="mark">${mark}</span>` : ""}${changed ? `<span class="time">${escapeHtml(day.opens)}–</span>` : ""}</div></td>`
        );
      }
      while (cells.length % 7) cells.push('<td class="empty"></td>');
      const rows = [];
      for (let i = 0; i < cells.length; i += 7) rows.push(`<tr>${cells.slice(i, i + 7).join("")}</tr>`);
      return `<div><table part="table"><caption>${t.caption(year, month)}</caption><thead><tr>${t.weekdays
        .map((w) => `<th scope="col" class="muted">${w}</th>`)
        .join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>${
        notes.length ? `<ul>${notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>` : ""
      }</div>`;
    }
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  customElements.define("business-status", BusinessStatus);
  customElements.define("business-calendar", BusinessCalendar);
})();
