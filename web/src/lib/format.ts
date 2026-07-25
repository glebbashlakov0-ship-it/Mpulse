const formatter = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const currencyFormatter = new Intl.NumberFormat("en", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const numberFormatter = new Intl.NumberFormat("en", {
  maximumFractionDigits: 2,
});

const COIN_MICROS_PER_COIN = 1_000_000n;
const DECIMAL_VALUE_PATTERN = /^([+-]?)(\d+)(?:\.(\d+))?$/;
const INTEGER_VALUE_PATTERN = /^-?\d+$/;

export function formatMoney(value: number) {
  return `$${formatter.format(value)}`;
}

export function formatUsdt(value: number) {
  return `${currencyFormatter.format(value)} USDT`;
}

export function formatCoins(value: string | number | bigint) {
  const decimal = normalizeDecimalValue(value);
  if (!decimal) {
    return "-- Coins";
  }

  const micros = decimalToAtomic(decimal, 6);
  return micros === null ? "-- Coins" : formatCoinMicros(micros);
}

export function formatCoinMicros(value: string | bigint) {
  const serialized = typeof value === "bigint" ? value.toString() : value;
  if (!INTEGER_VALUE_PATTERN.test(serialized)) {
    return "-- Coins";
  }

  const atomic = BigInt(serialized);
  const negative = atomic < 0n;
  const absolute = negative ? -atomic : atomic;
  const decimal = formatAtomicDecimal(atomic, 6, 2);
  return `${decimal} ${absolute === COIN_MICROS_PER_COIN ? "Coin" : "Coins"}`;
}

export function formatSignedCoinMicros(value: string | bigint) {
  const serialized = typeof value === "bigint" ? value.toString() : value;
  if (!INTEGER_VALUE_PATTERN.test(serialized)) {
    return "-- Coins";
  }

  const atomic = BigInt(serialized);
  if (atomic === 0n) {
    return formatCoinMicros(atomic);
  }

  return `${atomic > 0n ? "+" : "−"}${formatCoinMicros(atomic < 0n ? -atomic : atomic)}`;
}

export function formatAssetAmount(
  value: string | bigint,
  asset: "USDT",
  options: { atomic?: boolean; decimals?: number } = {},
) {
  const decimals = options.decimals ?? 6;
  const serialized = typeof value === "bigint" ? value.toString() : value;
  const decimal = options.atomic
    ? INTEGER_VALUE_PATTERN.test(serialized)
      ? formatAtomicDecimal(BigInt(serialized), decimals, 2)
      : null
    : normalizeDecimalValue(serialized);

  return decimal ? `${formatDecimalString(decimal, 0)} ${asset}` : `-- ${asset}`;
}

export function formatUsdReference(value: string | bigint) {
  const serialized = typeof value === "bigint" ? value.toString() : value;
  const decimal = normalizeDecimalValue(serialized);
  return decimal ? `${formatDecimalString(decimal, 2)} USD` : "-- USD";
}

export function parseCoinInputToMicros(value: string, allowZero = false) {
  const normalized = value.trim();
  const micros = decimalToAtomic(normalized, 6);
  if (micros === null || micros < 0n || (!allowZero && micros === 0n)) {
    return null;
  }
  return micros.toString();
}

export function parseSignedCoinInputToMicros(value: string) {
  const normalized = value.trim();
  const micros = decimalToAtomic(normalized, 6);
  return micros === null || micros === 0n ? null : micros.toString();
}

export function parseAssetInputToAtomic(value: string, decimals = 6, allowZero = false) {
  const normalized = value.trim();
  const atomic = decimalToAtomic(normalized, decimals);
  if (atomic === null || atomic < 0n || (!allowZero && atomic === 0n)) {
    return null;
  }
  return atomic.toString();
}

export function compareCoinMicros(left: string, right: string) {
  if (!INTEGER_VALUE_PATTERN.test(left) || !INTEGER_VALUE_PATTERN.test(right)) {
    return null;
  }

  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  return leftValue === rightValue ? 0 : leftValue > rightValue ? 1 : -1;
}

export function addCoinMicros(...values: string[]) {
  if (values.some((value) => !INTEGER_VALUE_PATTERN.test(value))) {
    return null;
  }

  return values.reduce((total, value) => total + BigInt(value), 0n).toString();
}

export function coinMicrosToInput(value: string) {
  return atomicToDecimalInput(value, 6);
}

export function atomicToDecimalInput(value: string, decimals = 6) {
  if (!INTEGER_VALUE_PATTERN.test(value)) {
    return "";
  }

  return formatAtomicDecimal(BigInt(value), decimals, 0).replace(/,/g, "");
}

export function isPositiveDecimal(value: string) {
  const decimal = normalizeDecimalValue(value.trim());
  const atomic = decimal ? decimalToAtomic(decimal, 9) : null;
  return atomic !== null && atomic > 0n;
}

export function compareDecimalValues(left: string, right: string, decimals = 9) {
  const leftValue = decimalToAtomic(left, decimals);
  const rightValue = decimalToAtomic(right, decimals);
  if (leftValue === null || rightValue === null) {
    return null;
  }
  return leftValue === rightValue ? 0 : leftValue > rightValue ? 1 : -1;
}

export function addDecimalValues(left: string, right: string, decimals = 6) {
  const leftValue = decimalToAtomic(left, decimals);
  const rightValue = decimalToAtomic(right, decimals);
  if (leftValue === null || rightValue === null) {
    return null;
  }
  return formatAtomicDecimal(leftValue + rightValue, decimals, 0).replace(/,/g, "");
}

export function multiplyDecimalByRatio(
  value: string,
  numerator: bigint,
  denominator: bigint,
  decimals = 6,
) {
  const atomic = decimalToAtomic(value, decimals);
  if (atomic === null || numerator < 0n || denominator <= 0n) {
    return null;
  }
  return formatAtomicDecimal((atomic * numerator) / denominator, decimals, 0).replace(/,/g, "");
}

export function formatSignedUsdt(value: number) {
  const prefix = value >= 0 ? "+" : "-";

  return `${prefix}${formatUsdt(Math.abs(value))}`;
}

export function formatShares(value: string | number) {
  if (typeof value === "number") {
    return numberFormatter.format(value);
  }

  const decimal = normalizeDecimalValue(value);
  return decimal ? formatDecimalString(roundDecimal(decimal, 2), 0) : "--";
}

export function formatOutcomePercent(value: number | string | null | undefined) {
  if (
    value === null ||
    value === undefined ||
    (typeof value === "number" && Number.isNaN(value))
  ) {
    return "--";
  }

  const decimal = normalizeDecimalValue(value);
  const scaled = decimal ? decimalToAtomic(decimal, 6) : null;
  if (scaled === null) {
    return "--";
  }

  if (scaled <= 0n) {
    return "0%";
  }

  if (scaled < 10_000n) {
    return "<1%";
  }

  const percentTenths = (scaled * 1_000n + 500_000n) / 1_000_000n;
  const whole = percentTenths / 10n;
  const tenth = percentTenths % 10n;
  return tenth === 0n ? `${whole}%` : `${whole}.${tenth}%`;
}

export function formatChartPercent(value: number | string | null | undefined) {
  return formatOutcomePercent(value);
}

export function formatPercent(value: number | string | null | undefined) {
  return formatOutcomePercent(value);
}

export function formatSignedPercent(value: number | string) {
  const decimal = normalizeDecimalValue(value);
  const scaled = decimal ? decimalToAtomic(decimal, 6) : null;
  if (scaled === null) {
    return "--";
  }

  const absolute = scaled < 0n ? -scaled : scaled;
  const percentHundredths = (absolute * 10_000n + 500_000n) / 1_000_000n;
  return `${scaled >= 0n ? "+" : "-"}${percentHundredths / 100n}.${(
    percentHundredths % 100n
  )
    .toString()
    .padStart(2, "0")}%`;
}

export function formatCents(value: number | string | null) {
  if (value === null) {
    return "--";
  }

  const decimal = normalizeDecimalValue(value);
  const scaled = decimal ? decimalToAtomic(decimal, 9) : null;
  if (scaled === null || scaled < 0n) {
    return "--";
  }
  const cents = (scaled * 100n + 500_000_000n) / 1_000_000_000n;
  return `${scaled > 0n && cents < 1n ? 1n : cents}¢`;
}

export function formatDate(value: string | null) {
  if (!value) {
    return "TBD";
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export function formatShortDate(value: string | null) {
  if (!value) {
    return "Apr 30";
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

export function formatRelativeTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "just now";
  }

  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  }).format(date);
}

function normalizeDecimalValue(value: string | number | bigint) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null;
    }
    return expandExponential(String(value));
  }

  return expandExponential(String(value).trim());
}

