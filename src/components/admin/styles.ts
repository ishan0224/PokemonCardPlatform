import type { PackTier, RevenueStreamKey } from "@/lib/types";

type StreamStyle = {
  label: string;
  swatchClass: string;
  textClass: string;
  badgeClass: string;
};

export const STREAM_STYLES: Record<RevenueStreamKey, StreamStyle> = {
  pack_margin: {
    label: "Pack margin",
    swatchClass: "bg-rose-500",
    textClass: "text-rose-600",
    badgeClass: "bg-rose-50 text-rose-700 border-rose-200"
  },
  auction_fee: {
    label: "Auction fees",
    swatchClass: "bg-amber-500",
    textClass: "text-amber-600",
    badgeClass: "bg-amber-50 text-amber-700 border-amber-200"
  },
  trade_fee: {
    label: "Trade fees",
    swatchClass: "bg-indigo-500",
    textClass: "text-indigo-600",
    badgeClass: "bg-indigo-50 text-indigo-700 border-indigo-200"
  },
  platform_discount: {
    label: "Platform discount",
    swatchClass: "bg-slate-400",
    textClass: "text-slate-600",
    badgeClass: "bg-slate-50 text-slate-700 border-slate-200"
  },
  manual_adjustment: {
    label: "Manual adjustment",
    swatchClass: "bg-slate-500",
    textClass: "text-slate-700",
    badgeClass: "bg-slate-50 text-slate-700 border-slate-200"
  }
};

type TierStyle = {
  label: string;
  gradientClass: string;
  avatarClass: string;
  avatarLabel: string;
};

export const TIER_STYLES: Record<PackTier, TierStyle> = {
  standard: {
    label: "Standard",
    gradientClass: "from-slate-400 to-slate-600",
    avatarClass: "bg-slate-200 text-slate-700",
    avatarLabel: "S"
  },
  premium: {
    label: "Premium",
    gradientClass: "from-indigo-400 to-indigo-600",
    avatarClass: "bg-indigo-100 text-indigo-700",
    avatarLabel: "P"
  },
  elite: {
    label: "Elite",
    gradientClass: "from-amber-300 to-amber-500",
    avatarClass: "bg-amber-100 text-amber-700",
    avatarLabel: "E"
  }
};
