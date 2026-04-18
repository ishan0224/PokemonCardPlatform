import type { WorstPack } from "@/lib/types";
import { formatDateTime, formatMoneyCents, formatSignedMoneyCents } from "@/lib/format";
import { LeaderboardItem } from "./leaderboard-item";
import { TIER_STYLES } from "./styles";

type WorstPacksListProps = {
  packs: WorstPack[];
};

function shareLabel(shareBps: number | null): string {
  if (shareBps === null || shareBps === 0) {
    return "—";
  }
  return `${(shareBps / 100).toFixed(1)}% of bleed`;
}

export function WorstPacksList({ packs }: WorstPacksListProps): JSX.Element {
  if (packs.length === 0) {
    return (
      <section className="h-full w-full rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-sm font-bold uppercase tracking-widest text-slate-500">Worst packs</h2>
        <p className="mt-2 text-sm text-slate-500">No negative-margin packs in this window.</p>
      </section>
    );
  }

  const topShareBps = packs[0]?.shareOfTotalBleedBps ?? null;

  return (
    <section className="h-full w-full rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="text-sm font-bold uppercase tracking-widest text-slate-500">Worst packs · margin leaderboard</h2>
      <p className="mt-1 text-xs text-slate-500">
        Single packs that bled the most.
        {topShareBps !== null
          ? ` Top pack alone accounts for ${(topShareBps / 100).toFixed(1)}% of total loss.`
          : ""}
      </p>

      <div className="mt-4 space-y-2">
        {packs.map((pack) => {
          const style = TIER_STYLES[pack.tier];
          return (
            <LeaderboardItem
              key={pack.packId}
              avatar={{ label: style.avatarLabel, className: style.avatarClass }}
              title={style.label}
              subtitle={
                <span>
                  {style.label} · {formatMoneyCents(pack.pricePaidCents)} · {formatDateTime(pack.purchasedAtIso)} · buyer {pack.buyerIdPrefix}…
                </span>
              }
              primaryValue={formatSignedMoneyCents(pack.marginCents)}
              primaryClassName={pack.marginCents < 0 ? "text-rose-600" : "text-emerald-600"}
              secondaryValue={
                <span>
                  EV {formatMoneyCents(pack.realizedEvCents)}
                  {pack.shareOfTotalBleedBps !== null ? (
                    <span className="ml-2 rounded-full border border-rose-200 bg-rose-50 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-rose-700">
                      {shareLabel(pack.shareOfTotalBleedBps)}
                    </span>
                  ) : null}
                </span>
              }
            />
          );
        })}
      </div>
    </section>
  );
}
