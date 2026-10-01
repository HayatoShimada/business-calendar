import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRegularHours, buildSpecialHours } from "../../src/google";

test("通常営業時間は定休曜日を除いた曜日ごとに作る", () => {
  const { periods } = buildRegularHours({ opens: "12:00", closes: "18:30", closedWeekdays: [4] });
  assert.equal(periods.length, 6);
  assert.equal(periods.some((p) => p.openDay === "THURSDAY"), false);
  assert.deepEqual(periods[0], { openDay: "SUNDAY", openTime: { hours: 12, minutes: 0 }, closeDay: "SUNDAY", closeTime: { hours: 18, minutes: 30 } });
});

test("特別営業時間は日付順で、休業と時間変更を表す", () => {
  const { specialHourPeriods } = buildSpecialHours({
    "2026-10-26": { kind: "hours", opens: "13:30", closes: "18:00" },
    "2026-10-20": { kind: "closed" },
  });
  assert.deepEqual(specialHourPeriods[0], { startDate: { year: 2026, month: 10, day: 20 }, closed: true });
  assert.deepEqual(specialHourPeriods[1], {
    startDate: { year: 2026, month: 10, day: 26 },
    openTime: { hours: 13, minutes: 30 },
    endDate: { year: 2026, month: 10, day: 26 },
    closeTime: { hours: 18, minutes: 0 },
    closed: false,
  });
});
