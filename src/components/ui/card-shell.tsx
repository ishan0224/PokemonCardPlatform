import type { ReactNode } from "react";

type CardShellVariant = "surface" | "elevated";

type CardShellProps = {
  header?: ReactNode;
  media?: ReactNode;
  body?: ReactNode;
  actions?: ReactNode;
  variant?: CardShellVariant;
  className?: string;
};

function cx(...parts: Array<string | undefined | null | false>): string {
  return parts.filter(Boolean).join(" ");
}

const variantClassName: Record<CardShellVariant, string> = {
  surface: "bg-white",
  elevated: "bg-white shadow-[0_20px_40px_-28px_rgba(20,23,31,0.45)]"
};

export function CardShell({
  header,
  media,
  body,
  actions,
  variant = "surface",
  className
}: CardShellProps): JSX.Element {
  return (
    <article className={cx("flex h-full flex-col rounded-2xl border border-pv-border p-4", variantClassName[variant], className)}>
      {header ? <header>{header}</header> : null}
      {media ? <div className={header ? "mt-3" : undefined}>{media}</div> : null}
      {body ? <div className={cx(header || media ? "mt-3" : undefined, "flex-1")}>{body}</div> : <div className="flex-1" />}
      {actions ? <div className={header || media || body ? "mt-3" : undefined}>{actions}</div> : null}
    </article>
  );
}
