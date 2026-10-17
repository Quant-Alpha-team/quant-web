"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import {
  addCalendarDays,
  calendarDate,
  calendarDays,
  changeCalendarMonth,
  clampCalendarDate,
  isCalendarDateEnabled,
  parseCalendarInput,
} from "@/lib/calendar";

const months = Array.from({ length: 12 }, (_, month) =>
  new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(2026, month, 1)),
  ),
);
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const dayLabel = new Intl.DateTimeFormat("en-US", {
  dateStyle: "full",
  timeZone: "UTC",
});
const subscribeToPopoverSupport = () => () => {};

export function DatePicker({
  label,
  value,
  today,
  min: minimum,
  max: maximum,
  className,
  onChange,
}: {
  label: string;
  value: string;
  today: string;
  min?: string;
  max?: string;
  className?: string;
  onChange: (value: string) => void;
}) {
  const min = minimum || "0001-01-01";
  const max = maximum || "9999-12-31";
  const id = useId();
  const supportsPopover = useSyncExternalStore(
    subscribeToPopoverSupport,
    () => "popover" in HTMLElement.prototype,
    () => true,
  );
  const popupRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeDate, setActiveDate] = useState(value || today);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [yearDraft, setYearDraft] = useState<string | null>(null);
  const month = activeDate.slice(0, 7);
  const days = calendarDays(activeDate);

  function positionPopup() {
    const popup = popupRef.current;
    const field = fieldRef.current;
    if (!popup || !field) return;
    const bounds = field.getBoundingClientRect();
    const gap = 6;
    const padding = 8;
    const left = Math.max(padding, Math.min(bounds.left, window.innerWidth - popup.offsetWidth - padding));
    const below = bounds.bottom + gap;
    const top = below + popup.offsetHeight <= window.innerHeight - padding
      ? below
      : Math.max(padding, bounds.top - popup.offsetHeight - gap);
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
  }

  useEffect(() => {
    if (!supportsPopover) return;
    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape" || !popupRef.current?.matches(":popover-open")) return;
      event.preventDefault();
      popupRef.current?.hidePopover();
      triggerRef.current?.focus();
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [supportsPopover]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", positionPopup);
    window.addEventListener("scroll", positionPopup, true);
    return () => {
      window.removeEventListener("resize", positionPopup);
      window.removeEventListener("scroll", positionPopup, true);
    };
  }, [open]);

  function close() {
    popupRef.current?.hidePopover();
    triggerRef.current?.focus();
  }

  function selectDate(nextValue: string) {
    onChange(nextValue);
    setDraft(null);
    setError("");
    close();
  }

  function focusDate(nextValue: string) {
    const next = clampCalendarDate(nextValue, min, max);
    flushSync(() => setActiveDate(next));
    popupRef.current?.querySelector<HTMLButtonElement>(`[data-date="${next}"]`)?.focus();
  }

  function commitYear() {
    const year = Number(yearDraft ?? activeDate.slice(0, 4));
    const next = Number.isInteger(year) && year >= 1 && year <= 9999
      ? clampCalendarDate(changeCalendarMonth(activeDate, (year - calendarDate(activeDate).getUTCFullYear()) * 12), min, max)
      : activeDate;
    setActiveDate(next);
    setYearDraft(null);
    return next;
  }

  function handleDayKeyDown(event: KeyboardEvent<HTMLButtonElement>, date: string) {
    let next: string;
    switch (event.key) {
      case "ArrowLeft": next = addCalendarDays(date, -1); break;
      case "ArrowRight": next = addCalendarDays(date, 1); break;
      case "ArrowUp": next = addCalendarDays(date, -7); break;
      case "ArrowDown": next = addCalendarDays(date, 7); break;
      case "Home": next = addCalendarDays(date, -calendarDate(date).getUTCDay()); break;
      case "End": next = addCalendarDays(date, 6 - calendarDate(date).getUTCDay()); break;
      case "PageUp": next = changeCalendarMonth(date, event.shiftKey ? -12 : -1); break;
      case "PageDown": next = changeCalendarMonth(date, event.shiftKey ? 12 : 1); break;
      default: return;
    }
    event.preventDefault();
    focusDate(next);
  }

  function commitInput() {
    if (draft === null) return value;
    if (!draft.trim()) {
      onChange("");
      setDraft(null);
      setError("");
      return "";
    }
    const parsed = parseCalendarInput(draft);
    if (!parsed || !isCalendarDateEnabled(parsed, min, max)) {
      setError(`Enter a valid date as YYYY/MM/DD${min !== "0001-01-01" ? `, on or after ${min.replaceAll("-", "/")}` : ""}${max !== "9999-12-31" ? `, on or before ${max.replaceAll("-", "/")}` : ""}.`);
      return null;
    }
    onChange(parsed);
    setDraft(null);
    setError("");
    return parsed;
  }

  if (!supportsPopover) {
    return <input aria-label={label} className={className} type="date" min={min} max={max} value={value} onChange={(event) => onChange(event.target.value)} />;
  }

  return (
    <div className="min-w-0">
      <div ref={fieldRef} className={`${className ?? ""} date-picker-field`}>
        <input
          aria-label={label}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="date-picker-input"
          type="text"
          inputMode="text"
          placeholder="YYYY/MM/DD"
          value={draft ?? value.replaceAll("-", "/")}
          onChange={(event) => { setDraft(event.target.value); setError(""); }}
          onBlur={commitInput}
          onKeyDown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); commitInput(); }
            if (event.key === "Escape") { setDraft(null); setError(""); }
            if (event.key === "ArrowDown" && event.altKey) {
              event.preventDefault();
              let valid = false;
              flushSync(() => { valid = commitInput() !== null; });
              if (valid) triggerRef.current?.click();
            }
          }}
        />
        <button
          ref={triggerRef}
          type="button"
          className="date-picker-trigger"
          aria-label={`Choose ${label.toLowerCase()}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={`${id}-calendar`}
          popoverTarget={`${id}-calendar`}
          onBlur={(event) => {
            if (!popupRef.current?.contains(event.relatedTarget as Node | null)) {
              popupRef.current?.hidePopover();
            }
          }}
          onClick={(event) => {
            if (popupRef.current?.matches(":popover-open")) return;
            const committed = commitInput();
            if (committed === null) {
              event.preventDefault();
              fieldRef.current?.querySelector("input")?.focus();
              return;
            }
            const initial = clampCalendarDate(committed || today, min, max);
            setActiveDate(initial);
            setYearDraft(null);
          }}
        >
          <CalendarDays className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      {error ? <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-rose-200">{error}</p> : null}

      <div
        ref={popupRef}
        id={`${id}-calendar`}
        popover="auto"
        role="dialog"
        aria-label={`Choose ${label.toLowerCase()}`}
        className="date-picker-popup"
        onBeforeToggle={(event) => {
          if (event.newState !== "open") return;
          event.currentTarget.style.visibility = "hidden";
          requestAnimationFrame(() => {
            const popup = popupRef.current;
            if (!popup?.matches(":popover-open")) return;
            positionPopup();
            popup.style.visibility = "visible";
            popup.querySelector<HTMLButtonElement>('[data-date][tabindex="0"]')?.focus();
          });
        }}
        onToggle={(event) => setOpen(event.currentTarget.matches(":popover-open"))}
        onBlur={(event) => {
          if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node) && event.relatedTarget !== triggerRef.current) {
            popupRef.current?.hidePopover();
          }
        }}
      >
        <div className="date-picker-header">
          <select
            aria-label="Calendar month"
            value={Number(month.slice(5, 7)) - 1}
            onChange={(event) => setActiveDate(clampCalendarDate(changeCalendarMonth(activeDate, Number(event.target.value) - calendarDate(activeDate).getUTCMonth()), min, max))}
          >
            {months.map((name, index) => <option key={name} value={index}>{name}</option>)}
          </select>
          <input
            aria-label="Calendar year"
            type="number"
            min="1"
            max="9999"
            value={yearDraft ?? Number(month.slice(0, 4))}
            onChange={(event) => setYearDraft(event.target.value)}
            onBlur={commitYear}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                focusDate(commitYear());
              }
            }}
          />
          <button type="button" aria-label="Previous month" disabled={!!min && month <= min.slice(0, 7)} onClick={() => setActiveDate(clampCalendarDate(changeCalendarMonth(activeDate, -1), min, max))}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" aria-label="Next month" disabled={!!max && month >= max.slice(0, 7)} onClick={() => setActiveDate(clampCalendarDate(changeCalendarMonth(activeDate, 1), min, max))}>
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <span className="sr-only" aria-live="polite">{months[Number(month.slice(5, 7)) - 1]} {month.slice(0, 4)}</span>
        <table className="date-picker-grid" role="grid" aria-label={`${months[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`}>
          <thead><tr>{weekdays.map((day) => <th key={day} scope="col" abbr={day}>{day[0]}</th>)}</tr></thead>
          <tbody>
            {Array.from({ length: 6 }, (_, week) => (
              <tr key={week}>
                {days.slice(week * 7, week * 7 + 7).map((date) => (
                  <td key={date} aria-selected={date === value}>
                    <button
                      type="button"
                      data-date={date}
                      data-outside-month={date.slice(0, 7) !== month || undefined}
                      aria-label={dayLabel.format(calendarDate(date))}
                      aria-current={date === today ? "date" : undefined}
                      disabled={!isCalendarDateEnabled(date, min, max)}
                      tabIndex={date === activeDate ? 0 : -1}
                      onFocus={() => setActiveDate(date)}
                      onClick={() => selectDate(date)}
                      onKeyDown={(event) => handleDayKeyDown(event, date)}
                    >
                      {calendarDate(date).getUTCDate()}
                    </button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="date-picker-footer">
          <button type="button" onClick={() => selectDate("")}>Clear</button>
          <button type="button" disabled={!isCalendarDateEnabled(today, min, max)} onClick={() => selectDate(today)}>Today</button>
        </div>
      </div>
    </div>
  );
}
