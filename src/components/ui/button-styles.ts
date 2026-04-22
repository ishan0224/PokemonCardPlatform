export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "gold";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

export type ButtonClassOptions = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
};

function cx(...parts: Array<string | undefined | null | false>): string {
  return parts.filter(Boolean).join(" ");
}

const variantClasses: Record<ButtonVariant, string> = {
  // .btn--primary: whitish default, even lighter on hover.
  // Uses arbitrary color values (not `bg-white`) to bypass the legacy
  // `.bg-white → --pv-surface-2` shim in globals.css that other in-progress
  // components still depend on.
  primary: "border border-transparent bg-[#f5f5f5] text-pv-surface hover:bg-[#ffffff]",
  // .btn--secondary: bg ink-3 color text border line · hover border line-strong only
  secondary:
    "border border-pv-line bg-pv-surface-3 text-pv-text hover:border-pv-line-strong",
  // .btn--ghost: color muted · hover color text + bg ink-2
  ghost:
    "border border-transparent bg-transparent text-pv-muted hover:bg-pv-surface-2 hover:text-pv-text",
  // .btn--danger: bg accent color #fff (no declared hover)
  danger: "border border-transparent bg-pv-accent text-white",
  // .btn--gold: bg gold color #0a0a0a (no declared hover)
  gold: "border border-transparent bg-pv-gold text-pv-surface"
};

// Matches demo .btn: padding 10px 14px, border-radius 10px, font 700/13px
const sizeClasses: Record<ButtonSize, string> = {
  xs: "min-h-8 rounded-[8px] px-2.5 py-1 text-[11px]",
  sm: "min-h-9 rounded-[10px] px-3 py-1.5 text-[12px]",
  md: "min-h-10 rounded-[10px] px-[14px] py-2.5 text-[13px]",
  lg: "min-h-12 rounded-[10px] px-5 py-3 text-[14px]"
};

export function buttonClassName(options: ButtonClassOptions = {}): string {
  const { variant = "primary", size = "md", fullWidth = false, className } = options;

  return cx(
    "inline-flex items-center justify-center gap-2 font-bold tracking-[0.01em] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-gold focus-visible:ring-offset-2 focus-visible:ring-offset-pv-surface disabled:cursor-not-allowed disabled:opacity-50 active:translate-y-px",
    variantClasses[variant],
    sizeClasses[size],
    fullWidth ? "w-full" : undefined,
    className
  );
}
