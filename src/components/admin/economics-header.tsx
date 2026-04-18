"use client";

export type WindowPreset = "1h" | "24h" | "7d" | "31d";

type EconomicsHeaderProps = {
  preset: WindowPreset;
  fromIso: string;
  toIso: string;
  onPresetChange: (preset: WindowPreset) => void;
  onRefresh: () => void;
  refreshing: boolean;
};

const PRESETS: Array<{ value: WindowPreset; label: string }> = [
  { value: "1h", label: "1h" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "31d", label: "31d" }
];

function formatWindowRange(fromIso: string, toIso: string): string {
  const fromDate = new Date(fromIso);
  const toDate = new Date(toIso);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return `${fromIso} → ${toIso}`;
  }
  const format = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  return `${format.format(fromDate)} → ${format.format(toDate)} UTC`;
}

export function EconomicsHeader({
  preset,
  fromIso,
  toIso,
  onPresetChange,
  onRefresh,
  refreshing
}: EconomicsHeaderProps): JSX.Element {
  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 pb-4">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span>Admin</span>
        <span>/</span>
        <span className="font-semibold text-slate-900">Economics</span>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-mono text-xs text-slate-600">
          {formatWindowRange(fromIso, toIso)}
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-semibold">
          {PRESETS.map((option) => {
            const active = option.value === preset;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onPresetChange(option.value)}
                className={`rounded-md px-3 py-1 transition ${
                  active ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
        <button
          type="button"
          disabled
          title="CSV export is deferred — see docs/phase-8-implementation-plan.md §5."
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-400 cursor-not-allowed"
        >
          Export CSV
        </button>
      </div>
    </header>
  );
}
