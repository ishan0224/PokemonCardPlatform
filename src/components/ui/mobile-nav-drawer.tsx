"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

type MobileNavDrawerProps = {
  children: ReactNode;
};

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const selector = [
    "a[href]",
    "button:not([disabled])",
    "textarea:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    '[tabindex]:not([tabindex="-1"])'
  ].join(",");

  return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter((element) => !element.hasAttribute("disabled"));
}

export function MobileNavDrawer({ children }: MobileNavDrawerProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    const syncReduceMotion = (): void => {
      setReduceMotion(mediaQuery.matches);
    };

    syncReduceMotion();
    mediaQuery.addEventListener("change", syncReduceMotion);

    return () => {
      mediaQuery.removeEventListener("change", syncReduceMotion);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !panelRef.current) {
      return;
    }

    const panel = panelRef.current;
    const focusables = getFocusableElements(panel);
    focusables[0]?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const currentFocusables = getFocusableElements(panel);
      if (currentFocusables.length === 0) {
        event.preventDefault();
        return;
      }

      const first = currentFocusables[0];
      const last = currentFocusables[currentFocusables.length - 1];
      const activeElement = document.activeElement;

      if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const drawerClasses = useMemo(() => {
    const transition = reduceMotion ? "duration-100" : "duration-200";

    if (reduceMotion) {
      if (!open) {
        return `pointer-events-none opacity-0 ${transition}`;
      }

      return `opacity-100 ${transition}`;
    }

    if (!open) {
      return `pointer-events-none translate-x-full opacity-0 ${transition}`;
    }

    return `translate-x-0 opacity-100 ${transition}`;
  }, [open, reduceMotion]);

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} aria-expanded={open} aria-controls="mobile-nav-drawer">
        Menu
      </Button>

      {open ? (
        <>
          <div
            className="fixed inset-0 z-50 bg-pv-ink/40 transition-opacity opacity-100"
            aria-hidden="true"
            onClick={() => setOpen(false)}
          />

          <div
            id="mobile-nav-drawer"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            className={`fixed right-0 top-0 z-50 h-full w-[min(90vw,22rem)] border-l border-pv-border bg-pv-parchment shadow-2xl transition-all ${drawerClasses}`}
          >
            <div className="flex items-center justify-end border-b border-pv-border p-3">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Close
              </Button>
            </div>
            <div className="h-[calc(100%-4.5rem)] overflow-y-auto">{children}</div>
          </div>
        </>
      ) : null}
    </>
  );
}
