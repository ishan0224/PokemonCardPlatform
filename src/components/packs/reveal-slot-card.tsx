import { Button } from "@/components/ui/button";
import { CardImage } from "@/components/ui/card-image";
import { CardShell } from "@/components/ui/card-shell";
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

  const header = (
    <div className="flex items-center justify-between">
      <span className="text-xs font-bold uppercase tracking-wide text-pv-muted">Slot {slotNumber}</span>
      {card ? <span className="rounded-full bg-pv-ink px-2 py-1 text-xs font-bold uppercase text-white">{card.rarityTier}</span> : null}
    </div>
  );

  const media = (
    <div className="flex justify-center">
      {isRevealed && card ? (
        <CardImage
          src={card.pokemonCard.imageUrl}
          hiresSrc={card.pokemonCard.imageUrlHires}
          alt={card.pokemonCard.name}
          size="md"
          rarityTier={card.rarityTier}
        />
      ) : (
        <CardImage src={null} alt={`Face-down card slot ${slotNumber}`} size="md" />
      )}
    </div>
  );

  const body =
    isRevealed && card ? (
      <div>
        <h3 className="text-lg font-black text-pv-ink">{card.pokemonCard.name}</h3>
        <p className="text-sm text-pv-muted">{card.pokemonCard.setName}</p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-lg bg-pv-parchment-soft p-2">
            <p className="text-xs uppercase text-pv-muted">Acquired</p>
            <p className="font-bold text-pv-ink">{formatMoneyCents(card.acquisitionPrice)}</p>
          </div>
          <div className="rounded-lg bg-emerald-100 p-2">
            <p className="text-xs uppercase text-emerald-700">Market</p>
            <p className="font-bold text-emerald-900">{formatMoneyCents(card.pokemonCard.currentPrice)}</p>
          </div>
        </div>
      </div>
    ) : (
      <div className="rounded-xl border border-dashed border-pv-border bg-pv-parchment-soft p-4 text-center text-sm font-semibold text-pv-muted">
        Face-down card
      </div>
    );

  const actions =
    !isRevealed && onReveal ? (
      <Button type="button" fullWidth loading={pending} onClick={onReveal}>
        {pending ? "Revealing..." : "Reveal"}
      </Button>
    ) : undefined;

  return (
    <CardShell header={header} media={media} body={body} actions={actions} variant="surface" className="min-h-56" />
  );
}
