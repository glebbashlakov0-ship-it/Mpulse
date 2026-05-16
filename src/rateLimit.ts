import type { FastifyReply, FastifyRequest } from "fastify";
import { createClient, type RedisClientType } from "redis";
import type { AppConfig } from "./config.js";

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type RateLimitResult = {
  ok: boolean;
  retryAfterMs: number;
};

export const RATE_LIMIT_MESSAGE = "Too many attempts. Try again later.";

export type AuthRateLimiter = {
  check(keys: string[], now?: number): RateLimitResult | Promise<RateLimitResult>;
  close?(): Promise<void>;
};

export class MemoryRateLimiter {
  private readonly buckets = new Map<string, RateLimitBucket>();

  constructor(
    private readonly windowMs: number,
    private readonly max: number,
  ) {}

  check(keys: string[], now = Date.now()): RateLimitResult {
    if (this.max <= 0 || this.windowMs <= 0) {
      return {
        ok: true,
        retryAfterMs: 0,
      };
    }

    this.prune(now);
    const buckets = keys.map((key) => this.getBucket(key, now));
    const limitedBucket = buckets.find((bucket) => bucket.count >= this.max);

    if (limitedBucket) {
      return {
        ok: false,
        retryAfterMs: Math.max(0, limitedBucket.resetAt - now),
      };
    }

    for (const bucket of buckets) {
      bucket.count += 1;
    }

    return {
      ok: true,
      retryAfterMs: 0,
    };
  }

  private getBucket(key: string, now: number) {
    const bucket = this.buckets.get(key);
    if (bucket && bucket.resetAt > now) {
      return bucket;
    }

    const nextBucket = {
      count: 0,
      resetAt: now + this.windowMs,
    };
    this.buckets.set(key, nextBucket);
    return nextBucket;
  }

  private prune(now: number) {
    for (const [key, bucket] of this.buckets.entries()) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
  }
}

export class ExternalRateLimiter {
  check(_keys: string[]): RateLimitResult {
    return {
      ok: true,
      retryAfterMs: 0,
    };
  }
}

export class RedisRateLimiter {
  private readonly client: RedisClientType;
  private connectPromise: Promise<unknown> | null = null;

  constructor(
    redisUrl: string,
    private readonly windowMs: number,
    private readonly max: number,
  ) {
    this.client = createClient({ url: redisUrl });
  }

  async check(keys: string[]): Promise<RateLimitResult> {
    if (this.max <= 0 || this.windowMs <= 0) {
      return {
        ok: true,
        retryAfterMs: 0,
      };
    }

    await this.connect();
    const results = await Promise.all(keys.map((key) => this.incrementKey(key)));
    const limited = results.filter((result) => result.count > this.max);

    if (limited.length === 0) {
      return {
        ok: true,
        retryAfterMs: 0,
      };
    }

    return {
      ok: false,
      retryAfterMs: Math.max(0, Math.min(...limited.map((result) => result.ttlMs))),
    };
  }

  async close() {
    if (this.client.isOpen) {
      await this.client.quit();
    }
  }

  private async connect() {
    if (this.client.isOpen) {
      return;
    }

    this.connectPromise ??= this.client.connect();
    await this.connectPromise;
  }

  private async incrementKey(key: string) {
    const namespacedKey = `market-pulse:${key}`;
    const count = await this.client.incr(namespacedKey);

    if (count === 1) {
      await this.client.pExpire(namespacedKey, this.windowMs);
    }

    const ttl = await this.client.pTTL(namespacedKey);
    return {
      count,
      ttlMs: ttl > 0 ? ttl : this.windowMs,
    };
  }
}

export function getClientRateLimitId(request: FastifyRequest) {
  return request.ip || request.socket.remoteAddress || "unknown";
}

export function buildAuthRateLimitKeys({
  request,
  endpoint,
  email,
}: {
  request: FastifyRequest;
  endpoint: string;
  email?: string | null;
}) {
  const ip = getClientRateLimitId(request);
  const keys = [`auth:${endpoint}:ip:${ip}`];

  if (email) {
    keys.push(`auth:${endpoint}:email:${email.trim().toLowerCase()}`);
  }

  return keys;
}

export function sendRateLimited(reply: FastifyReply, retryAfterMs: number) {
  reply.header("Retry-After", Math.max(1, Math.ceil(retryAfterMs / 1000)));
  reply.status(429).send({
    data: null,
    error: {
      code: "RATE_LIMITED",
      message: RATE_LIMIT_MESSAGE,
    },
  });
}

export function buildAuthRateLimiter(config: AppConfig): AuthRateLimiter {
  if (config.authRateLimitBackend === "external") {
    return new ExternalRateLimiter();
  }

  if (config.authRateLimitBackend === "redis") {
    if (!config.redisUrl) {
      throw new Error("REDIS_URL is required when AUTH_RATE_LIMIT_BACKEND=redis.");
    }

    return new RedisRateLimiter(
      config.redisUrl,
      config.authRateLimitWindowMs,
      config.authRateLimitMax,
    );
  }

  return new MemoryRateLimiter(config.authRateLimitWindowMs, config.authRateLimitMax);
}
