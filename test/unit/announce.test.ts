import { test } from "node:test";
import assert from "node:assert/strict";
import { composeChanges, composeMonth } from "../../src/announce";
import type { ChangeRow } from "../../src/calendar";

const regular = { opens: "12:00", closes: "18:00", closedWeekdays: [4] };
const base = { target: "day", opens: null, closes: null, note: null, closed_weekdays: null } as const;
const row = (id: number, fields: Partial<ChangeRow>): ChangeRow => ({ ...base, id, date: null, kind: null, ...fields }) as ChangeRow;
const ja = { language: "ja", storeName: "85-Store", shareUrl: "https://85-store.com/reserve", today: "2026-10-03" } as const;

test("変更のお知らせ: 日付順・同じ日は最後の内容・過去の日は除く", () => {
  const draft = composeChanges(
    [
      row(1, { date: "2026-10-07", kind: "closed" }),
      row(2, { date: "2026-10-05", kind: "hours", opens: "13:30", closes: "18:00", note: "イベント出店のため" }),
      row(3, { date: "2026-10-07", kind: "closed", note: "仕入れのため" }),
      row(4, { date: "2026-10-01", kind: "closed" }), // 過去
      row(5, { date: "2026-10-09", kind: "default" }),
      row(6, { date: "2026-10-15", kind: "default" }), // 木曜（定休曜日）
    ],
    regular,
    ja
  );
  assert.ok(draft);
  assert.equal(
    draft.text,
    [
      "【85-Store 営業日のお知らせ】",
      "・10/5（月）13:30〜18:00 で営業（イベント出店のため）",
      "・10/7（水）お休み（仕入れのため）",
      "・10/9（金）通常どおり 12:00〜18:00 で営業",
      "・10/15（木）定休日",
      "",
      "最新の営業日はこちら",
      "https://85-store.com/reserve",
    ].join("\n")
  );
  assert.equal(draft.uptoId, 6);
  assert.deepEqual(draft.months, ["2026-10"]);
});

test("変更のお知らせ: 通常の営業時間の変更と英語", () => {
  const changes = [row(1, { target: "regular", opens: "11:00", closes: "19:00", closed_weekdays: "[2,4]" }), row(2, { date: "2026-11-03", kind: "closed" })];
  const draft = composeChanges(changes, regular, { ...ja, language: "en", storeName: "Example Coffee", shareUrl: undefined });
  assert.ok(draft);
  assert.equal(
    draft.text,
    ["Example Coffee: Schedule update", "• Tue, Nov 3: closed", "• Regular hours are now 11:00–19:00, closed on Tuesdays, Thursdays"].join("\n")
  );
  assert.deepEqual(draft.months, ["2026-11"]);
});

test("変更のお知らせ: 今日以降の変更がなければ null", () => {
  assert.equal(composeChanges([row(1, { date: "2026-10-01", kind: "closed" })], regular, ja), null);
  assert.equal(composeChanges([], regular, ja), null);
});

test("月のお知らせ: お休み（定休曜日を含む）と営業時間の変更", () => {
  const draft = composeMonth(
    "2026-10",
    { regular, days: { "2026-10-05": { kind: "hours", opens: "13:30", closes: "18:00" }, "2026-10-07": { kind: "closed" }, "2026-10-08": { kind: "hours", opens: "12:00", closes: "16:00" } }, updatedAt: "" },
    ja
  );
  // 10/8 は木曜だが営業時間を設定しているので営業
  assert.equal(
    draft.text,
    [
      "【85-Store 10月の営業日】",
      "お休み：1・7・15・22・29日",
      "営業時間の変更：5日 13:30〜18:00、8日 12:00〜16:00",
      "営業時間：12:00〜18:00",
      "",
      "最新の営業日はこちら",
      "https://85-store.com/reserve",
    ].join("\n")
  );
  assert.equal(draft.uptoId, null);
});
