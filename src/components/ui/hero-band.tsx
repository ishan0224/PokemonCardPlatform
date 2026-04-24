import type { CSSProperties, ReactNode } from "react";

type HeroBandProps = {
  children: ReactNode;
  preview?: ReactNode;
  className?: string;
  /** CSS aspect-ratio string, e.g. "21/8" or "24/8". Default: "21/8". */
  aspect?: string;
};

function cx(...parts: Array<string | undefined | null | false>): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * Gradient hero band — purple/pink radial + gold highlight over ink base.
 * Matches demo/assets/styles.css .hero-band.
 */
export function HeroBand({ children, preview, className, aspect = "21/8" }: HeroBandProps): JSX.Element {
  return (
    <div
      className={cx(
        "relative flex items-end overflow-hidden rounded-pv-xl border border-pv-line p-5 sm:p-7",
        "min-h-[380px] sm:min-h-0 sm:aspect-[var(--hero-aspect)]",
        className
      )}
      style={{
        "--hero-aspect": aspect,
        backgroundImage: [
          "radial-gradient(80% 100% at 20% 60%, rgba(255,130,169,0.28), rgba(0,0,0,0) 55%)",
          "radial-gradient(80% 100% at 80% 40%, rgba(255,234,155,0.16), rgba(0,0,0,0) 55%)",
          "linear-gradient(120deg, #19111f 0%, #1a1327 55%, #261937 100%)"
        ].join(",")
      } as CSSProperties}
    >
      <div className="max-w-[520px]">{children}</div>
      {preview ? (
        <div
          className="pointer-events-none absolute bottom-6 right-6 hidden w-[220px] items-end justify-center sm:flex"
          aria-hidden="true"
        >
          {preview}
        </div>
      ) : null}
    </div>
  );
}
