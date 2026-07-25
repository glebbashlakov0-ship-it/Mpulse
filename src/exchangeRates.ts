import {
  assertFreshQuote,
  formatAtomic,
  parseUsdRate,
  usdRateNanos,
  type UsdRateNanos,
  type UsdtAtomic,
} from "./money.js";

export const SUPPORTED_SETTLEMENT_ASSET = "USDT" as const;
export const SUPPORTED_SETTLEMENT_NETWORK = "TRON" as const;
export const USDT_TRC20_DECIMALS = 6 as const;

export type RatePurpose = "deposit_final" | "withdrawal_indicative" | "withdrawal_final";
export type RateKind = "indicative" | "final";

export type UsdQuote = {
  asset: typeof SUPPORTED_SETTLEMENT_ASSET;
  network: typeof SUPPORTED_SETTLEMENT_NETWORK;
  amountUsdtAtomic: UsdtAtomic;
  usdRateNanos: UsdRateNanos;
  rateDecimal: string;
  source: string;
  quotedAt: string;
  expiresAt: string;
  kind: RateKind;
  purpose: RatePurpose;
};

export type ExchangeRateProvider = {
  readonly providerName: string;
  getUsdQuote(input: {
    asset: typeof SUPPORTED_SETTLEMENT_ASSET;
    network: typeof SUPPORTED_SETTLEMENT_NETWORK;
    amountUsdtAtomic: UsdtAtomic;
    purpose: RatePurpose;
    timestamp?: string;
  }): Promise<UsdQuote>;
};

export type ExchangeRateProviderName = "disabled" | "coinbase";

export type ExchangeRateProviderConfig = {
  exchangeRateProvider: ExchangeRateProviderName;
  exchangeRateTtlSeconds: number;
  exchangeRateRequestTimeoutMs: number;
  exchangeRateCoinbaseUrl: string;
};

export class ExchangeRateError extends Error {
  constructor(
    public readonly code:
      | "RATE_UNAVAILABLE"
      | "RATE_STALE"
      | "RATE_ASSET_UNSUPPORTED"
      | "RATE_PROVIDER_INVALID"
      | "RATE_RESPONSE_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "ExchangeRateError";
  }
}

export function validateUsdQuote(
  quote: UsdQuote,
  options: {
    ttlSeconds: number;
    now?: Date;
    expectedPurpose?: RatePurpose;
    expectedKind?: RateKind;
    expectedAmountUsdtAtomic?: UsdtAtomic;
  },
): UsdQuote {
  if (
    quote.asset !== SUPPORTED_SETTLEMENT_ASSET ||
    quote.network !== SUPPORTED_SETTLEMENT_NETWORK
  ) {
    throw new ExchangeRateError(
      "RATE_ASSET_UNSUPPORTED",
      "Only USDT on TRON is supported.",
    );
  }
  if (!quote.source.trim()) {
    throw new ExchangeRateError("RATE_PROVIDER_INVALID", "Rate source is required.");
  }
  if (
    (options.expectedPurpose && quote.purpose !== options.expectedPurpose) ||
    (options.expectedKind && quote.kind !== options.expectedKind) ||
    (options.expectedAmountUsdtAtomic !== undefined &&
      quote.amountUsdtAtomic !== options.expectedAmountUsdtAtomic)
  ) {
    throw new ExchangeRateError(
      "RATE_PROVIDER_INVALID",
      "Rate quote does not match the requested money operation.",
    );
  }
  try {
    const parsedRate = parseUsdRate(quote.rateDecimal);
    if (parsedRate !== quote.usdRateNanos) {
      throw new Error("Rate representations do not match.");
    }
    assertFreshQuote(quote.quotedAt, options.ttlSeconds, options.now);
    const quotedAt = Date.parse(quote.quotedAt);
    const expiresAt = Date.parse(quote.expiresAt);
    const now = (options.now ?? new Date()).getTime();
    if (
      !Number.isFinite(quotedAt) ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= quotedAt ||
      quotedAt > now + 1_000 ||
      expiresAt > quotedAt + options.ttlSeconds * 1000 ||
      now >= expiresAt
    ) {
      throw new Error("Quote expiry is invalid.");
    }
  } catch {
    throw new ExchangeRateError("RATE_STALE", "Rate quote is invalid or stale.");
  }
  return quote;
}

export function createDisabledRateProvider(): ExchangeRateProvider {
  return {
    providerName: "disabled",
    async getUsdQuote() {
      throw new ExchangeRateError(
        "RATE_UNAVAILABLE",
        "No approved exchange-rate provider is configured; crediting is blocked.",
      );
    },
  };
}

