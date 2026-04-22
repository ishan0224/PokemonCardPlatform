"use client";

import type { Drop } from "@/lib/api-client";
import { useCountdown } from "@/hooks/use-countdown";
import { DropCompositeCard } from "./drop-composite-card";

type DropListItemProps = {
  drop: Drop;
  showCountdown?: boolean;
  priority?: boolean;
};

export function DropListItem({
  drop,
  showCountdown = true,
  priority = false
}: DropListItemProps): JSX.Element {
  const countdown = useCountdown(drop.scheduledAt, {
    adaptiveTick: showCountdown
  });
  const countdownText = showCountdown
    ? `${String(countdown.days).padStart(2, "0")}:${String(countdown.hours).padStart(2, "0")}:${String(
        countdown.minutes
      ).padStart(2, "0")}:${String(countdown.seconds).padStart(2, "0")}`
    : undefined;

  return <DropCompositeCard drop={drop} countdownText={countdownText} priority={priority} />;
}
