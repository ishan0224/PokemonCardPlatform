"use client";

import type { ReactNode } from "react";

export type SegmentedOption<T extends string> = {
  id: T;
  label: ReactNode;
  count?: number;
};

type SegmentedProps<T extends string> = {
  value: T;
  onChange: (next: T) => void;
  options: ReadonlyArray<SegmentedOption<T>>;
  ariaLabel: string;
  className?: string;
};

function cx(...parts: Array<string | undefined | null | false>): string {
  return parts.filter(Boolean).join(" ");
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  className
}: SegmentedProps<T>): JSX.Element {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cx(
        "inline-flex gap-0.5 rounded-pv border border-pv-line bg-pv-surface-2 p-[3px]",
        className
      )}
    >
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.id)}
            className={cx(
              "rounded-[7px] px-3 py-1.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-gold",
              active ? "bg-pv-surface-4 text-pv-text" : "text-pv-muted hover:text-pv-text"
            )}
          >
            {opt.label}
            {typeof opt.count === "number" ? (
              <span className="ml-1 text-pv-muted-2">({opt.count})</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
