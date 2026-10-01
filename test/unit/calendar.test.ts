import { test } from "node:test";
import assert from "node:assert/strict";
import { ValidationError, isValidDate, parseDayOverride, parseRange, parseRegular } from "../../src/calendar";
import { getMessages } from "../../src/i18n";
import { addDays, todayIn } from "../../src/time";

const ja = getMessages("ja");
const en = getMessages("en");

test("日付の検証", () => {
  assert.equal(isValidDate("2026-10-05"), true);
  assert.equal(isValidDate("2026-02-30"), false);
  assert.equal(isValidDate("2026-10-5"), false);
});

test("休業日・時間変更の入力", () => {
  assert.deepEqual(parseDayOverride({ kind: "closed", note: " 棚卸し " }, ja), { kind: "closed", note: "棚卸し" });
  assert.deepEqual(parseDayOverride({ kind: "hours", opens: "13:30", closes: "18:00" }, ja), { kind: "hours", opens: "13:30", closes: "18:00" });
  assert.throws(() => parseDayOverride({ kind: "hours", opens: "18:00", closes: "12:00" }, ja), ValidationError);
  assert.throws(() => parseDayOverride({ kind: "hours", opens: "25:00", closes: "26:00" }, ja), ValidationError);
  assert.throws(() => parseDayOverride({ kind: "closed", note: "x".repeat(101) }, ja), ValidationError);
  assert.throws(() => parseDayOverride({ kind: "open" }, ja), ValidationError);
});

test("メッセージは言語設定に従う", () => {
  assert.throws(() => parseDayOverride({ kind: "hours", opens: "18:00", closes: "12:00" }, en), /Closing time must be later/);
  assert.throws(() => parseDayOverride({ kind: "hours", opens: "18:00", closes: "12:00" }, ja), /閉店時刻は開店時刻より後/);
});

test("通常の営業時間・定休曜日", () => {
  assert.deepEqual(parseRegular({ opens: "10:00", closes: "18:00", closedWeekdays: [4, 0, 4] }, ja), { opens: "10:00", closes: "18:00", closedWeekdays: [0, 4] });
  assert.throws(() => parseRegular({ opens: "10:00", closes: "18:00", closedWeekdays: [7] }, ja), ValidationError);
});

test("取得範囲", () => {
  const url = new URL("https://x/v1/calendar?from=2026-10-01&to=2026-10-31");
  assert.deepEqual(parseRange(url, "Asia/Tokyo", ja), { from: "2026-10-01", to: "2026-10-31" });
  assert.throws(() => parseRange(new URL("https://x/?from=2026-10-31&to=2026-10-01"), "Asia/Tokyo", ja), ValidationError);
  assert.throws(() => parseRange(new URL("https://x/?from=2026-01-01&to=2027-12-31"), "Asia/Tokyo", ja), ValidationError);
});

test("タイムゾーンごとの今日", () => {
  const now = new Date("2026-10-05T15:30:00Z"); // 東京では 10/6 0:30、ニューヨークでは 10/5 11:30
  assert.equal(todayIn("Asia/Tokyo", now), "2026-10-06");
  assert.equal(todayIn("America/New_York", now), "2026-10-05");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});
