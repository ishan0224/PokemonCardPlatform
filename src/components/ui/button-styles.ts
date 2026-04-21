export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

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
  primary: "border border-transparent bg-pv-accent text-white hover:bg-pv-accent-strong",
  secondary: "border border-pv-border bg-white text-pv-ink hover:bg-pv-parchment-soft",
  ghost: "border border-transparent bg-transparent text-pv-ink hover:bg-pv-parchment-soft",
  danger: "border border-transparent bg-pv-danger text-white hover:bg-pv-danger-strong"
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "min-h-11 rounded-lg px-3 py-2 text-sm",
  md: "min-h-11 rounded-xl px-4 py-2.5 text-sm",
  lg: "min-h-12 rounded-xl px-5 py-3 text-base"
};

export function buttonClassName(options: ButtonClassOptions = {}): string {
  const { variant = "primary", size = "md", fullWidth = false, className } = options;

  return cx(
    "inline-flex items-center justify-center gap-2 font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pv-parchment disabled:cursor-not-allowed disabled:opacity-60",
    variantClasses[variant],
    sizeClasses[size],
    fullWidth ? "w-full" : undefined,
    className
  );
}
