export const COIN_MICROS_PER_COIN = 1_000_000n;
export const USDT_ATOMIC_PER_USDT = 1_000_000n;
export const USD_RATE_SCALE = 1_000_000_000n;

export type CoinMicros = bigint & { readonly __unit: "coin_micros" };
export type UsdtAtomic = bigint & { readonly __unit: "usdt_atomic" };
export type UsdRateNanos = bigint & { readonly __unit: "usd_rate_nanos" };

export type RoundingMode = "down" | "half_up" | "up";

export class MoneyError extends Error {
  constructor(
    public readonly code:
      | "INVALID_DECIMAL"
      | "NEGATIVE_AMOUNT"
      | "ZERO_AMOUNT"
      | "AMOUNT_OUT_OF_RANGE"
      | "DIVISION_BY_ZERO"
      | "STALE_RATE",
    message: string,
  ) {
    super(message);
  }
}

function asNonNegative(value: bigint, unit: string, allowZero = true) {
  if (value < 0n) {
    throw new MoneyError("NEGATIVE_AMOUNT", `${unit} cannot be negative.`);
  }
  if (!allowZero && value === 0n) {
    throw new MoneyError("ZERO_AMOUNT", `${unit} must be greater than zero.`);
  }
  return value;
}

export function coinMicros(value: bigint, allowZero = true): CoinMicros {
  return asNonNegative(value, "Coin amount", allowZero) as CoinMicros;
}

export function usdtAtomic(value: bigint, allowZero = true): UsdtAtomic {
  return asNonNegative(value, "USDT amount", allowZero) as UsdtAtomic;
}

export function usdRateNanos(value: bigint): UsdRateNanos {
  return asNonNegative(value, "USD rate", false) as UsdRateNanos;
}

export function parseDecimalToAtomic(
  input: string,
  decimals: number,
  options: { allowNegative?: boolean; allowZero?: boolean } = {},
): bigint {
  const value = input.trim();
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new MoneyError("INVALID_DECIMAL", "Amount must be a plain decimal string.");
  }

  const [, sign, whole = "0", rawFraction = ""] = match;
  if (rawFraction.length > decimals) {
    throw new MoneyError(
      "INVALID_DECIMAL",
      `Amount supports at most ${decimals} decimal places.`,
    );
  }

  const scale = 10n ** BigInt(decimals);
  const fraction = rawFraction.padEnd(decimals, "0");
  const unsigned = BigInt(whole) * scale + BigInt(fraction || "0");
  const result = sign === "-" ? -unsigned : unsigned;

  if (!options.allowNegative && result < 0n) {
    throw new MoneyError("NEGATIVE_AMOUNT", "Amount cannot be negative.");
  }
  if (options.allowZero === false && result === 0n) {
    throw new MoneyError("ZERO_AMOUNT", "Amount must be greater than zero.");
  }
  return result;
}

export function parseStoredDecimalToAtomic(
  input: string,
  decimals: number,
  options: { allowNegative?: boolean; allowZero?: boolean } = {},
): bigint {
  const value = input.trim();
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (
    !match ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 18
  ) {
    return parseDecimalToAtomic(value, decimals, options);
  }

  const [, sign = "", whole = "0", rawFraction = ""] = match;
  if (rawFraction.length <= decimals) {
    return parseDecimalToAtomic(value, decimals, options);
  }

  const excess = rawFraction.slice(decimals);
  if (!/^0+$/.test(excess)) {
    return parseDecimalToAtomic(value, decimals, options);
  }

  const retained = rawFraction.slice(0, decimals);
  return parseDecimalToAtomic(
    `${sign}${whole}${retained ? `.${retained}` : ""}`,
    decimals,
    options,
  );
}

export function parseCoins(value: string, allowZero = true): CoinMicros {
  return coinMicros(parseDecimalToAtomic(value, 6, { allowZero }), allowZero);
}

