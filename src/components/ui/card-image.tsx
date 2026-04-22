import Image from "next/image";
import type { RarityTier } from "@/lib/types";

export type CardImageSize = "sm" | "md" | "lg" | "xl";

type CardImageProps = {
  src: string | null;
  alt: string;
  size?: CardImageSize;
  frame?: "card" | "pack";
  zoom?: number;
  priority?: boolean;
  hiresSrc?: string | null;
  rarityTier?: RarityTier;
  className?: string;
};

type CardImageSizeConfig = {
  width: number;
  height: number;
  sizes: string;
};

const sizeConfig: Record<CardImageSize, CardImageSizeConfig> = {
  sm: {
    width: 120,
    height: 168,
    sizes: "(min-width: 1024px) 120px, 35vw"
  },
  md: {
    width: 160,
    height: 224,
    sizes: "(min-width: 1280px) 160px, (min-width: 768px) 22vw, 42vw"
  },
  lg: {
    width: 200,
    height: 280,
    sizes: "(min-width: 1280px) 200px, (min-width: 768px) 28vw, 56vw"
  },
  xl: {
    width: 240,
    height: 336,
    sizes: "(min-width: 1280px) 240px, (min-width: 768px) 34vw, 68vw"
  }
};

const packSizeConfig: Record<CardImageSize, CardImageSizeConfig> = {
  sm: {
    width: 220,
    height: 120,
    sizes: "(min-width: 1024px) 220px, 68vw"
  },
  md: {
    width: 300,
    height: 164,
    sizes: "(min-width: 1024px) 300px, 86vw"
  },
  lg: {
    width: 360,
    height: 196,
    sizes: "(min-width: 1024px) 360px, 94vw"
  },
  xl: {
    width: 440,
    height: 240,
    sizes: "(min-width: 1280px) 440px, (min-width: 1024px) 420px, 96vw"
  }
};

function cx(...parts: Array<string | undefined | null | false>): string {
  return parts.filter(Boolean).join(" ");
}

function resolveGlowClassName(rarityTier?: RarityTier): string {
  switch (rarityTier) {
    case "chase":
      return "shadow-[0_0_0_1px_rgba(250,204,21,0.35),0_0_30px_-12px_rgba(250,204,21,0.8)]";
    case "ultra_rare":
      return "shadow-[0_0_0_1px_rgba(167,139,250,0.35),0_0_30px_-12px_rgba(167,139,250,0.75)]";
    case "holo_rare":
      return "shadow-[0_0_0_1px_rgba(56,189,248,0.35),0_0_30px_-12px_rgba(56,189,248,0.75)]";
    default:
      return "";
  }
}

export function CardImage({
  src,
  alt,
  size = "md",
  frame = "card",
  zoom = 1,
  priority = false,
  hiresSrc,
  rarityTier,
  className
}: CardImageProps): JSX.Element {
  const config = frame === "pack" ? packSizeConfig[size] : sizeConfig[size];
  const imageSrc = hiresSrc ?? src ?? "/card-back.svg";

  return (
    <div
      className={cx(
        "relative overflow-hidden rounded-xl",
        frame === "pack" ? "bg-transparent" : "border border-pv-border bg-pv-parchment-soft",
        className
      )}
      style={{ width: config.width, height: config.height }}
    >
      <div className={cx("absolute inset-0 animate-pulse", frame === "pack" ? "bg-transparent" : "bg-pv-parchment-soft")} aria-hidden="true" />
      <Image
        src={imageSrc}
        alt={alt}
        width={config.width}
        height={config.height}
        priority={priority}
        sizes={config.sizes}
        className={`relative h-full w-full ${frame === "pack" ? "object-contain" : "object-cover"}`}
        style={zoom !== 1 ? { transform: `scale(${zoom})`, transformOrigin: "center" } : undefined}
      />
      <span className={cx("pointer-events-none absolute inset-0 rounded-xl", resolveGlowClassName(rarityTier))} aria-hidden="true" />
    </div>
  );
}
