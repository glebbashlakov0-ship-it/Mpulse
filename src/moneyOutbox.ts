import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { Database } from "./db.js";

export type MoneyOutboxStatus =
  | "pending"
  | "processing"
  | "sent"
  | "failed"
  | "dead_letter";

export type MoneyOutboxEvent = {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  idempotencyKey: string;
  payload: unknown;
  status: MoneyOutboxStatus;
  attempt: number;
  availableAt: Date;
  createdAt: Date;
  lockToken: string;
};

export type MoneyOutboxHandler = (event: MoneyOutboxEvent) => Promise<void>;

export type MoneyOutboxLogger = {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
};

type ClaimedRow = {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  idempotency_key: string;
  payload: unknown;
  status: MoneyOutboxStatus;
  attempts: number;
  available_at: Date | string;
  created_at: Date | string;
  lock_token: string;
};

export type RecordFailureResult = "retry" | "dead_letter" | "lease_lost";

export interface MoneyOutboxRepository {
  deadLetterExhausted(input: {
    maxAttempts: number;
    leaseDurationMs: number;
    limit: number;
  }): Promise<number>;
  claimBatch(input: {
    workerId: string;
    batchSize: number;
    leaseDurationMs: number;
    maxAttempts: number;
  }): Promise<MoneyOutboxEvent[]>;
  markSent(event: Pick<MoneyOutboxEvent, "id" | "lockToken">): Promise<boolean>;
  recordFailure(input: {
    event: Pick<MoneyOutboxEvent, "id" | "lockToken">;
    error: string;
    retryAt: Date;
    maxAttempts: number;
  }): Promise<RecordFailureResult>;
}

export class PostgresMoneyOutboxRepository implements MoneyOutboxRepository {
  constructor(private readonly db: Database) {
    if (!db.enabled) {
      throw new Error("Money outbox requires an enabled database.");
    }
  }

  async deadLetterExhausted(input: {
    maxAttempts: number;
    leaseDurationMs: number;
    limit: number;
  }) {
    const result = await this.db.transaction((tx) =>
      tx.query<{ id: string }>(
        `with exhausted as (
           select id
           from money_outbox_events
           where attempts >= $1
             and (
               status in ('pending', 'failed')
               or (
                 status = 'processing'
                 and (
                   locked_at is null
                   or locked_at <= now() - ($2::bigint * interval '1 millisecond')
                 )
               )
             )
           order by available_at, created_at, id
           for update skip locked
           limit $3
         )
         update money_outbox_events events
         set status = 'dead_letter',
             dead_lettered_at = now(),
             locked_at = null,
             locked_by = null,
             lock_token = null,
             last_error = coalesce(
               events.last_error,
               'Maximum delivery attempts exhausted before claim.'
             ),
             updated_at = now()
         from exhausted
         where events.id = exhausted.id
         returning events.id`,
        [input.maxAttempts, input.leaseDurationMs, input.limit],
      ),
    );
    return result.rows.length;
  }

  async claimBatch(input: {
    workerId: string;
    batchSize: number;
    leaseDurationMs: number;
    maxAttempts: number;
  }) {
    const result = await this.db.transaction((tx) =>
      tx.query<ClaimedRow>(
        `with claimable as (
           select id
           from money_outbox_events
           where attempts < $4
             and (
               (status in ('pending', 'failed') and available_at <= now())
               or (
                 status = 'processing'
                 and (
                   locked_at is null
                   or locked_at <= now() - ($3::bigint * interval '1 millisecond')
                 )
               )
             )
           order by available_at, created_at, id
           for update skip locked
           limit $2
         )
         update money_outbox_events events
         set status = 'processing',
             attempts = events.attempts + 1,
             locked_at = now(),
             locked_by = $1,
             lock_token = gen_random_uuid(),
             last_attempt_at = now(),
             updated_at = now()
         from claimable
         where events.id = claimable.id
         returning events.id, events.aggregate_type, events.aggregate_id,
                   events.event_type, events.idempotency_key, events.payload,
                   events.status, events.attempts, events.available_at,
                   events.created_at, events.lock_token`,
        [
          input.workerId,
          input.batchSize,
          input.leaseDurationMs,
          input.maxAttempts,
        ],
      ),
    );

    return result.rows.map(mapClaimedRow);
  }

  async markSent(event: Pick<MoneyOutboxEvent, "id" | "lockToken">) {
    const result = await this.db.query<{ id: string }>(
      `update money_outbox_events
       set status = 'sent',
           processed_at = now(),
           last_error = null,
           locked_at = null,
           locked_by = null,
           lock_token = null,
           updated_at = now()
       where id = $1
         and status = 'processing'
         and lock_token = $2::uuid
       returning id`,
      [event.id, event.lockToken],
    );
    return result.rows.length === 1;
  }

