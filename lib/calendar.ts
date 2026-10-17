/** Calendar dates use UTC so the display timezone and DST cannot shift a day. */
export function calendarDate(value: string) {
  if (/^\d{5}-/.test(value)) return new Date(`+0${value}T12:00:00Z`);
  return new Date(`${value}T12:00:00Z`);
}

export function dateValue(date: Date) {
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function addCalendarDays(value: string, days: number) {
  const date = calendarDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return dateValue(date);
}

export function changeCalendarMonth(value: string, months: number) {
  const date = calendarDate(value);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(date.getTime());
  lastDay.setUTCMonth(lastDay.getUTCMonth() + 1, 0);
  date.setUTCDate(Math.min(day, lastDay.getUTCDate()));
  return dateValue(date);
}

export function calendarDays(value: string) {
  const first = `${value.slice(0, 7)}-01`;
  const start = addCalendarDays(first, -calendarDate(first).getUTCDay());
  return Array.from({ length: 42 }, (_, index) => addCalendarDays(start, index));
}

export function clampCalendarDate(value: string, min = "0001-01-01", max = "9999-12-31") {
  if (calendarDate(value).getUTCFullYear() < 1) return min || "0001-01-01";
  if (calendarDate(value).getUTCFullYear() > 9999) return max || "9999-12-31";
  if (min && value < min) return min;
  if (max && value > max) return max;
  return value;
}

export function isCalendarDateEnabled(value: string, min = "0001-01-01", max = "9999-12-31") {
  return /^\d{4}-/.test(value) && value >= "0001-01-01" && value <= "9999-12-31" && (!min || value >= min) && (!max || value <= max);
}

export function parseCalendarInput(value: string) {
  const normalized = value.trim().replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3").replaceAll("/", "-");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || normalized.startsWith("0000-")) return null;
  const date = calendarDate(normalized);
  return Number.isFinite(date.getTime()) && dateValue(date) === normalized
    ? normalized
    : null;
}
