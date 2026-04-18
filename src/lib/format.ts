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

export function formatSignedMoneyCents(value: number): string {
  if (value > 0) {
    return `+${moneyFormatter.format(value / 100)}`;
  }
  if (value < 0) {
    return `-${moneyFormatter.format(Math.abs(value) / 100)}`;
  }
  return moneyFormatter.format(0);
}

export function formatPercentBps(bps: number, fractionDigits = 2): string {
  const sign = bps > 0 ? "+" : bps < 0 ? "−" : "";
  const abs = Math.abs(bps) / 100;
  return `${sign}${abs.toFixed(fractionDigits)}%`;
}

export function formatPlainPercentBps(bps: number, fractionDigits = 2): string {
  return `${(bps / 100).toFixed(fractionDigits)}%`;
}

const COMPACT_FORMATTER = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1
});

export function formatCompactCents(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value) / 100;
  return `${sign}$${COMPACT_FORMATTER.format(abs)}`;
}
