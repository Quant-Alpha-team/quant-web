"use client";

import {
  Activity,
  ClipboardList,
  LineChart,
  Settings2,
  WalletCards,
  BriefcaseBusiness,
} from "lucide-react";
import { SignalIcon, type SignalTone } from "@/components/signal-icon";
import { SECTIONS } from "@/lib/dashboard";
import type { SectionId } from "@/lib/types";

const icons = {
  overview: Activity,
  "strategy-pnl": LineChart,
  "account-equity": WalletCards,
  positions: BriefcaseBusiness,
  "trade-logs": ClipboardList,
  diagnostics: Settings2,
} satisfies Record<SectionId, React.ComponentType<{ className?: string }>>;

const iconTones = {
  overview: "mint",
  "strategy-pnl": "green",
  "account-equity": "cyan",
  positions: "mint",
  "trade-logs": "amber",
  diagnostics: "violet",
} satisfies Record<SectionId, SignalTone>;

export function SectionControl({
  selected,
  onChange,
}: {
  selected: SectionId;
  onChange: (section: SectionId) => void;
}) {
  return (
    <div className="grid min-h-11 grid-cols-2 gap-2 rounded-md bg-white/[0.07] p-1 shadow-[0_12px_30px_rgba(0,5,18,0.22)] backdrop-blur-xl md:grid-cols-4 xl:grid-cols-6">
      {SECTIONS.map((section) => {
        const Icon = icons[section.id];
        const active = section.id === selected;
        return (
          <button
            key={section.id}
            type="button"
            title={section.label}
            aria-pressed={active}
            onClick={() => onChange(section.id)}
            className={`flex h-10 min-w-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md px-2 text-xs font-medium shadow-[0_10px_20px_rgba(0,5,18,0.12)] transition hover:-translate-y-px sm:px-3 sm:text-sm ${
              active
                ? "bg-[linear-gradient(135deg,#5eead4,#7dd3fc_48%,#c4b5fd)] text-[#061322] shadow-[0_12px_26px_rgba(45,212,191,0.18)]"
                : "bg-white/[0.08] text-[var(--muted-strong)] hover:bg-white/[0.16] hover:text-[var(--foreground)]"
            }`}
          >
            <SignalIcon
              icon={Icon}
              tone={iconTones[section.id]}
              className={active ? "shadow-none" : ""}
            />
            <span className="min-w-0 truncate leading-none">{section.label}</span>
          </button>
        );
      })}
    </div>
  );
}
