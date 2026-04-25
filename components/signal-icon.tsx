import type { ComponentType } from "react";

export type SignalTone = "mint" | "green" | "rose" | "amber" | "violet" | "cyan";

const toneClasses = {
  mint: "bg-[linear-gradient(135deg,#5eead4,#22d3ee)] text-[#05252a] shadow-[0_12px_26px_rgba(45,212,191,0.24)]",
  green:
    "bg-[linear-gradient(135deg,#86efac,#34d399)] text-[#062817] shadow-[0_12px_26px_rgba(52,211,153,0.22)]",
  rose: "bg-[linear-gradient(135deg,#fda4af,#fb7185)] text-[#330711] shadow-[0_12px_26px_rgba(251,113,133,0.22)]",
  amber:
    "bg-[linear-gradient(135deg,#fde68a,#fbbf24)] text-[#2b1b02] shadow-[0_12px_26px_rgba(251,191,36,0.18)]",
  violet:
    "bg-[linear-gradient(135deg,#c4b5fd,#f0abfc)] text-[#231041] shadow-[0_12px_26px_rgba(192,132,252,0.22)]",
  cyan: "bg-[linear-gradient(135deg,#67e8f9,#38bdf8)] text-[#042337] shadow-[0_12px_26px_rgba(56,189,248,0.22)]",
} satisfies Record<SignalTone, string>;

export function SignalIcon({
  icon: Icon,
  tone,
  className = "",
  iconClassName = "",
}: {
  icon: ComponentType<{ className?: string }>;
  tone: SignalTone;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <span
      className={`relative grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-md ${toneClasses[tone]} ${className}`}
    >
      <span className="absolute bottom-1 right-1 h-1 w-1 rounded-full bg-white/[0.75]" />
      <Icon className={`h-4 w-4 ${iconClassName}`} aria-hidden="true" />
    </span>
  );
}
