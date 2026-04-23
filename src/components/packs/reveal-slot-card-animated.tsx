"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { CardImage } from "@/components/ui/card-image";
import { CardShell } from "@/components/ui/card-shell";
import { Chip } from "@/components/ui/chip";
import { RarityBadge } from "@/components/ui/rarity-badge";
import type { PackCard } from "@/lib/api-client";
import type { RarityTier } from "@/lib/types";
import { formatMoneyCents } from "@/lib/format";

type RevealSlotCardAnimatedProps = {
  slotNumber: number;
  card?: PackCard;
  pending?: boolean;
  onReveal?: () => Promise<void>;
};

function shouldShowBurst(card: PackCard | undefined): boolean {
  if (!card) {
    return false;
  }

  return card.rarityTier === "ultra_rare" || card.rarityTier === "chase";
}

export function RevealSlotCardAnimated({
  slotNumber,
  card,
  pending = false,
  onReveal
}: RevealSlotCardAnimatedProps): JSX.Element {
  const reducedMotion = useReducedMotion();
  const [optimisticRevealStarted, setOptimisticRevealStarted] = useState(false);
  const [localPending, setLocalPending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [showBurst, setShowBurst] = useState(false);
  const revealAttemptedRef = useRef(false);
  const burstTimerRef = useRef<number | null>(null);

  const isRevealed = Boolean(card);
  const frontVisible = isRevealed || optimisticRevealStarted;

  useEffect(() => {
    if (isRevealed) {
      setOptimisticRevealStarted(true);
      revealAttemptedRef.current = true;

      if (!reducedMotion && shouldShowBurst(card)) {
        setShowBurst(true);
        if (burstTimerRef.current !== null) {
          window.clearTimeout(burstTimerRef.current);
        }

        burstTimerRef.current = window.setTimeout(() => {
          setShowBurst(false);
          burstTimerRef.current = null;
        }, 600);
      }
      return;
    }

    setShowBurst(false);
    setOptimisticRevealStarted(false);
    setLocalPending(false);
    setLocalError(null);
    revealAttemptedRef.current = false;
  }, [card, isRevealed, reducedMotion]);

  useEffect(() => {
    return () => {
      if (burstTimerRef.current !== null) {
        window.clearTimeout(burstTimerRef.current);
      }
    };
  }, []);

  const executeReveal = async (): Promise<void> => {
    if (!onReveal || pending || localPending || isRevealed || revealAttemptedRef.current) {
      return;
    }

    revealAttemptedRef.current = true;
    setLocalPending(true);
    setLocalError(null);
    setOptimisticRevealStarted(true);

    try {
      await onReveal();
    } catch (_error) {
      revealAttemptedRef.current = false;
      setOptimisticRevealStarted(false);
      setLocalError("Reveal failed. Please try again.");
    } finally {
      setLocalPending(false);
    }
  };

  const header = (
    <div className="flex items-center justify-between">
      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">
        Slot {slotNumber}
        {card && (card.rarityTier === "ultra_rare" || card.rarityTier === "chase")
          ? " · feature"
          : ""}
      </span>
      {card ? (
        <RarityBadge rarity={card.rarityTier} />
      ) : (
        <Chip tone="neutral">Face-down</Chip>
      )}
    </div>
  );

  const media = (
    <div className="relative flex justify-center">
      <div className="relative h-[224px] w-[160px] [perspective:1000px]">
        <motion.div
          className="relative h-full w-full"
          style={{ transformStyle: "preserve-3d" }}
          animate={
            reducedMotion
              ? { opacity: frontVisible ? 1 : 0.98 }
              : { rotateY: frontVisible ? 180 : 0 }
          }
          transition={{ duration: reducedMotion ? 0.2 : 0.4, ease: "easeInOut" }}
        >
          <div className="absolute inset-0 [backface-visibility:hidden]">
            <CardImage src="/images/card-back.png" alt={`Face-down card slot ${slotNumber}`} size="md" className="border-0 bg-transparent" />
          </div>

          <div className="absolute inset-0 [backface-visibility:hidden]" style={{ transform: "rotateY(180deg)" }}>
            {card ? (
              <CardImage
                src={card.pokemonCard.imageUrl}
                hiresSrc={card.pokemonCard.imageUrlHires}
                alt={card.pokemonCard.name}
                size="md"
                rarityTier={card.rarityTier}
              />
            ) : (
              <div className="h-full w-full rounded-pv border border-pv-line bg-pv-surface-3" />
            )}
          </div>
        </motion.div>

        <AnimatePresence>
          {showBurst && !reducedMotion ? (
            <motion.div
              className="pointer-events-none absolute inset-0 z-30"
              initial={{ opacity: 0.8 }}
              animate={{ opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.6, ease: "easeOut" }}
            >
              {Array.from({ length: 12 }).map((_, index) => {
                const angle = (index / 12) * Math.PI * 2;
                const x = Math.cos(angle) * 70;
                const y = Math.sin(angle) * 70;
                return (
                  <motion.span
                    key={`burst-${slotNumber}-${index}`}
                    className="absolute left-1/2 top-1/2 h-2 w-2 rounded-full bg-amber-300"
                    initial={{ x: 0, y: 0, scale: 1, opacity: 1 }}
                    animate={{ x, y, scale: 0.4, opacity: 0 }}
                    transition={{ duration: 0.6, ease: "easeOut" }}
                  />
                );
              })}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
      {isRevealed && card ? (
        <span className="sr-only" aria-live="polite">
          Slot {slotNumber} revealed: {card.pokemonCard.name}, {card.rarityTier}
        </span>
      ) : null}
    </div>
  );

  const body =
    isRevealed && card ? (
      <div>
        <h3 className="text-[14px] font-bold text-pv-text">{card.pokemonCard.name}</h3>
        <div className="mt-1 flex items-center justify-between text-[12px]">
          <span className="text-pv-muted">{card.pokemonCard.setName}</span>
          <span
            className={`font-extrabold tabular-nums ${
              card.rarityTier === "chase" || card.rarityTier === "ultra_rare"
                ? "text-pv-gold"
                : "text-pv-text"
            }`}
          >
            {formatMoneyCents(card.pokemonCard.currentPrice)}
          </span>
        </div>
      </div>
    ) : localError ? (
      <p className="text-[11px] font-semibold text-pv-accent text-center">! {localError}</p>
    ) : null;

  const actions =
    !isRevealed && onReveal ? (
      <Button
        type="button"
        variant="gold"
        fullWidth
        loading={pending || localPending}
        onClick={() => void executeReveal()}
        aria-label={`Reveal slot ${slotNumber}`}
      >
        {pending || localPending ? "Revealing…" : "Tap or click to reveal"}
      </Button>
    ) : undefined;

  const tone = resolveTone(card?.rarityTier);

  return (
    <CardShell
      header={header}
      media={media}
      body={body}
      actions={actions}
      variant="surface"
      tone={tone}
      className="min-h-[380px]"
    />
  );
}

function resolveTone(
  rarity: RarityTier | undefined
): "default" | "rarity-holo" | "rarity-ultra" | "rarity-chase" {
  if (rarity === "chase") return "rarity-chase";
  if (rarity === "ultra_rare") return "rarity-ultra";
  if (rarity === "holo_rare") return "rarity-holo";
  return "default";
}
