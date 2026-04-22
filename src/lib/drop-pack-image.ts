import type { PackTier } from "@/lib/types";

const TIER_ORDER: Record<PackTier, number> = {
  standard: 0,
  premium: 1,
  elite: 2
};

type ImageMeta = {
  path: string;
  width: number;
  height: number;
};

const DROP_PACK_IMAGE_BY_TIER_SET: Record<string, ImageMeta> = {
  standard: {
    path: "/images/drop/StandardDropPackImage.png",
    width: 2400,
    height: 1309
  },
  premium: {
    path: "/images/drop/PremiumDropPackImage.png",
    width: 2400,
    height: 1309
  },
  elite: {
    path: "/images/drop/EliteDropPackImage.png",
    width: 2400,
    height: 1309
  },
  "standard+premium": {
    path: "/images/drop/StandardAndPremiumDropPack.png",
    width: 554,
    height: 594
  },
  "standard+elite": {
    path: "/images/drop/StandardAndEliteDropPack.png",
    width: 518,
    height: 580
  },
  "premium+elite": {
    path: "/images/drop/PremiumAndEliteDropPack.png",
    width: 499,
    height: 570
  },
  "standard+premium+elite": {
    path: "/images/drop/PremiumAndEliteAndStandardDropPack.png",
    width: 603,
    height: 592
  }
};

const FALLBACK_META: ImageMeta = {
  path: "/card-back.svg",
  width: 160,
  height: 224
};

function normalizeTierSet(tiers: PackTier[]): string {
  const unique = Array.from(new Set(tiers)).sort((left, right) => TIER_ORDER[left] - TIER_ORDER[right]);
  return unique.join("+");
}

function resolveImageMeta(tiers: PackTier[]): ImageMeta {
  const key = normalizeTierSet(tiers);
  return DROP_PACK_IMAGE_BY_TIER_SET[key] ?? FALLBACK_META;
}

export function dropPackImagePath(tiers: PackTier[]): string {
  return resolveImageMeta(tiers).path;
}

export function dropPackImageDimensions(tiers: PackTier[]): { width: number; height: number } {
  const meta = resolveImageMeta(tiers);
  return {
    width: meta.width,
    height: meta.height
  };
}
