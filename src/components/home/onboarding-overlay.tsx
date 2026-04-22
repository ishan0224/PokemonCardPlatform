"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { buildOnboardingSteps } from "@/components/home/onboarding-copy";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useAuth } from "@/hooks/use-auth";
import { formatMoneyCents } from "@/lib/format";
import { routes } from "@/lib/routes";

type OnboardingOverlayProps = {
  userId: string;
};

function storageKey(userId: string): string {
  return `pv_onboarded_${userId}`;
}

export function OnboardingOverlay({ userId }: OnboardingOverlayProps): JSX.Element | null {
  const { balance } = useAuth();
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const steps = useMemo(() => buildOnboardingSteps(formatMoneyCents(balance?.available ?? 10_000)), [balance?.available]);
  const isLastStep = index === steps.length - 1;

  useEffect(() => {
    try {
      const existing = localStorage.getItem(storageKey(userId));
      if (!existing) {
        setOpen(true);
      }
    } finally {
      setReady(true);
    }
  }, [userId]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setIndex((current) => Math.min(current + 1, steps.length - 1));
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        setIndex((current) => Math.max(current - 1, 0));
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, steps.length]);

  const dismiss = (): void => {
    try {
      localStorage.setItem(storageKey(userId), "1");
    } finally {
      setOpen(false);
    }
  };

  if (!ready) {
    return null;
  }

  return (
    <Modal
      open={open}
      title={steps[index]?.title ?? "Welcome"}
      description={`Step ${index + 1} of ${steps.length}`}
      onClose={dismiss}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={dismiss}>
            Skip
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setIndex((current) => Math.max(current - 1, 0));
            }}
            disabled={index === 0}
          >
            Back
          </Button>
          {isLastStep ? (
            <Button size="sm" onClick={dismiss}>
              Got it
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => {
                setIndex((current) => Math.min(current + 1, steps.length - 1));
              }}
            >
              Next
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-pv-muted" aria-live="polite">
          {steps[index]?.body}
        </p>
        <p className="text-sm text-pv-muted">
          Learn more about verification in{" "}
          <Link href={routes.legal.fairnessExplainer} className="font-semibold text-pv-accent hover:text-pv-accent-strong">
            fairness details
          </Link>
          .
        </p>
      </div>
    </Modal>
  );
}