  async recordFailure(input: {
    event: Pick<MoneyOutboxEvent, "id" | "lockToken">;
    error: string;
    retryAt: Date;
    maxAttempts: number;
  }): Promise<RecordFailureResult> {
    const result = await this.db.query<{ status: "failed" | "dead_letter" }>(
      `update money_outbox_events
       set status = case
             when attempts >= $5 then 'dead_letter'
             else 'failed'
           end,
           available_at = case
             when attempts >= $5 then available_at
             else $4
           end,
           last_error = $3,
           dead_lettered_at = case
             when attempts >= $5 then now()
             else null
           end,
           locked_at = null,
           locked_by = null,
           lock_token = null,
           updated_at = now()
       where id = $1
         and status = 'processing'
         and lock_token = $2::uuid
       returning status`,
      [
        input.event.id,
        input.event.lockToken,
        input.error.slice(0, 2_000),
        input.retryAt,
        input.maxAttempts,
      ],
    );

    const status = result.rows[0]?.status;
    return status === "dead_letter"
      ? "dead_letter"
      : status === "failed"
        ? "retry"
        : "lease_lost";
  }
}

export type MoneyOutboxWorkerOptions = {
  repository: MoneyOutboxRepository;
  handler: MoneyOutboxHandler;
  logger: MoneyOutboxLogger;
  workerId?: string;
  batchSize: number;
  concurrency: number;
  leaseDurationMs: number;
  maxAttempts: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  backoffJitterRatio: number;
  now?: () => Date;
  random?: () => number;
};

export type MoneyOutboxRunResult = {
  claimed: number;
  sent: number;
  retried: number;
  deadLettered: number;
  leaseLost: number;
};

export class MoneyOutboxWorker {
  private readonly workerId: string;
  private readonly now: () => Date;
  private readonly random: () => number;

