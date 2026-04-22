import type { RarityTier } from "@/lib/types";

type RarityBadgeProps = {
  rarity: RarityTier;
  compact?: boolean;
  className?: string;
};

function cx(...parts: Array<string | undefined | null | false>): string {
  return parts.filter(Boolean).join(" ");
}

const rarityLabel: Record<RarityTier, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  holo_rare: "Holo",
  ultra_rare: "Ultra",
  chase: "Chase"
};

const rarityClassName: Record<RarityTier, string> = {
  common: "bg-[rgba(154,163,178,0.14)] text-pv-r-common",
  uncommon: "bg-[rgba(16,185,129,0.14)] text-pv-r-uncommon",
  rare: "bg-[rgba(56,189,248,0.14)] text-pv-r-rare",
  holo_rare: "bg-[rgba(167,139,250,0.18)] text-pv-r-holo",
  ultra_rare: "bg-[rgba(244,114,182,0.18)] text-pv-r-ultra",
  chase: "bg-gradient-to-br from-[rgba(255,234,155,0.2)] to-[rgba(255,130,169,0.2)] text-pv-gold"
};

export function RarityBadge({ rarity, compact = false, className }: RarityBadgeProps): JSX.Element {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-md font-extrabold uppercase tracking-[0.08em]",
        compact ? "px-2 py-0.5 text-[10px]" : "px-2 py-1 text-[10px]",
        rarityClassName[rarity],
        className
      )}
    >
      {rarityLabel[rarity]}
    </span>
  );
}
