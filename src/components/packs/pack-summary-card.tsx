import Link from "next/link";
import { CardImage } from "@/components/ui/card-image";
import { CardShell } from "@/components/ui/card-shell";
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
  const statusLabel = pack.opened ? "Opened" : "Unopened";
  const statusTheme = pack.opened ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900";

  const header = (
    <div className="flex items-start justify-between gap-2">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-pv-muted">{formatTierLabel(pack.tier)}</p>
        <h3 className="mt-1 text-base font-black text-pv-ink">{pack.dropName}</h3>
      </div>
      <span className={`rounded-full px-2 py-1 text-xs font-bold ${statusTheme}`}>{statusLabel}</span>
    </div>
  );

  const media = (
    <div className="flex justify-center">
      <CardImage
        src={DROP_PACK_IMAGE_BY_TIER[pack.tier]}
        alt={`${formatTierLabel(pack.tier)} pack`}
        size="lg"
        frame="pack"
      />
    </div>
  );

  const body = (
    <div className="space-y-2 text-sm text-pv-muted">
      <p>
        Scheduled <span className="font-semibold text-pv-ink">{formatDateTime(pack.dropScheduledAt)}</span>
      </p>
      <p>
        Purchased <span className="font-semibold text-pv-ink">{formatDateTime(pack.purchasedAt)}</span>
      </p>
      <p>
        Paid <span className="font-semibold text-pv-ink">{formatMoneyCents(pack.pricePaid)}</span>
      </p>
    </div>
  );

  const actions = (
    <Link
      href={routes.packs.reveal(pack.id)}
      className={buttonClassName({
        variant: pack.opened ? "secondary" : "primary",
        size: "sm",
        fullWidth: true
      })}
    >
      {pack.opened ? "View reveal" : "Open pack"}
    </Link>
  );

  return <CardShell header={header} media={media} body={body} actions={actions} variant="surface" className="min-h-[420px]" />;
}
