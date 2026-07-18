import {
  Banknote,
  CircleDollarSign,
  type LucideIcon,
  ReceiptText,
  TrendingUp,
} from "lucide-react";
import { SignalIcon, type SignalTone } from "@/components/signal-icon";

export function MetricCard({
  label,
  value,
  delta,
  tone = "neutral",
  deltaTone = "neutral",
  icon,
  iconTone,
}: {
  label: string;
  value: string;
  delta?: string;
  tone?: "neutral" | "profit" | "loss";
  deltaTone?: "neutral" | "profit" | "loss";
  icon?: LucideIcon;
  iconTone?: SignalTone;
}) {
  const deltaClass =
    deltaTone === "profit"
      ? "text-[var(--profit)]"
      : deltaTone === "loss"
        ? "text-[var(--loss)]"
        : "text-[var(--muted)]";
  const edgeClass =
    tone === "profit"
      ? "from-[rgba(62,207,142,0.28)]"
      : tone === "loss"
        ? "from-[rgba(245,111,111,0.28)]"
        : "from-[rgba(155,231,216,0.18)]";
  const fallbackIcon =
    icon ??
    (label.includes("Commission")
      ? ReceiptText
      : label.includes("Open")
        ? TrendingUp
        : label.includes("P&L")
          ? CircleDollarSign
          : Banknote);
  const fallbackTone =
    iconTone ??
    (tone === "profit"
      ? "green"
      : tone === "loss"
        ? "rose"
        : label.includes("Commission")
          ? "amber"
          : label.includes("Open")
            ? "violet"
            : "mint");

  return (
    <div className="relative h-full min-h-[154px] overflow-hidden rounded-md bg-[radial-gradient(circle_at_100%_0%,rgba(125,211,252,0.13),transparent_38%),linear-gradient(180deg,rgba(255,255,255,0.11),rgba(255,255,255,0.055))] p-4 shadow-[0_18px_42px_var(--shadow)] backdrop-blur-xl">
      <div
        className={`absolute inset-x-0 top-0 h-px bg-linear-to-r ${edgeClass} to-transparent`}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-normal text-[var(--muted)]">
            {label}
          </div>
        </div>
        <SignalIcon icon={fallbackIcon} tone={fallbackTone} className="shrink-0" />
      </div>
      <div className="mt-5 text-[clamp(1.9rem,2.2vw,2.8rem)] leading-none font-semibold text-[var(--foreground)]">
        {value}
      </div>
      {delta ? (
        <div className={`mt-2 text-sm font-medium ${deltaClass}`}>{delta}</div>
      ) : null}
    </div>
  );
}
