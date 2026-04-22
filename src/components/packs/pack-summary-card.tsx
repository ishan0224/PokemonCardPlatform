import Link from "next/link";
import { CardImage } from "@/components/ui/card-image";
import { CardShell } from "@/components/ui/card-shell";
import { Chip } from "@/components/ui/chip";
import { buttonClassName } from "@/components/ui/button";
import { formatDateTime, formatMoneyCents, formatTierLabel } from "@/lib/format";
import { routes } from "@/lib/routes";
import type { PackSummary } from "@/lib/api-client";

const DROP_PACK_IMAGE_BY_TIER = {
  standard: "/images/drop/StandardDropPackImage.png",
  premium: "/images/drop/PremiumDropPackImage.png",
  elite: "/images/drop/EliteDropPackImage.png"
} as const;

type PackSummaryCardProps = {
  pack: PackSummary;
};

export function PackSummaryCard({ pack }: PackSummaryCardProps): JSX.Element {
  const header = (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-pv-muted">
          {formatTierLabel(pack.tier)}
        </p>
        <h3 className="mt-1 truncate text-[14px] font-bold text-pv-text">{pack.dropName}</h3>
      </div>
      {pack.opened ? <Chip tone="completed">Opened</Chip> : <Chip tone="gold">Unopened</Chip>}
    </div>
  );

  const media = (
    <div className={`flex justify-center ${pack.opened ? "opacity-60" : ""}`}>
      <CardImage
        src={DROP_PACK_IMAGE_BY_TIER[pack.tier]}
        alt={`${formatTierLabel(pack.tier)} pack`}
        size="lg"
        frame="pack"
      />
    </div>
  );

  const body = (
    <div className="space-y-1.5 text-[12px]">
      <div className="flex items-center justify-between">
        <span className="text-pv-muted">Scheduled</span>
        <span className="font-semibold text-pv-text">{formatDateTime(pack.dropScheduledAt)}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-pv-muted">Purchased</span>
        <span className="font-semibold text-pv-text">{formatDateTime(pack.purchasedAt)}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-pv-muted">Paid</span>
        <span className="font-extrabold tabular-nums text-pv-text">{formatMoneyCents(pack.pricePaid)}</span>
      </div>
    </div>
  );

  const actions = (
    <Link
      href={routes.packs.reveal(pack.id)}
      className={buttonClassName({
        variant: pack.opened ? "secondary" : "gold",
        size: "sm",
        fullWidth: true
      })}
    >
      {pack.opened ? "View reveal" : "Open pack"}
    </Link>
  );

  return (
    <CardShell
      header={header}
      media={media}
      body={body}
      actions={actions}
      variant="surface"
      className="min-h-[420px]"
    />
  );
}
