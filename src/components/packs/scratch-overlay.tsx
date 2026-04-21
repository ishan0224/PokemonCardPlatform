"use client";

import { useEffect, useRef } from "react";

type ScratchOverlayProps = {
  progress: number;
  disabled?: boolean;
  mode: "touch" | "auto";
  onProgressChange: (nextProgress: number) => void;
  onComplete: () => void;
};

const COMPLETE_THRESHOLD = 98;

export function ScratchOverlay({
  progress,
  disabled = false,
  mode,
  onProgressChange,
  onComplete
}: ScratchOverlayProps): JSX.Element {
  const pointerActiveRef = useRef(false);
  const autoScratchTimerRef = useRef<number | null>(null);
  const completeFiredRef = useRef(false);
  const progressRef = useRef(progress);

  const clampedProgress = Math.min(100, Math.max(0, progress));

  useEffect(() => {
    progressRef.current = clampedProgress;
  }, [clampedProgress]);

  useEffect(() => {
    if (clampedProgress >= COMPLETE_THRESHOLD && !completeFiredRef.current) {
      completeFiredRef.current = true;
      onComplete();
    }

    if (clampedProgress < COMPLETE_THRESHOLD) {
      completeFiredRef.current = false;
    }
  }, [clampedProgress, onComplete]);

  useEffect(() => {
    return () => {
      if (autoScratchTimerRef.current !== null) {
        window.clearInterval(autoScratchTimerRef.current);
      }
    };
  }, []);

  const applyProgressDelta = (delta: number): void => {
    if (disabled) {
      return;
    }

    const next = Math.min(100, progressRef.current + delta);
    onProgressChange(next);
  };

  const startAutoScratch = (): void => {
    if (disabled || autoScratchTimerRef.current !== null) {
      return;
    }

    autoScratchTimerRef.current = window.setInterval(() => {
      const next = Math.min(100, progressRef.current + 16);
      onProgressChange(next);
      if (next >= 100 && autoScratchTimerRef.current !== null) {
        window.clearInterval(autoScratchTimerRef.current);
        autoScratchTimerRef.current = null;
      }
    }, 40);
  };

  const stopAutoScratch = (): void => {
    if (autoScratchTimerRef.current === null) {
      return;
    }

    window.clearInterval(autoScratchTimerRef.current);
    autoScratchTimerRef.current = null;
  };

  return (
    <div
      className="absolute inset-0 z-20 cursor-pointer overflow-hidden rounded-xl"
      onPointerDown={(event) => {
        if (disabled) {
          return;
        }

        if (mode === "touch") {
          pointerActiveRef.current = true;
          applyProgressDelta(9);
          return;
        }

        if (event.pointerType !== "touch") {
          startAutoScratch();
        }
      }}
      onPointerMove={(event) => {
        if (disabled || mode !== "touch" || !pointerActiveRef.current || event.pointerType !== "touch") {
          return;
        }

        applyProgressDelta(5);
      }}
      onPointerUp={() => {
        pointerActiveRef.current = false;
        stopAutoScratch();
      }}
      onPointerCancel={() => {
        pointerActiveRef.current = false;
        stopAutoScratch();
      }}
      onPointerLeave={() => {
        pointerActiveRef.current = false;
        stopAutoScratch();
      }}
      onClick={(event) => {
        if (disabled) {
          return;
        }

        if (mode === "touch") {
          return;
        }

        if (event.detail === 0) {
          startAutoScratch();
        }
      }}
      aria-hidden="true"
    >
      <div
        className="absolute inset-0 bg-gradient-to-br from-slate-700 via-slate-500 to-slate-700"
        style={{ clipPath: `inset(0 ${100 - clampedProgress}% 0 0)` }}
      />
      <div className="pointer-events-none absolute inset-0 border border-white/20" />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs font-bold uppercase tracking-wide text-white/85">
        {mode === "touch" ? "Scratch" : "Tap to Scratch"}
      </div>
    </div>
  );
}
