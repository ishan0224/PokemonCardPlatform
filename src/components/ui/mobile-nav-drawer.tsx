"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";

type MobileNavDrawerProps = {
  children: ReactNode;
};

function HamburgerIcon(): JSX.Element {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function CloseIcon(): JSX.Element {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

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
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

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
      return `pointer-events-none -translate-x-full opacity-0 ${transition}`;
    }

    return `translate-x-0 opacity-100 ${transition}`;
  }, [open, reduceMotion]);

  const drawerPortal =
    mounted && open
      ? createPortal(
          <>
            <div
              className="fixed inset-x-0 bottom-0 top-16 z-[60] bg-black/60"
              aria-hidden="true"
              onClick={() => setOpen(false)}
            />

            <div
              id="mobile-nav-drawer"
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-label="Navigation menu"
              className={`fixed left-0 top-16 z-[70] h-[calc(100vh-4rem)] w-full border-r border-pv-line bg-pv-surface shadow-2xl transition-all ${drawerClasses}`}
            >
              <div className="h-full overflow-y-auto">{children}</div>
            </div>
          </>,
          document.body
        )
      : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls="mobile-nav-drawer"
        aria-label={open ? "Close navigation menu" : "Open navigation menu"}
        className="inline-flex h-11 w-11 items-center justify-center rounded-pv-sm text-pv-text transition hover:bg-pv-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-gold"
      >
        {open ? <CloseIcon /> : <HamburgerIcon />}
      </button>
      {drawerPortal}
    </>
  );
}
