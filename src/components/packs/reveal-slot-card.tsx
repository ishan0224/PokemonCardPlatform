import type { PackCard } from "@/lib/api-client";
import { formatMoneyCents } from "@/lib/format";

type RevealSlotCardProps = {
  slotNumber: number;
  card?: PackCard;
  pending?: boolean;
  onReveal?: () => void;
};

export function RevealSlotCard({ slotNumber, card, pending = false, onReveal }: RevealSlotCardProps): JSX.Element {
  const isRevealed = Boolean(card);

  return (
    <article className="flex min-h-56 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Slot {slotNumber}</span>
        {card ? (
          <span className="rounded-full bg-slate-900 px-2 py-1 text-xs font-bold uppercase text-white">{card.rarityTier}</span>
        ) : null}
      </div>

      <div className="mt-3 flex flex-1 flex-col justify-center">
        {isRevealed && card ? (
          <div>
            <h3 className="text-lg font-black text-slate-900">{card.pokemonCard.name}</h3>
            <p className="text-sm text-slate-600">{card.pokemonCard.setName}</p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-lg bg-slate-100 p-2">
                <p className="text-xs uppercase text-slate-500">Acquired</p>
                <p className="font-bold text-slate-900">{formatMoneyCents(card.acquisitionPrice)}</p>
              </div>
              <div className="rounded-lg bg-emerald-100 p-2">
                <p className="text-xs uppercase text-emerald-700">Market</p>
                <p className="font-bold text-emerald-900">{formatMoneyCents(card.pokemonCard.currentPrice)}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-sm font-semibold text-slate-500">
            Face-down card
          </div>
        )}
      </div>

      {!isRevealed && onReveal ? (
        <button
          type="button"
          disabled={pending}
          onClick={onReveal}
          className={`mt-4 rounded-xl px-3 py-2 text-sm font-bold transition ${
            pending ? "cursor-not-allowed bg-slate-200 text-slate-500" : "bg-rose-600 text-white hover:bg-rose-700"
          }`}
        >
          {pending ? "Revealing..." : "Reveal"}
        </button>
      ) : null}
    </article>
  );
}