export function parseUsdt(value: string, allowZero = true): UsdtAtomic {
  return usdtAtomic(parseDecimalToAtomic(value, 6, { allowZero }), allowZero);
}

export function parseUsdRate(value: string): UsdRateNanos {
  return usdRateNanos(parseDecimalToAtomic(value, 9, { allowZero: false }));
}

export function formatAtomic(value: bigint, decimals: number, minFractionDigits = 0): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(decimals, "0");
  const trimmed = fraction.replace(/0+$/, "");
  const padded = trimmed.padEnd(Math.min(minFractionDigits, decimals), "0");
  return `${negative ? "-" : ""}${whole}${padded ? `.${padded}` : ""}`;
}

export function serializeCoinMicros(value: CoinMicros): string {
  return value.toString();
}

export function serializeUsdtAtomic(value: UsdtAtomic): string {
  return value.toString();
}

export function addCoins(left: CoinMicros, right: CoinMicros): CoinMicros {
  return coinMicros(left + right);
}

export function subtractCoins(left: CoinMicros, right: CoinMicros): CoinMicros {
  if (right > left) {
    throw new MoneyError("NEGATIVE_AMOUNT", "Coin balance cannot become negative.");
  }
  return coinMicros(left - right);
}

export function multiplyDivide(
  value: bigint,
  multiplier: bigint,
  divisor: bigint,
  rounding: RoundingMode,
): bigint {
  if (divisor <= 0n) {
    throw new MoneyError("DIVISION_BY_ZERO", "Money divisor must be positive.");
  }
  if (value < 0n || multiplier < 0n) {
    throw new MoneyError("NEGATIVE_AMOUNT", "Money operands cannot be negative.");
  }

  const numerator = value * multiplier;
  const quotient = numerator / divisor;
  const remainder = numerator % divisor;
  if (remainder === 0n || rounding === "down") return quotient;
  if (rounding === "up") return quotient + 1n;
  return remainder * 2n >= divisor ? quotient + 1n : quotient;
}

export function usdtToCoinMicros(
  amount: UsdtAtomic,
  rate: UsdRateNanos,
  rounding: RoundingMode = "down",
): CoinMicros {
  return coinMicros(multiplyDivide(amount, rate, USD_RATE_SCALE, rounding));
}

export function coinMicrosToUsdt(
  amount: CoinMicros,
  rate: UsdRateNanos,
  rounding: RoundingMode = "down",
): UsdtAtomic {
  return usdtAtomic(multiplyDivide(amount, USD_RATE_SCALE, rate, rounding));
}

export function calculateFee(
  amount: bigint,
  basisPoints: bigint,
  minimum: bigint,
  rounding: RoundingMode = "up",
): bigint {
  if (basisPoints < 0n || basisPoints > 10_000n || minimum < 0n) {
    throw new MoneyError("AMOUNT_OUT_OF_RANGE", "Fee policy is outside allowed bounds.");
  }
  const proportional = multiplyDivide(amount, basisPoints, 10_000n, rounding);
  return proportional > minimum ? proportional : minimum;
}

export function assertAmountRange<T extends bigint>(value: T, min: T, max: T): T {
  if (value < min || value > max) {
    throw new MoneyError("AMOUNT_OUT_OF_RANGE", "Amount is outside the supported range.");
  }
  return value;
}

export function isQuoteStale(
  quotedAt: string,
  ttlSeconds: number,
  now = new Date(),
): boolean {
  const timestamp = Date.parse(quotedAt);
  if (!Number.isFinite(timestamp) || !Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    return true;
  }
  return now.getTime() - timestamp > ttlSeconds * 1000;
}

export function assertFreshQuote(quotedAt: string, ttlSeconds: number, now = new Date()) {
  if (isQuoteStale(quotedAt, ttlSeconds, now)) {
    throw new MoneyError("STALE_RATE", "Exchange-rate quote is stale.");
  }
}
