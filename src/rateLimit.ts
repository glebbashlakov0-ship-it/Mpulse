import type { FastifyReply, FastifyRequest } from "fastify";
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

export function buildAuthRateLimiter(config: AppConfig) {
  return new MemoryRateLimiter(config.authRateLimitWindowMs, config.authRateLimitMax);
}

export type AuthRateLimiter = ReturnType<typeof buildAuthRateLimiter>;