export function buildExchangeRateProvider(
  config: ExchangeRateProviderConfig,
  options: { fetch?: typeof fetch; now?: () => Date } = {},
): ExchangeRateProvider {
  if (config.exchangeRateProvider === "disabled") {
    return createDisabledRateProvider();
  }

  return createCoinbaseExchangeRateProvider({
    ttlSeconds: config.exchangeRateTtlSeconds,
    requestTimeoutMs: config.exchangeRateRequestTimeoutMs,
    endpoint: config.exchangeRateCoinbaseUrl,
    fetch: options.fetch,
    now: options.now,
  });
}

export function createCoinbaseExchangeRateProvider(options: {
  ttlSeconds: number;
  requestTimeoutMs: number;
  endpoint?: string;
  fetch?: typeof fetch;
  now?: () => Date;
}): ExchangeRateProvider {
  const endpoint =
    options.endpoint || "https://api.coinbase.com/v2/exchange-rates?currency=USDT";
  const requestTimeoutMs = options.requestTimeoutMs;
  const ttlSeconds = options.ttlSeconds;
  if (
    !Number.isSafeInteger(requestTimeoutMs) ||
    requestTimeoutMs <= 0 ||
    !Number.isSafeInteger(ttlSeconds) ||
    ttlSeconds <= 0
  ) {
    throw new ExchangeRateError(
      "RATE_PROVIDER_INVALID",
      "Exchange-rate timeout and TTL must be positive integers.",
    );
  }

  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());

  return {
    providerName: "coinbase-data-api",
    async getUsdQuote(input) {
      if (
        input.asset !== SUPPORTED_SETTLEMENT_ASSET ||
        input.network !== SUPPORTED_SETTLEMENT_NETWORK
      ) {
        throw new ExchangeRateError(
          "RATE_ASSET_UNSUPPORTED",
          "Only USDT on TRON is supported.",
        );
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: "GET",
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
      } catch (error) {
        throw new ExchangeRateError(
          "RATE_UNAVAILABLE",
          error instanceof Error && error.name === "AbortError"
            ? "Exchange-rate provider timed out."
            : "Exchange-rate provider is unavailable.",
        );
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        throw new ExchangeRateError(
          "RATE_UNAVAILABLE",
          `Exchange-rate provider returned HTTP ${response.status}.`,
        );
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new ExchangeRateError(
          "RATE_RESPONSE_INVALID",
          "Exchange-rate provider returned invalid JSON.",
        );
      }

      const rateDecimal = parseCoinbaseUsdRate(payload);
      const rate = parseProviderUsdRate(rateDecimal);
      const quotedAt = now();
      if (!Number.isFinite(quotedAt.getTime())) {
        throw new ExchangeRateError(
          "RATE_PROVIDER_INVALID",
          "Exchange-rate clock returned an invalid timestamp.",
        );
      }
      const expiresAt = new Date(quotedAt.getTime() + ttlSeconds * 1000);
      const kind: RateKind =
        input.purpose === "withdrawal_indicative" ? "indicative" : "final";

      return validateUsdQuote(
        {
          asset: input.asset,
          network: input.network,
          amountUsdtAtomic: input.amountUsdtAtomic,
          usdRateNanos: rate,
          rateDecimal: formatAtomic(rate, 9),
          source: "coinbase-data-api",
          quotedAt: quotedAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
          kind,
          purpose: input.purpose,
        },
        {
          ttlSeconds,
          now: quotedAt,
          expectedPurpose: input.purpose,
          expectedKind: kind,
          expectedAmountUsdtAtomic: input.amountUsdtAtomic,
        },
      );
    },
  };
}

function parseCoinbaseUsdRate(value: unknown): string {
  if (!isRecord(value) || !isRecord(value.data)) {
    throw new ExchangeRateError(
      "RATE_RESPONSE_INVALID",
      "Exchange-rate response is missing data.",
    );
  }
  if (value.data.currency !== "USDT" || !isRecord(value.data.rates)) {
    throw new ExchangeRateError(
      "RATE_RESPONSE_INVALID",
      "Exchange-rate response has an unexpected base currency.",
    );
  }
  const usd = value.data.rates.USD;
  if (typeof usd !== "string" || !usd.trim()) {
    throw new ExchangeRateError(
      "RATE_RESPONSE_INVALID",
      "Exchange-rate response is missing the USD rate.",
    );
  }
  return usd.trim();
}

function parseProviderUsdRate(value: string): UsdRateNanos {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) {
    throw new ExchangeRateError(
      "RATE_RESPONSE_INVALID",
      "Exchange-rate value must be a plain positive decimal string.",
    );
  }
  const whole = match[1] ?? "0";
  const fraction = match[2] ?? "";
  const nanos = BigInt(whole) * 1_000_000_000n +
    BigInt(fraction.slice(0, 9).padEnd(9, "0") || "0");
  const rounded = fraction.length > 9 && (fraction[9] ?? "0") >= "5" ? nanos + 1n : nanos;
  try {
    return usdRateNanos(rounded);
  } catch {
    throw new ExchangeRateError(
      "RATE_RESPONSE_INVALID",
      "Exchange-rate value must be greater than zero.",
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