function expandExponential(value: string) {
  if (!/[eE]/.test(value)) {
    return DECIMAL_VALUE_PATTERN.test(value) ? value : null;
  }

  const match = /^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(value);
  if (!match) {
    return null;
  }

  const [, sign = "", whole = "0", fraction = "", rawExponent = "0"] = match;
  const exponent = Number(rawExponent);
  if (!Number.isSafeInteger(exponent)) {
    return null;
  }

  const digits = `${whole}${fraction}`;
  const decimalIndex = whole.length + exponent;
  if (decimalIndex <= 0) {
    return `${sign}0.${"0".repeat(-decimalIndex)}${digits}`;
  }
  if (decimalIndex >= digits.length) {
    return `${sign}${digits}${"0".repeat(decimalIndex - digits.length)}`;
  }
  return `${sign}${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}

function decimalToAtomic(value: string, decimals: number) {
  const match = DECIMAL_VALUE_PATTERN.exec(value);
  if (!match) {
    return null;
  }

  const [, sign = "", whole = "0", fraction = ""] = match;
  if (fraction.length > decimals) {
    return null;
  }

  const scale = 10n ** BigInt(decimals);
  const absolute = BigInt(whole) * scale + BigInt(fraction.padEnd(decimals, "0") || "0");
  return sign === "-" ? -absolute : absolute;
}

function formatAtomicDecimal(value: bigint, decimals: number, minimumFractionDigits: number) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(decimals, "0");
  const trimmed = fraction.replace(/0+$/, "");
  const padded = trimmed.padEnd(Math.min(minimumFractionDigits, decimals), "0");
  return `${negative ? "-" : ""}${groupInteger(whole.toString())}${
    padded ? `.${padded}` : ""
  }`;
}

function formatDecimalString(value: string, minimumFractionDigits: number) {
  const match = DECIMAL_VALUE_PATTERN.exec(value);
  if (!match) {
    return value;
  }

  const [, sign = "", rawWhole = "0", rawFraction = ""] = match;
  const whole = rawWhole.replace(/^0+(?=\d)/, "");
  const fraction = rawFraction.replace(/0+$/, "").padEnd(minimumFractionDigits, "0");
  return `${sign === "-" ? "-" : ""}${groupInteger(whole)}${
    fraction ? `.${fraction}` : ""
  }`;
}

function groupInteger(value: string) {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function roundDecimal(value: string, maximumFractionDigits: number) {
  const match = DECIMAL_VALUE_PATTERN.exec(value);
  if (!match) {
    return value;
  }

  const [, sign = "", whole = "0", fraction = ""] = match;
  if (fraction.length <= maximumFractionDigits) {
    return value;
  }

  const scale = 10n ** BigInt(fraction.length);
  const targetScale = 10n ** BigInt(maximumFractionDigits);
  const absolute = BigInt(whole) * scale + BigInt(fraction);
  const rounded = (absolute * targetScale + scale / 2n) / scale;
  const signed = sign === "-" ? -rounded : rounded;
  return formatAtomicDecimal(signed, maximumFractionDigits, 0).replace(/,/g, "");
}