  constructor(private readonly options: MoneyOutboxWorkerOptions) {
    this.workerId =
      options.workerId ??
      `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? Math.random;
    assertWorkerOptions(options);
  }

  async runOnce(): Promise<MoneyOutboxRunResult> {
    const result: MoneyOutboxRunResult = {
      claimed: 0,
      sent: 0,
      retried: 0,
      deadLettered: 0,
      leaseLost: 0,
    };
    const exhausted = await this.options.repository.deadLetterExhausted({
      maxAttempts: this.options.maxAttempts,
      leaseDurationMs: this.options.leaseDurationMs,
      limit: this.options.batchSize,
    });
    result.deadLettered += exhausted;
    if (exhausted > 0) {
      this.options.logger.warn(
        {
          event: "money_outbox.exhausted_dead_lettered",
          workerId: this.workerId,
          count: exhausted,
        },
        "Moved exhausted outbox events to dead letter.",
      );
    }

    const events = await this.options.repository.claimBatch({
      workerId: this.workerId,
      batchSize: this.options.batchSize,
      leaseDurationMs: this.options.leaseDurationMs,
      maxAttempts: this.options.maxAttempts,
    });
    result.claimed = events.length;

    await runWithConcurrency(events, this.options.concurrency, async (event) => {
      await this.deliver(event, result);
    });

    this.options.logger.info(
      {
        event: "money_outbox.drain_completed",
        workerId: this.workerId,
        ...result,
      },
      "Money outbox drain completed.",
    );
    return result;
  }

  private async deliver(event: MoneyOutboxEvent, result: MoneyOutboxRunResult) {
    const startedAt = this.now().getTime();
    const context = {
      outboxEventId: event.id,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      eventType: event.eventType,
      attempt: event.attempt,
      workerId: this.workerId,
    };

    try {
      await this.options.handler(event);
      if (await this.options.repository.markSent(event)) {
        result.sent += 1;
        this.options.logger.info(
          {
            event: "money_outbox.delivery_succeeded",
            ...context,
            durationMs: Math.max(0, this.now().getTime() - startedAt),
          },
          "Money outbox event delivered.",
        );
      } else {
        result.leaseLost += 1;
        this.logLeaseLost(context);
      }
    } catch (error) {
      const errorDetail = safeError(error);
      const delayMs = calculateOutboxBackoffMs({
        attempt: event.attempt,
        baseMs: this.options.backoffBaseMs,
        maxMs: this.options.backoffMaxMs,
        jitterRatio: this.options.backoffJitterRatio,
        random: this.random,
      });
      const retryAt = new Date(this.now().getTime() + delayMs);
      const outcome = await this.options.repository.recordFailure({
        event,
        error: formatStoredError(errorDetail),
        retryAt,
        maxAttempts: this.options.maxAttempts,
      });

      if (outcome === "lease_lost") {
        result.leaseLost += 1;
        this.logLeaseLost(context);
      } else if (outcome === "dead_letter") {
        result.deadLettered += 1;
        this.options.logger.error(
          {
            event: "money_outbox.delivery_dead_lettered",
            ...context,
            ...errorDetail,
            durationMs: Math.max(0, this.now().getTime() - startedAt),
          },
          "Money outbox event moved to dead letter.",
        );
      } else {
        result.retried += 1;
        this.options.logger.warn(
          {
            event: "money_outbox.delivery_retry_scheduled",
            ...context,
            ...errorDetail,
            retryAt: retryAt.toISOString(),
            delayMs,
            durationMs: Math.max(0, this.now().getTime() - startedAt),
          },
          "Money outbox event delivery failed; retry scheduled.",
        );
      }
    }
  }

  private logLeaseLost(context: Record<string, unknown>) {
    this.options.logger.warn(
      { event: "money_outbox.lease_lost", ...context },
      "Money outbox lease was lost before state could be recorded.",
    );
  }
}

export class MoneyOutboxLoop {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private activeRun: Promise<unknown> | null = null;
  private stopping = true;

  constructor(
    private readonly worker: MoneyOutboxWorker,
    private readonly pollIntervalMs: number,
    private readonly logger: MoneyOutboxLogger,
  ) {}

  start() {
    if (!this.stopping) {
      return;
    }
    this.stopping = false;
    this.logger.info(
      { event: "money_outbox.loop_started", pollIntervalMs: this.pollIntervalMs },
      "Money outbox loop started.",
    );
    this.schedule(0);
  }

  async stop() {
    this.stopping = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.activeRun;
    this.logger.info(
      { event: "money_outbox.loop_stopped" },
      "Money outbox loop stopped.",
    );
  }

  private schedule(delayMs: number) {
    this.timer = setTimeout(() => {
      this.timer = null;
      const run = this.worker.runOnce().catch((error) => {
        this.logger.error(
          { event: "money_outbox.drain_failed", ...safeError(error) },
          "Money outbox drain failed.",
        );
      });
      this.activeRun = run;
      void run.finally(() => {
        if (this.activeRun === run) {
          this.activeRun = null;
        }
        if (!this.stopping) {
          this.schedule(this.pollIntervalMs);
        }
      });
    }, delayMs);
  }
}

export function calculateOutboxBackoffMs(input: {
  attempt: number;
  baseMs: number;
  maxMs: number;
  jitterRatio: number;
  random?: () => number;
}) {
  const exponent = Math.min(52, Math.max(0, input.attempt - 1));
  const exponential = Math.min(input.maxMs, input.baseMs * 2 ** exponent);
  const random = Math.min(1, Math.max(0, (input.random ?? Math.random)()));
  const jitterMultiplier =
    1 - input.jitterRatio + 2 * input.jitterRatio * random;
  return Math.max(0, Math.min(input.maxMs, Math.round(exponential * jitterMultiplier)));
}

function mapClaimedRow(row: ClaimedRow): MoneyOutboxEvent {
  if (!row.lock_token) {
    throw new Error(`Claimed outbox event ${row.id} has no lock token.`);
  }
  return {
    id: row.id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    eventType: row.event_type,
    idempotencyKey: row.idempotency_key,
    payload: row.payload,
    status: row.status,
    attempt: Number(row.attempts),
    availableAt: new Date(row.available_at),
    createdAt: new Date(row.created_at),
    lockToken: row.lock_token,
  };
}

async function runWithConcurrency<T>(
  values: T[],
  concurrency: number,
  run: (value: T) => Promise<void>,
) {
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (cursor < values.length) {
        const value = values[cursor];
        cursor += 1;
        if (value !== undefined) {
          await run(value);
        }
      }
    },
  );
  await Promise.all(runners);
}

function safeError(error: unknown) {
  if (error instanceof Error) {
    const code =
      "code" in error &&
      (typeof error.code === "string" || typeof error.code === "number")
        ? String(error.code).slice(0, 100)
        : undefined;
    return {
      errorName: error.name.slice(0, 100),
      errorCode: code,
      errorMessage: error.message.replaceAll(/\s+/g, " ").slice(0, 1_000),
    };
  }
  return {
    errorName: "NonError",
    errorCode: undefined,
    errorMessage: String(error).replaceAll(/\s+/g, " ").slice(0, 1_000),
  };
}

function formatStoredError(error: ReturnType<typeof safeError>) {
  return [error.errorName, error.errorCode && `[${error.errorCode}]`, error.errorMessage]
    .filter(Boolean)
    .join(" ");
}

function assertWorkerOptions(options: MoneyOutboxWorkerOptions) {
  for (const [name, value] of [
    ["batchSize", options.batchSize],
    ["concurrency", options.concurrency],
    ["leaseDurationMs", options.leaseDurationMs],
    ["maxAttempts", options.maxAttempts],
    ["backoffBaseMs", options.backoffBaseMs],
    ["backoffMaxMs", options.backoffMaxMs],
  ] as const) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`${name} must be a positive integer.`);
    }
  }
  if (options.concurrency > options.batchSize) {
    throw new Error("concurrency must not exceed batchSize.");
  }
  if (
    !Number.isFinite(options.backoffJitterRatio) ||
    options.backoffJitterRatio < 0 ||
    options.backoffJitterRatio > 1
  ) {
    throw new Error("backoffJitterRatio must be between 0 and 1.");
  }
}
