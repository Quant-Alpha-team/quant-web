import { AlertTriangle, LoaderCircle } from "lucide-react";
import { SignalIcon, type SignalTone } from "@/components/signal-icon";

export function StatusMessage({
  tone,
  children,
}: {
  tone: "loading" | "info" | "error";
  children: React.ReactNode;
}) {
  const Icon = tone === "loading" ? LoaderCircle : AlertTriangle;
  const iconTone: SignalTone =
    tone === "loading" ? "cyan" : tone === "error" ? "rose" : "amber";
  const color =
    tone === "error"
      ? "bg-rose-400/[0.16] text-rose-100"
      : "bg-white/[0.08] text-[var(--muted-strong)]";

  return (
    <div className={`flex items-center gap-3 rounded-md px-4 py-3 shadow-[0_10px_28px_var(--shadow)] backdrop-blur-xl ${color}`}>
      <SignalIcon
        icon={Icon}
        tone={iconTone}
        iconClassName={tone === "loading" ? "animate-spin" : ""}
      />
      <div className="text-sm leading-6">{children}</div>
    </div>
  );
}
