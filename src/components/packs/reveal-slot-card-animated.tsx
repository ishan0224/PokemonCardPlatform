"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { CardImage } from "@/components/ui/card-image";
import { CardShell } from "@/components/ui/card-shell";
import type { PackCard } from "@/lib/api-client";
import { formatMoneyCents } from "@/lib/format";

const ScratchOverlay = dynamic(
  () => import("./scratch-overlay").then((module) => module.ScratchOverlay),
  {
    ssr: false
  }
);

type RevealSlotCardAnimatedProps = {
  slotNumber: number;
  card?: PackCard;
  pending?: boolean;
  onReveal?: () => Promise<void>;
};

type RevealMode = "touch" | "auto" | "tap";

type NavigatorWithMemory = Navigator & {
  deviceMemory?: number;
};

function shouldShowBurst(card: PackCard | undefined): boolean {
  if (!card) {
    return false;
  }

  return card.rarityTier === "ultra_rare" || card.rarityTier === "chase";
}

function getRevealMode(reducedMotion: boolean): RevealMode {
  if (typeof window === "undefined") {
    return "tap";
  }

  if (reducedMotion) {
    return "tap";
  }

  const navigatorWithMemory = window.navigator as NavigatorWithMemory;
  const deviceMemory = navigatorWithMemory.deviceMemory ?? 8;
  if (deviceMemory < 4) {
    return "tap";
  }

  if (window.navigator.maxTouchPoints > 0) {
    return "touch";
  }

  return "auto";
}

export function RevealSlotCardAnimated({
  slotNumber,
  card,
  pending = false,
  onReveal
}: RevealSlotCardAnimatedProps): JSX.Element {
  const reducedMotion = useReducedMotion();
  const revealMode = useMemo<RevealMode>(() => getRevealMode(Boolean(reducedMotion)), [reducedMotion]);
  const [scratchProgress, setScratchProgress] = useState(0);
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
      setScratchProgress(100);
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
    setScratchProgress(0);
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
      setScratchProgress(0);
      setLocalError("Reveal failed. Please try again.");
    } finally {
      setLocalPending(false);
    }
  };

  const onScratchComplete = (): void => {
    setScratchProgress(100);
    void executeReveal();
  };

  const header = (
    <div className="flex items-center justify-between">
      <span className="text-xs font-bold uppercase tracking-wide text-pv-muted">Slot {slotNumber}</span>
      {card ? <span className="rounded-full bg-pv-ink px-2 py-1 text-xs font-bold uppercase text-white">{card.rarityTier}</span> : null}
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
            <CardImage src="/card-back.svg" alt={`Face-down card slot ${slotNumber}`} size="md" />
            {!reducedMotion ? (
              <motion.div
                className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-r from-transparent via-white/20 to-transparent"
                animate={{ x: [-170, 170] }}
                transition={{ repeat: Infinity, duration: 1.6, ease: "linear" }}
              />
            ) : null}
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
              <div className="h-full w-full rounded-xl border border-pv-border bg-pv-parchment-soft" />
            )}
          </div>
        </motion.div>

        {!isRevealed && revealMode !== "tap" && !reducedMotion ? (
          <ScratchOverlay
            progress={scratchProgress}
            disabled={pending || localPending}
            mode={revealMode === "touch" ? "touch" : "auto"}
            onProgressChange={setScratchProgress}
            onComplete={onScratchComplete}
          />
        ) : null}

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
      <div className="space-y-2 rounded-xl border border-dashed border-pv-border bg-pv-parchment-soft p-4 text-center text-sm font-semibold text-pv-muted">
        <p>
          {revealMode === "touch" && !reducedMotion
            ? "Scratch the card to reveal"
            : revealMode === "auto" && !reducedMotion
              ? "Tap card to auto-scratch"
              : "Tap reveal to flip"}
        </p>
        {localError ? <p className="text-sm font-semibold text-rose-700">! {localError}</p> : null}
      </div>
    );

  const actions =
    !isRevealed && onReveal ? (
      <Button
        type="button"
        fullWidth
        loading={pending || localPending}
        onClick={() => {
          setScratchProgress(100);
          void executeReveal();
        }}
        aria-label={`Reveal slot ${slotNumber}`}
      >
        {pending || localPending ? "Revealing..." : "Reveal Slot"}
      </Button>
    ) : undefined;

  return <CardShell header={header} media={media} body={body} actions={actions} variant="surface" className="min-h-56" />;
}
