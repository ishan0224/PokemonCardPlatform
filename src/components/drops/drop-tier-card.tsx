import { Button } from "@/components/ui/button";
import { CardImage, type CardImageSize } from "@/components/ui/card-image";
import { CardShell } from "@/components/ui/card-shell";
import type { DropTier } from "@/lib/api-client";
import { formatMoneyCents, formatTierLabel } from "@/lib/format";

const DROP_PACK_IMAGE_BY_TIER = {
  standard: "/images/drop/StandardDropPackImage.png",
  premium: "/images/drop/PremiumDropPackImage.png",
  elite: "/images/drop/EliteDropPackImage.png"
} as const;

type DropTierCardProps = {
  tier: DropTier;
  countdownText?: string;
  imageSize?: CardImageSize;
  imageZoom?: number;
  actionLabel?: string;
  actionDisabled?: boolean;
  actionLoading?: boolean;
  onAction?: () => void;
};

export function DropTierCard({
  tier,
  countdownText,
  imageSize = "md",
  imageZoom = 1,
  actionLabel,
  actionDisabled = false,
  actionLoading = false,
  onAction
}: DropTierCardProps): JSX.Element {
  const soldOut = tier.remainingInventory <= 0;
  const tierLabel = formatTierLabel(tier.tier);

  const media = (
    <div className="relative flex justify-center">
      <CardImage src={DROP_PACK_IMAGE_BY_TIER[tier.tier]} alt={`${tierLabel} pack`} size={imageSize} frame="pack" zoom={imageZoom} />
      {countdownText ? (
        <span className="pointer-events-none absolute right-2 top-2 rounded-lg bg-black/40 px-2 py-1 text-xs font-bold tracking-wide text-white">
          {countdownText}
        </span>
      ) : null}
      <div className="pointer-events-none absolute bottom-2 left-2 rounded-lg bg-black/45 px-2 py-1 text-xs text-white">
        <p className="font-semibold">Remaining {tier.remainingInventory}</p>
        <p className="font-medium text-slate-200">Total {tier.totalInventory}</p>
      </div>
    </div>
  );

  const actions =
    actionLabel && onAction ? (
      <Button type="button" fullWidth onClick={onAction} disabled={actionDisabled || soldOut || actionLoading} loading={actionLoading}>
        {actionLoading ? "Processing..." : soldOut ? "Sold Out" : `${actionLabel} • ${formatMoneyCents(tier.price)}`}
      </Button>
    ) : undefined;

  return (
    <CardShell media={media} actions={actions} variant="surface" className="border-transparent bg-transparent p-0" />
  );
}
