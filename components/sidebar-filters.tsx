"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  GitBranch,
  Layers3,
  PanelLeftClose,
  PanelLeftOpen,
  WalletCards,
} from "lucide-react";
import { SignalIcon, type SignalTone } from "@/components/signal-icon";
import {
  DATE_PRESETS,
  DEFAULT_TIMEZONES,
  resolveDateRange,
  todayInTimeZone,
} from "@/lib/dashboard";
import type { DatePreset, FilterOptions } from "@/lib/types";

function Field({
  icon: Icon,
  label,
  tone = "mint",
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  tone?: SignalTone;
  children: React.ReactNode;
}) {
  return (
    <div className="block">
      <span className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-normal text-[var(--muted)]">
        <SignalIcon icon={Icon} tone={tone} className="h-6 w-6" iconClassName="h-3.5 w-3.5" />
        {label}
      </span>
      {children}
    </div>
  );
}

const inputClass =
  "h-11 w-full rounded-md border border-white/[0.08] bg-white/[0.08] px-3 text-sm text-[var(--foreground)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_10px_24px_rgba(0,5,18,0.1)] backdrop-blur transition hover:border-white/[0.14] hover:bg-white/[0.12]";

const toggleButtonClass =
  "grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-md border border-white/[0.1] bg-white/[0.08] text-[var(--muted-strong)] shadow-[0_10px_22px_rgba(0,5,18,0.16)] transition hover:-translate-y-px hover:bg-white/[0.13] hover:text-[var(--foreground)]";

type MultiSelectOption = {
  value: string;
  label: string;
};

