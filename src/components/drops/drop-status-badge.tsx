import type { DropStatus } from "@/lib/types";

const statusTheme: Record<DropStatus, string> = {
  active: "bg-emerald-100 text-emerald-800 border-emerald-300",
  upcoming: "bg-amber-100 text-amber-800 border-amber-300",
  completed: "bg-slate-200 text-slate-700 border-slate-300"
};

export function DropStatusBadge({ status }: { status: DropStatus }): JSX.Element {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wide ${statusTheme[status]}`}
    >
      {status}
    </span>
  );
}
