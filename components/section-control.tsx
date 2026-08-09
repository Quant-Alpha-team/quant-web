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
    <nav aria-label="Dashboard sections">
      <ul className="grid min-h-11 grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-2 rounded-md bg-white/[0.07] p-1 shadow-[0_12px_30px_rgba(0,5,18,0.22)] backdrop-blur-xl">
        {SECTIONS.map((section) => {
          const Icon = icons[section.id];
          const active = section.id === selected;
          return (
            <li key={section.id} className="flex min-w-0">
              <button
                type="button"
                title={section.label}
                aria-current={active ? "page" : undefined}
                onClick={() => onChange(section.id)}
                className={`flex min-h-11 w-full min-w-0 cursor-pointer items-center justify-center gap-2 whitespace-normal rounded-md px-2 py-2 text-xs font-medium shadow-[0_10px_20px_rgba(0,5,18,0.12)] transition hover:-translate-y-px sm:px-3 sm:text-sm ${
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
                <span className="min-w-0 text-center leading-tight">
                  {section.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
