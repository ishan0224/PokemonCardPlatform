import Decimal from "decimal.js";

const CENTS_IN_DOLLAR = new Decimal(100);
const BASIS_POINTS_DIVISOR = new Decimal(10_000);

export function dollarsToCents(value: Decimal.Value): number {
  return new Decimal(value)
    .mul(CENTS_IN_DOLLAR)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();
}

export function centsToDollarsDecimal(value: number): Decimal {
  return new Decimal(value).div(CENTS_IN_DOLLAR);
}

export function centsToDollarsString(value: number): string {
  return centsToDollarsDecimal(value).toFixed(2);
}

export function calculateFeeFromBps(amountCents: number, basisPoints: number): number {
  return new Decimal(amountCents)
    .mul(basisPoints)
    .div(BASIS_POINTS_DIVISOR)
    .toDecimalPlaces(0, Decimal.ROUND_FLOOR)
    .toNumber();
}
