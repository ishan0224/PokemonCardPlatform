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

export function useCountdown(targetDateIso: string): CountdownState {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  return useMemo(() => {
    const targetMs = new Date(targetDateIso).getTime();
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
  }, [targetDateIso, now]);
}
