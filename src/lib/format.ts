import type { PackTier } from "./types";

const moneyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit"
});

export function formatMoneyCents(value: number): string {
  return moneyFormatter.format(value / 100);
}

export function formatDollarsInputFromCents(value: number): string {
  const cents = Math.max(0, Math.trunc(value));
  const dollars = Math.floor(cents / 100);
  const remainder = cents % 100;
  return `${dollars}.${String(remainder).padStart(2, "0")}`;
}

export function parseDollarsInputToCents(value: string): number | null {
  const normalized = value.trim().replace(/\$/g, "").replace(/,/g, "");

  if (normalized.length === 0) {
    return null;
  }

  if (!/^\d+(\.\d{0,2})?$/.test(normalized)) {
    return null;
  }

  const [wholePart, decimalPart = ""] = normalized.split(".");
  const whole = Number(wholePart);
  if (!Number.isFinite(whole)) {
    return null;
  }

  const centsPart = Number((decimalPart + "00").slice(0, 2));
  if (!Number.isFinite(centsPart)) {
    return null;
  }

  return whole * 100 + centsPart;
}

export function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return dateTimeFormatter.format(parsed);
}

export function formatTierLabel(tier: PackTier): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}
