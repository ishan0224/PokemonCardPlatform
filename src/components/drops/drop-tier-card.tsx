import type { DropTier } from "@/lib/api-client";
import { formatMoneyCents, formatTierLabel } from "@/lib/format";

type DropTierCardProps = {
  tier: DropTier;
  actionLabel?: string;
  actionDisabled?: boolean;
  actionLoading?: boolean;
  onAction?: () => void;
};

export function DropTierCard({
  tier,
  actionLabel,
  actionDisabled = false,
  actionLoading = false,
  onAction
}: DropTierCardProps): JSX.Element {
  const soldOut = tier.remainingInventory <= 0;

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-black text-slate-900">{formatTierLabel(tier.tier)}</h3>
        <span className="text-sm font-semibold text-slate-600">{formatMoneyCents(tier.price)}</span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-sm text-slate-600">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Remaining</p>
          <p className={`font-bold ${soldOut ? "text-rose-700" : "text-slate-900"}`}>{tier.remainingInventory}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Total</p>
          <p className="font-bold text-slate-900">{tier.totalInventory}</p>
        </div>
      </div>

      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          disabled={actionDisabled || soldOut || actionLoading}
          className={`mt-4 w-full rounded-xl px-3 py-2 text-sm font-bold transition ${
            actionDisabled || soldOut || actionLoading
              ? "cursor-not-allowed bg-slate-200 text-slate-500"
              : "bg-slate-900 text-white hover:bg-slate-700"
          }`}
        >
          {actionLoading ? "Processing..." : soldOut ? "Sold Out" : actionLabel}
        </button>
      ) : null}
    </article>
  );
}
