import type { ReactNode } from "react";

type CardShellVariant = "surface" | "elevated";
type CardShellTone =
  | "default"
  | "rarity-holo"
  | "rarity-ultra"
  | "rarity-chase"
  | "accent"
  | "danger"
  | "info";

type CardShellProps = {
  header?: ReactNode;
  media?: ReactNode;
  body?: ReactNode;
  actions?: ReactNode;
  variant?: CardShellVariant;
  tone?: CardShellTone;
  className?: string;
};

function cx(...parts: Array<string | undefined | null | false>): string {
  return parts.filter(Boolean).join(" ");
}

const variantClassName: Record<CardShellVariant, string> = {
  surface: "bg-pv-surface-2",
  elevated: "bg-pv-surface-3 shadow-pv-card"
};

const toneClassName: Record<CardShellTone, string> = {
  default: "border-pv-line",
  "rarity-holo":
    "border-pv-r-holo/30 bg-gradient-to-b from-[rgba(167,139,250,0.06)] to-transparent",
  "rarity-ultra":
    "border-pv-r-ultra/45 shadow-pv-ultra bg-gradient-to-b from-[rgba(244,114,182,0.08)] to-transparent",
  "rarity-chase":
    "border-[rgba(255,234,155,0.35)] bg-gradient-to-b from-[rgba(255,234,155,0.06)] to-transparent",
  accent:
    "border-pv-gold/35 bg-gradient-to-b from-pv-gold-soft to-transparent",
  danger:
    "border-pv-accent/35 bg-gradient-to-b from-[rgba(239,68,68,0.08)] to-transparent",
  info:
    "border-pv-info/30 bg-[rgba(56,189,248,0.04)]"
};

export function CardShell({
  header,
  media,
  body,
  actions,
  variant = "surface",
  tone = "default",
  className
}: CardShellProps): JSX.Element {
  return (
    <article
      className={cx(
        "flex h-full flex-col rounded-pv-lg border p-4 transition-colors",
        variantClassName[variant],
        toneClassName[tone],
        className
      )}
    >
      {header ? <header>{header}</header> : null}
      {media ? <div className={header ? "mt-3" : undefined}>{media}</div> : null}
      {body ? (
        <div className={cx(header || media ? "mt-3" : undefined, "flex-1")}>{body}</div>
      ) : (
        <div className="flex-1" />
      )}
      {actions ? <div className={header || media || body ? "mt-3" : undefined}>{actions}</div> : null}
    </article>
  );
}
