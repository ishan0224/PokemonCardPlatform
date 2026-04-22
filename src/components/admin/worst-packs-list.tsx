import type { WorstPack } from "@/lib/types";
import { formatMoneyCents, formatSignedMoneyCents } from "@/lib/format";

type WorstPacksListProps = {
  packs: WorstPack[];
};

function formatRelative(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  const deltaSec = Math.max(0, (Date.now() - parsed.getTime()) / 1000);
  if (deltaSec < 60) return "just now";
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ago`;
  if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)}h ago`;
  const days = Math.floor(deltaSec / 86400);
  return days === 1 ? "1d ago" : `${days}d ago`;
}

function tierLabel(tier: string): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

export function WorstPacksList({ packs }: WorstPacksListProps): JSX.Element {
  return (
    <section className="h-full rounded-pv-lg border border-pv-line bg-pv-surface-2 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-pv-h3">Worst packs</h2>
        <span className="text-[11px] text-pv-muted">below-cost pulls</span>
      </div>

      {packs.length === 0 ? (
        <p className="text-[13px] text-pv-muted">No negative-margin packs in this window.</p>
      ) : (
        <ul className="space-y-2 text-[13px]">
          {packs.map((pack) => {
            const ratio = pack.pricePaidCents > 0 ? pack.realizedEvCents / pack.pricePaidCents : 0;
            return (
              <li key={pack.packId} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-bold text-pv-text">
                    {tierLabel(pack.tier)} · #{pack.packId.slice(0, 4)}…
                  </p>
                  <p className="truncate text-[11px] text-pv-muted">
                    ratio {ratio.toFixed(2)} · {formatRelative(pack.purchasedAtIso)} · paid{" "}
                    {formatMoneyCents(pack.pricePaidCents)}
                  </p>
                </div>
                <p
                  className={`shrink-0 font-extrabold tabular-nums ${
                    pack.marginCents < 0 ? "text-pv-accent" : "text-pv-good"
                  }`}
                >
                  {formatSignedMoneyCents(pack.marginCents)}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