function MultiSelect({
  label,
  allLabel,
  options,
  values,
  disabled = false,
  onChange,
}: {
  label: string;
  allLabel: string;
  options: MultiSelectOption[];
  values: string[];
  disabled?: boolean;
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedValues = new Set(values);
  const isAll =
    values.includes("ALL") ||
    (options.length > 0 && options.every((option) => selectedValues.has(option.value)));
  const selectedLabels = options
    .filter((option) => isAll || selectedValues.has(option.value))
    .map((option) => option.label);
  const summary = isAll
    ? allLabel
    : selectedLabels.length === 0
      ? "NONE"
      : selectedLabels.length === 1
        ? selectedLabels[0]
        : `${selectedLabels.length} SELECTED`;

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);


  function toggleValue(value: string) {
    if (value === "ALL") {
      onChange(isAll ? [] : ["ALL"]);
      return;
    }

    const nextValues = isAll
      ? options.map((option) => option.value).filter((item) => item !== value)
      : selectedValues.has(value)
        ? values.filter((item) => item !== value)
        : [...values, value];
    onChange(nextValues.length === options.length ? ["ALL"] : nextValues);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        title={isAll ? allLabel : selectedLabels.join(", ")}
        className={`${inputClass} flex cursor-pointer items-center justify-between gap-3 text-left disabled:cursor-not-allowed disabled:opacity-55`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="truncate">{summary}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-[var(--muted)] transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {open && !disabled ? (
        <div
          role="listbox"
          aria-label={label}
          aria-multiselectable="true"
          className="absolute left-0 right-0 top-[calc(100%+0.4rem)] z-[70] max-h-64 overflow-y-auto rounded-md border border-white/[0.14] bg-[#172437]/[0.98] p-1.5 shadow-[0_18px_45px_rgba(0,5,18,0.5)] backdrop-blur-xl"
        >
          {[{ value: "ALL", label: allLabel }, ...options].map((option) => {
            const checked =
              option.value === "ALL" ? isAll : isAll || selectedValues.has(option.value);
            return (
              <div
                key={option.value}
                className={
                  option.value === "ALL"
                    ? "sticky top-0 z-10 mb-1.5 border-b border-white/[0.14] bg-[#172437] pb-1.5"
                    : ""
                }
              >
                <button
                  type="button"
                  role="option"
                  aria-selected={checked}
                  className="flex w-full cursor-pointer items-center gap-2 rounded px-2.5 py-2 text-left text-sm text-[var(--foreground)] transition hover:bg-white/[0.1] focus-visible:bg-white/[0.1] focus-visible:outline-none"
                  onClick={() => toggleValue(option.value)}
                >
                  <span
                    className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${
                      checked
                        ? "border-cyan-300 bg-cyan-300 text-[#061322]"
                        : "border-white/25 bg-white/[0.04]"
                    }`}
                    aria-hidden="true"
                  >
                    {checked ? <Check className="h-3 w-3" /> : null}
                  </span>
                  <span className="truncate">{option.label}</span>
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function SidebarFilters({
  collapsed,
  filters,
  strategyFamilies,
  strategyVersions,
  accountId,
  datePreset,
  timezone,
  customStart,
  customEnd,
  onStrategyFamiliesChange,
  onStrategyVersionsChange,
  onAccountChange,
  onPresetChange,
  onTimezoneChange,
  onCustomStartChange,
  onCustomEndChange,
  onToggleCollapsed,
}: {
  collapsed: boolean;
  filters: FilterOptions;
  strategyFamilies: string[];
  strategyVersions: string[];
  accountId: string;
  datePreset: DatePreset;
  timezone: string;
  customStart: string;
  customEnd: string;
  onStrategyFamiliesChange: (values: string[]) => void;
  onStrategyVersionsChange: (values: string[]) => void;
  onAccountChange: (value: string) => void;
  onPresetChange: (value: DatePreset) => void;
  onTimezoneChange: (value: string) => void;
  onCustomStartChange: (value: string) => void;
  onCustomEndChange: (value: string) => void;
  onToggleCollapsed: () => void;
}) {
  const range = resolveDateRange(datePreset, timezone, customStart, customEnd);
  const today = todayInTimeZone(timezone);
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const selectedFamilyOptions = filters.strategy_families.filter((item) =>
    strategyFamilies.includes(item.family),
  );
  const versionsByName = new Map<string, { active: boolean }>();
  for (const family of selectedFamilyOptions) {
    for (const item of family.versions) {
      if (item.version !== null) {
        versionsByName.set(item.version, {
          active: (versionsByName.get(item.version)?.active ?? false) || item.is_active,
        });
      }
    }
  }
  const versionOptions = [...versionsByName.entries()].map(([version, item]) => ({
    value: version,
    label: `${version}${item.active ? "" : " (inactive)"}`,
  }));
  const hasVersions = versionOptions.length > 0;
  const versionDisabled =
    strategyFamilies.length === 0 || strategyFamilies.includes("ALL") || !hasVersions;

  if (collapsed) {
    return (
      <aside className="absolute right-4 top-4 z-50 rounded-md bg-[linear-gradient(180deg,rgba(10,38,61,0.78)_0%,rgba(21,37,80,0.68)_100%)] p-1.5 shadow-[0_12px_30px_rgba(0,5,18,0.3)] backdrop-blur-2xl lg:static lg:min-h-screen lg:w-[72px] lg:rounded-none lg:bg-[linear-gradient(180deg,rgba(10,38,61,0.58)_0%,rgba(21,37,80,0.4)_52%,rgba(6,19,34,0.22)_100%)] lg:p-3 lg:shadow-[18px_0_46px_rgba(0,5,18,0.24)]">
        <button
          type="button"
          title="Expand sidebar"
          aria-label="Expand sidebar"
          onClick={onToggleCollapsed}
          className={`${toggleButtonClass} h-10 w-10 lg:mx-auto lg:mt-2 lg:h-11 lg:w-11`}
        >
          <SignalIcon
            icon={ToggleIcon}
            tone="cyan"
            className="h-8 w-8"
            iconClassName={`h-4 w-4 transition-transform ${collapsed ? "rotate-180 lg:rotate-0" : ""}`}
          />
        </button>
      </aside>
    );
  }

  return (
    <aside
      className="w-full bg-[linear-gradient(180deg,rgba(10,38,61,0.62)_0%,rgba(21,37,80,0.42)_52%,rgba(6,19,34,0.24)_100%)] p-5 shadow-[18px_0_46px_rgba(0,5,18,0.24)] backdrop-blur-2xl transition-[width,padding] duration-200 lg:min-h-screen lg:w-[340px]"
    >
      <div className="mb-7 border-b border-white/[0.08] pb-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-md shadow-[0_16px_30px_rgba(45,212,191,0.22)]">
              <Image
                src="/QuantAlpha-logo.png"
                alt="Quant Alpha logo"
                width={48}
                height={48}
                className="h-12 w-12 object-contain"
                priority
              />
            </div>
            <div className="min-w-0">
              <div className="whitespace-nowrap text-[1.55rem] font-semibold leading-none text-[var(--foreground)]">
                Quant Alpha
              </div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-normal text-[var(--muted)]">
                Trading Platform
              </div>
            </div>
          </div>
          <button
            type="button"
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
            onClick={onToggleCollapsed}
            className={toggleButtonClass}
          >
            <ToggleIcon className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="mt-5 grid gap-2">
          <div className="rounded-md border border-white/[0.08] bg-white/[0.06] px-3 py-2.5 shadow-[0_10px_24px_rgba(0,5,18,0.12)]">
            <div className="mb-1 text-[10px] uppercase tracking-normal text-[var(--muted)]">
              Date Window
            </div>
            <div className="flex items-center justify-between gap-3 font-mono text-xs text-[var(--muted-strong)]">
              <span className="truncate">{range.startDate} / {range.endDate}</span>
              <span className="status-dot shrink-0" aria-hidden="true" />
            </div>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2 font-mono text-[10px] uppercase tracking-normal">
            <span className="rounded-md border border-white/[0.08] bg-white/[0.05] px-3 py-2 text-[var(--muted)]">
              API LINK
            </span>
            <span className="rounded-md border border-[#9cf62f]/20 bg-[rgba(156,246,47,0.12)] px-3 py-2 text-[#b8ff5d]">
              Online
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-5">
        <Field icon={Layers3} label="Strategy" tone="violet">
          <MultiSelect
            label="Strategy"
            allLabel="ALL"
            values={strategyFamilies}
            options={filters.strategy_families.map((item) => ({
              value: item.family,
              label: item.family,
            }))}
            onChange={onStrategyFamiliesChange}
          />
        </Field>

        <Field icon={GitBranch} label="Version" tone="violet">
          <MultiSelect
            key={versionDisabled ? "disabled" : "enabled"}
            label="Version"
            allLabel={hasVersions || strategyFamilies.includes("ALL") ? "ALL VERSIONS" : "N/A"}
            values={strategyVersions}
            options={versionOptions}
            disabled={versionDisabled}
            onChange={onStrategyVersionsChange}
          />
        </Field>

        <Field icon={WalletCards} label="Broker Account" tone="cyan">
          <select
            className={inputClass}
            value={accountId}
            onChange={(event) => onAccountChange(event.target.value)}
          >
            <option value="ALL">ALL</option>
            {filters.accounts.map((account) => (
              <option key={account.account_id} value={account.account_id}>
                {account.account_id}
              </option>
            ))}
          </select>
        </Field>

        <Field icon={CalendarDays} label="Time Range" tone="amber">
          <select
            className={inputClass}
            value={datePreset}
            onChange={(event) => onPresetChange(event.target.value as DatePreset)}
          >
            {DATE_PRESETS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </Field>

        {datePreset === "Custom Date" ? (
          <div className="grid grid-cols-2 gap-3">
            <input
              aria-label="Start date"
              className={inputClass}
              max={customEnd || today}
              type="date"
              value={customStart}
              onChange={(event) => onCustomStartChange(event.target.value)}
            />
            <input
              aria-label="End date"
              className={inputClass}
              min={customStart}
              type="date"
              value={customEnd}
              onChange={(event) => onCustomEndChange(event.target.value)}
            />
          </div>
        ) : null}

        <Field icon={Clock3} label="Display Timezone" tone="green">
          <select
            className={inputClass}
            value={timezone}
            onChange={(event) => onTimezoneChange(event.target.value)}
          >
            {DEFAULT_TIMEZONES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </aside>
  );
}
