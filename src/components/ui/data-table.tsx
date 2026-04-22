import type { ReactNode } from "react";

type DataTableProps = {
  children: ReactNode;
  className?: string;
  /** Optional aria-label for the table. */
  ariaLabel?: string;
};

function cx(...parts: Array<string | undefined | null | false>): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * Thin structural wrapper to keep dark-palette table styling consistent across admin surfaces.
 * Caller renders <thead> / <tbody> / <tr> / <th> / <td> directly; classes resolve via this wrapper.
 *
 * Usage:
 *   <DataTable ariaLabel="Drops">
 *     <thead><tr><th>…</th></tr></thead>
 *     <tbody><tr><td>…</td></tr></tbody>
 *   </DataTable>
 */
export function DataTable({ children, className, ariaLabel }: DataTableProps): JSX.Element {
  return (
    <div
      className={cx(
        "overflow-x-auto rounded-pv-lg border border-pv-line bg-pv-surface-2",
        className
      )}
    >
      <table
        aria-label={ariaLabel}
        className={cx(
          "w-full border-collapse text-sm",
          "[&_th]:px-[14px] [&_th]:py-3 [&_th]:text-left [&_th]:text-[11px] [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-[0.08em] [&_th]:text-pv-muted [&_th]:border-b [&_th]:border-pv-line",
          "[&_td]:px-[14px] [&_td]:py-3 [&_td]:text-[13px]",
          "[&_tbody_tr]:border-b [&_tbody_tr]:border-pv-line [&_tbody_tr:last-child]:border-b-0",
          "[&_tbody_tr:hover]:bg-pv-surface-3"
        )}
      >
        {children}
      </table>
    </div>
  );
}
