"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { useNotifications } from "@/components/providers/notifications-provider";

function formatRelativeTime(iso: string): string {
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) {
    return "just now";
  }

  const elapsedSeconds = Math.max(Math.floor((Date.now() - timestamp) / 1000), 0);
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s ago`;
  }
  if (elapsedSeconds < 3600) {
    return `${Math.floor(elapsedSeconds / 60)}m ago`;
  }
  if (elapsedSeconds < 86400) {
    return `${Math.floor(elapsedSeconds / 3600)}h ago`;
  }
  return `${Math.floor(elapsedSeconds / 86400)}d ago`;
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

export function NotificationsDrawer(): JSX.Element | null {
  const { user } = useAuth();
  const { events, unreadCount, open, setOpen, clear, markAllRead } = useNotifications();
  const panelRef = useRef<HTMLDivElement | null>(null);

  if (!user) {
    return null;
  }

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    markAllRead();

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [markAllRead, open]);

  useEffect(() => {
    if (!open || !panelRef.current) {
      return;
    }

    const panel = panelRef.current;
    getFocusableElements(panel)[0]?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusable = getFocusableElements(panel);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, setOpen]);

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        aria-label="Open notifications"
        aria-controls="notifications-drawer"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        Notifications
        {unreadCount > 0 ? (
          <span className="inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-pv-accent px-1 text-[10px] font-bold text-white">
            {unreadCount}
          </span>
        ) : null}
      </Button>

      {open ? (
        <>
          <div className="fixed inset-0 z-50 bg-pv-ink/40" aria-hidden="true" onClick={() => setOpen(false)} />
          <aside
            id="notifications-drawer"
            ref={panelRef}
            role="dialog"
            aria-label="Notifications"
            aria-modal="true"
            className="fixed right-0 top-0 z-50 h-full w-[min(92vw,24rem)] border-l border-pv-border bg-white p-4 shadow-2xl"
          >
            <header className="flex items-center justify-between gap-2 border-b border-pv-border pb-3">
              <h2 className="text-lg font-black text-pv-ink">Notifications</h2>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={clear}>
                  Clear
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                  Close
                </Button>
              </div>
            </header>

            <div className="mt-3 h-[calc(100%-4.5rem)] overflow-y-auto pr-1" role="region" aria-label="Notifications feed">
              {events.length === 0 ? <p className="text-sm text-pv-muted">No notifications in this session yet.</p> : null}
              <ul className="space-y-2" aria-live="polite">
                {events.map((event) => (
                  <li key={event.id} className="rounded-xl border border-pv-border bg-pv-parchment-soft p-3 text-sm">
                    <p className="font-medium text-pv-ink">{event.message}</p>
                    <div className="mt-1 flex items-center justify-between gap-2 text-xs text-pv-muted">
                      <span>{formatRelativeTime(event.createdAt)}</span>
                      {event.href ? (
                        <Link href={event.href} className="font-semibold text-pv-accent hover:text-pv-accent-strong" onClick={() => setOpen(false)}>
                          Open
                        </Link>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </>
      ) : null}
    </>
  );
}
