"use client";

import Image from "next/image";
import {
  CalendarDays,
  Clock3,
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
    <label className="block">
      <span className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-normal text-[var(--muted)]">
        <SignalIcon icon={Icon} tone={tone} className="h-6 w-6" iconClassName="h-3.5 w-3.5" />
        {label}
      </span>
      {children}
    </label>
  );
}

const inputClass =
  "h-11 w-full rounded-md border border-white/[0.08] bg-white/[0.08] px-3 text-sm text-[var(--foreground)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_10px_24px_rgba(0,5,18,0.1)] backdrop-blur transition hover:border-white/[0.14] hover:bg-white/[0.12]";

const toggleButtonClass =
  "grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-md border border-white/[0.1] bg-white/[0.08] text-[var(--muted-strong)] shadow-[0_10px_22px_rgba(0,5,18,0.16)] transition hover:-translate-y-px hover:bg-white/[0.13] hover:text-[var(--foreground)]";

export function SidebarFilters({
  collapsed,
  filters,
  strategy,
  accountId,
  datePreset,
  timezone,
  customStart,
  customEnd,
  onStrategyChange,
  onAccountChange,
  onPresetChange,
  onTimezoneChange,
  onCustomStartChange,
  onCustomEndChange,
  onToggleCollapsed,
}: {
  collapsed: boolean;
  filters: FilterOptions;
  strategy: string;
  accountId: string;
  datePreset: DatePreset;
  timezone: string;
  customStart: string;
  customEnd: string;
  onStrategyChange: (value: string) => void;
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

  if (collapsed) {
    return (
      <aside className="w-full bg-[linear-gradient(180deg,rgba(10,38,61,0.58)_0%,rgba(21,37,80,0.4)_52%,rgba(6,19,34,0.22)_100%)] p-3 shadow-[18px_0_46px_rgba(0,5,18,0.24)] backdrop-blur-2xl lg:min-h-screen lg:w-[72px]">
        <button
          type="button"
          title="Expand sidebar"
          aria-label="Expand sidebar"
          onClick={onToggleCollapsed}
          className={`${toggleButtonClass} mx-auto mt-2 h-11 w-11`}
        >
          <SignalIcon
            icon={ToggleIcon}
            tone="cyan"
            className="h-8 w-8"
            iconClassName="h-4 w-4"
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
          <select
            className={inputClass}
            value={strategy}
            onChange={(event) => onStrategyChange(event.target.value)}
          >
            <option value="ALL">ALL</option>
            {filters.strategies.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
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
