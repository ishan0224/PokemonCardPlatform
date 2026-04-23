"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import type { RarityTier } from "@/lib/types";
import { rarityBlurMap } from "./card-image-blurs";

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

// Local static assets under /public/images/*.png have pre-converted AVIF/WebP
// siblings (see scripts/bulk image conversion). For these paths we short-circuit
// next/image and emit <picture> so the browser negotiates AVIF → WebP → PNG
// directly, bypassing the on-demand /_next/image Sharp pipeline entirely.
function resolveLocalPictureSources(imageSrc: string): { avif: string; webp: string; fallback: string } | null {
  if (!imageSrc.startsWith("/images/")) {
    return null;
  }

  const extensionMatch = imageSrc.match(/\.(png|jpg|jpeg)$/i);
  if (!extensionMatch) {
    return null;
  }

  const stem = imageSrc.slice(0, imageSrc.length - extensionMatch[0].length);
  return {
    avif: `${stem}.avif`,
    webp: `${stem}.webp`,
    fallback: imageSrc
  };
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
  const imageSrc = hiresSrc ?? src ?? "/images/card-back.png";
  const [loaded, setLoaded] = useState(false);
  const blurDataURL = rarityTier ? rarityBlurMap[rarityTier] : undefined;
  const localSources = resolveLocalPictureSources(imageSrc);
  const objectFitClass = frame === "pack" ? "object-contain" : "object-cover";
  const inlineStyle = zoom !== 1 ? { transform: `scale(${zoom})`, transformOrigin: "center" as const } : undefined;

  useEffect(() => {
    setLoaded(false);
  }, [imageSrc]);

  return (
    <div
      className={cx(
        "relative overflow-hidden rounded-xl",
        frame === "pack" ? "bg-transparent" : "border border-pv-border bg-pv-parchment-soft",
        className
      )}
      style={{ width: config.width, height: config.height }}
    >
      {!loaded ? (
        <div className={cx("absolute inset-0 animate-pulse", frame === "pack" ? "bg-transparent" : "bg-pv-parchment-soft")} aria-hidden="true" />
      ) : null}
      {localSources ? (
        <picture>
          <source srcSet={localSources.avif} type="image/avif" />
          <source srcSet={localSources.webp} type="image/webp" />
          <img
            src={localSources.fallback}
            alt={alt}
            width={config.width}
            height={config.height}
            loading={priority ? "eager" : "lazy"}
            fetchPriority={priority ? "high" : "auto"}
            decoding="async"
            className={`relative h-full w-full ${objectFitClass}`}
            style={inlineStyle}
            onLoad={() => setLoaded(true)}
          />
        </picture>
      ) : (
        <Image
          src={imageSrc}
          alt={alt}
          width={config.width}
          height={config.height}
          priority={priority}
          sizes={config.sizes}
          placeholder={blurDataURL ? "blur" : undefined}
          blurDataURL={blurDataURL}
          className={`relative h-full w-full ${objectFitClass}`}
          style={inlineStyle}
          onLoad={() => setLoaded(true)}
        />
      )}
      <span className={cx("pointer-events-none absolute inset-0 rounded-xl", resolveGlowClassName(rarityTier))} aria-hidden="true" />
    </div>
  );
}
