"use client";

import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";

export type WindowPreset = "1h" | "24h" | "7d" | "31d";

type EconomicsHeaderProps = {
  preset: WindowPreset;
  fromIso: string;
  toIso: string;
  onPresetChange: (preset: WindowPreset) => void;
  onRefresh: () => void;
  refreshing: boolean;
};

const PRESETS: Array<{ id: WindowPreset; label: string }> = [
  { id: "1h", label: "1h" },
  { id: "24h", label: "24h" },
  { id: "7d", label: "7d" },
  { id: "31d", label: "31d" }
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
    <div className="flex flex-wrap items-center justify-end gap-2">
      <span className="rounded-[10px] border border-pv-line bg-pv-surface-3 px-3 py-1.5 font-mono text-[11px] text-pv-muted">
        {formatWindowRange(fromIso, toIso)}
      </span>
      <Segmented
        value={preset}
        options={PRESETS}
        onChange={onPresetChange}
        ariaLabel="Economics time window"
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={onRefresh}
        disabled={refreshing}
      >
        {refreshing ? "Refreshing…" : "Refresh"}
      </Button>
      <Button
        type="button"
        variant="primary"
        size="sm"
        disabled
        title="Rebalance flow is gated by admin-drop editor."
      >
        Rebalance
      </Button>
    </div>
  );
}
