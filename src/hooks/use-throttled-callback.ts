"use client";

import { useCallback, useRef } from "react";

export function useThrottledCallback<TArgs extends unknown[]>(
  callback: (...args: TArgs) => void,
  delayMs = 100
): (...args: TArgs) => void {
  const lastCallAtRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestArgsRef = useRef<TArgs | null>(null);

  return useCallback(
    (...args: TArgs) => {
      const now = Date.now();
      const elapsed = now - lastCallAtRef.current;

      if (elapsed >= delayMs) {
        lastCallAtRef.current = now;
        callback(...args);
        return;
      }

      latestArgsRef.current = args;
      if (timeoutRef.current) {
        return;
      }

      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        lastCallAtRef.current = Date.now();

        if (latestArgsRef.current) {
          callback(...latestArgsRef.current);
          latestArgsRef.current = null;
        }
      }, delayMs - elapsed);
    },
    [callback, delayMs]
  );
}
