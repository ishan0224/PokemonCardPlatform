"use client";

import { useEffect, useMemo, useState } from "react";

type CountdownState = {
  totalMs: number;
  ended: boolean;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
};

type CountdownOptions = {
  tickIntervalMs?: number;
  adaptiveTick?: boolean;
  nearEndThresholdMs?: number;
  nearEndIntervalMs?: number;
  farIntervalMs?: number;
  reducedMotionIntervalMs?: number;
};

const DEFAULT_TICK_INTERVAL_MS = 1_000;
const DEFAULT_NEAR_END_THRESHOLD_MS = 60_000;
const DEFAULT_FAR_INTERVAL_MS = 15_000;
const DEFAULT_REDUCED_MOTION_INTERVAL_MS = 60_000;

function resolveTickIntervalMs(input: {
  options: CountdownOptions;
  targetMs: number;
  nowMs: number;
  prefersReducedMotion: boolean;
}): number {
  if (
    typeof input.options.tickIntervalMs === "number" &&
    Number.isFinite(input.options.tickIntervalMs) &&
    input.options.tickIntervalMs > 0
  ) {
    return input.options.tickIntervalMs;
  }

  if (!input.options.adaptiveTick) {
    return DEFAULT_TICK_INTERVAL_MS;
  }

  if (input.prefersReducedMotion) {
    return input.options.reducedMotionIntervalMs ?? DEFAULT_REDUCED_MOTION_INTERVAL_MS;
  }

  const remainingMs = Math.max(input.targetMs - input.nowMs, 0);
  const nearEndThresholdMs = input.options.nearEndThresholdMs ?? DEFAULT_NEAR_END_THRESHOLD_MS;
  if (remainingMs <= nearEndThresholdMs) {
    return input.options.nearEndIntervalMs ?? DEFAULT_TICK_INTERVAL_MS;
  }

  return input.options.farIntervalMs ?? DEFAULT_FAR_INTERVAL_MS;
}

export function useCountdown(targetDateIso: string, options: CountdownOptions = {}): CountdownState {
  const [now, setNow] = useState<number>(() => Date.now());
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const tickIntervalMs = options.tickIntervalMs;
  const adaptiveTick = options.adaptiveTick;
  const nearEndThresholdMs = options.nearEndThresholdMs;
  const nearEndIntervalMs = options.nearEndIntervalMs;
  const farIntervalMs = options.farIntervalMs;
  const reducedMotionIntervalMs = options.reducedMotionIntervalMs;
  const targetMs = useMemo(() => {
    const value = new Date(targetDateIso).getTime();
    return Number.isFinite(value) ? value : Date.now();
  }, [targetDateIso]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mediaQuery.matches);

    const onChange = (event: MediaQueryListEvent): void => {
      setPrefersReducedMotion(event.matches);
    };

    mediaQuery.addEventListener("change", onChange);

    return () => {
      mediaQuery.removeEventListener("change", onChange);
    };
  }, []);

  useEffect(() => {
    if (targetMs <= Date.now()) {
      return;
    }

    let timeoutId: number | null = null;

    const tick = (): void => {
      const nextNow = Date.now();
      setNow(nextNow);

      if (nextNow >= targetMs) {
        timeoutId = null;
        return;
      }

      const intervalMs = resolveTickIntervalMs({
        options: {
          tickIntervalMs,
          adaptiveTick,
          nearEndThresholdMs,
          nearEndIntervalMs,
          farIntervalMs,
          reducedMotionIntervalMs
        },
        targetMs,
        nowMs: nextNow,
        prefersReducedMotion
      });
      timeoutId = window.setTimeout(tick, intervalMs);
    };

    const initialIntervalMs = resolveTickIntervalMs({
      options: {
        tickIntervalMs,
        adaptiveTick,
        nearEndThresholdMs,
        nearEndIntervalMs,
        farIntervalMs,
        reducedMotionIntervalMs
      },
      targetMs,
      nowMs: Date.now(),
      prefersReducedMotion
    });
    timeoutId = window.setTimeout(tick, initialIntervalMs);

    return () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [
    adaptiveTick,
    farIntervalMs,
    nearEndIntervalMs,
    nearEndThresholdMs,
    prefersReducedMotion,
    reducedMotionIntervalMs,
    targetMs,
    tickIntervalMs
  ]);

  return useMemo(() => {
    const safeTarget = Number.isFinite(targetMs) ? targetMs : now;
    const totalMs = Math.max(safeTarget - now, 0);
    const totalSeconds = Math.floor(totalMs / 1_000);

    const days = Math.floor(totalSeconds / 86_400);
    const hours = Math.floor((totalSeconds % 86_400) / 3_600);
    const minutes = Math.floor((totalSeconds % 3_600) / 60);
    const seconds = totalSeconds % 60;

    return {
      totalMs,
      ended: totalMs === 0,
      days,
      hours,
      minutes,
      seconds
    };
  }, [targetMs, now]);
}
