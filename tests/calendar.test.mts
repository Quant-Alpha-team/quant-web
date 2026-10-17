import assert from "node:assert/strict";
import test from "node:test";
import {
  addCalendarDays,
  calendarDays,
  changeCalendarMonth,
  clampCalendarDate,
  isCalendarDateEnabled,
  parseCalendarInput,
} from "../lib/calendar.ts";

test("calendar renders six Sunday-first weeks across month and year boundaries", () => {
  const days = calendarDays("2026-10-17");
  assert.equal(days.length, 42);
  assert.equal(days[0], "2026-09-27");
  assert.equal(days.at(-1), "2026-11-07");
  assert.equal(calendarDays("2027-01-01")[0], "2026-12-27");
});

test("calendar navigation preserves days and clamps leap-year month ends", () => {
  assert.equal(changeCalendarMonth("2026-01-31", 1), "2026-02-28");
  assert.equal(changeCalendarMonth("2024-01-31", 1), "2024-02-29");
  assert.equal(changeCalendarMonth("2024-02-29", 12), "2025-02-28");
  assert.equal(changeCalendarMonth("2026-12-17", 1), "2027-01-17");
  assert.equal(addCalendarDays("2026-03-08", 1), "2026-03-09");
  assert.equal(addCalendarDays("2026-12-31", 1), "2027-01-01");
});

test("calendar selection and keyboard navigation honor inclusive range limits", () => {
  const min = "2026-10-10";
  const max = "2026-10-17";
  assert.equal(isCalendarDateEnabled(min, min, max), true);
  assert.equal(isCalendarDateEnabled(max, min, max), true);
  assert.equal(isCalendarDateEnabled("2026-10-09", min, max), false);
  assert.equal(isCalendarDateEnabled("2026-10-18", min, max), false);
  assert.equal(clampCalendarDate("2026-09-30", min, max), min);
  assert.equal(clampCalendarDate("2026-11-01", min, max), max);
  assert.equal(isCalendarDateEnabled("2027-01-01"), true);
});

test("typed dates accept the Chrome display format and reject impossible dates", () => {
  assert.equal(parseCalendarInput("2026/10/17"), "2026-10-17");
  assert.equal(parseCalendarInput("20261017"), "2026-10-17");
  assert.equal(parseCalendarInput("2026-10-17"), "2026-10-17");
  assert.equal(parseCalendarInput("2024/02/29"), "2024-02-29");
  for (const value of ["0000/01/01", "2026/02/29", "2026/13/01", "2026/04/31", "10/17/2026", "", "invalid"]) {
    assert.equal(parseCalendarInput(value), null);
  }
});

test("calendar navigation cannot select dates outside four-digit positive years", () => {
  assert.equal(clampCalendarDate(changeCalendarMonth("9999-12-31", 1)), "9999-12-31");
  assert.equal(clampCalendarDate(changeCalendarMonth("0001-01-01", -1)), "0001-01-01");
  assert.equal(isCalendarDateEnabled("10000-01-01"), false);
  assert.equal(isCalendarDateEnabled("0000-12-31"), false);
  assert.equal(calendarDays("9999-12-31").length, 42);
});
