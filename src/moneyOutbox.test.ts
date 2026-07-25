import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateOutboxBackoffMs,
  MoneyOutboxWorker,
  type MoneyOutboxEvent,
  type MoneyOutboxLogger,
  type MoneyOutboxRepository,
  type RecordFailureResult,
} from "./moneyOutbox.js";

test("outbox backoff is exponential, jitterable, and capped", () => {
  assert.equal(
    calculateOutboxBackoffMs({
      attempt: 1,
      baseMs: 1_000,
      maxMs: 10_000,
      jitterRatio: 0.2,
      random: () => 0.5,
    }),
    1_000,
  );
  assert.equal(
    calculateOutboxBackoffMs({
      attempt: 5,
      baseMs: 1_000,
      maxMs: 10_000,
      jitterRatio: 0,
    }),
    10_000,
  );
});

test("outbox worker records success, retry, dead letter, and structured safe logs", async () => {
  const events = [
    eventFixture({ id: "sent", eventType: "sent", attempt: 1 }),
    eventFixture({ id: "retry", eventType: "retry", attempt: 1 }),
    eventFixture({ id: "dead", eventType: "dead", attempt: 2 }),
  ];
  const repository = new FakeRepository(events);
  const logs: Array<Record<string, unknown>> = [];
  const logger: MoneyOutboxLogger = {
    info: (fields) => logs.push(fields),
    warn: (fields) => logs.push(fields),
    error: (fields) => logs.push(fields),
  };
  const worker = new MoneyOutboxWorker({
    repository,
    handler: async (event) => {
      if (event.eventType !== "sent") {
        throw new Error(`delivery failed for ${event.eventType}`);
      }
    },
    logger,
    workerId: "worker-test",
    batchSize: 10,
    concurrency: 2,
    leaseDurationMs: 30_000,
    maxAttempts: 2,
    backoffBaseMs: 1_000,
    backoffMaxMs: 60_000,
    backoffJitterRatio: 0,
    now: () => new Date("2026-07-25T00:00:00.000Z"),
  });

  const result = await worker.runOnce();

  assert.deepEqual(result, {
    claimed: 3,
    sent: 1,
    retried: 1,
    deadLettered: 1,
    leaseLost: 0,
  });
  assert.deepEqual(repository.sent, ["sent"]);
  assert.deepEqual(
    repository.failures.map(({ id, outcome }) => ({ id, outcome })),
    [
      { id: "retry", outcome: "retry" },
      { id: "dead", outcome: "dead_letter" },
    ],
  );
  assert.equal(
    repository.failures[0]?.retryAt.toISOString(),
    "2026-07-25T00:00:01.000Z",
  );
  assert.ok(logs.some((entry) => entry.event === "money_outbox.delivery_succeeded"));
  assert.ok(logs.some((entry) => entry.event === "money_outbox.delivery_retry_scheduled"));
  assert.ok(logs.some((entry) => entry.event === "money_outbox.delivery_dead_lettered"));
  assert.equal(JSON.stringify(logs).includes("secret-payload"), false);
});

class FakeRepository implements MoneyOutboxRepository {
  readonly sent: string[] = [];
  readonly failures: Array<{
    id: string;
    outcome: RecordFailureResult;
    retryAt: Date;
  }> = [];

  constructor(private readonly events: MoneyOutboxEvent[]) {}

  async deadLetterExhausted() {
    return 0;
  }

  async claimBatch() {
    return this.events;
  }

  async markSent(event: Pick<MoneyOutboxEvent, "id">) {
    this.sent.push(event.id);
    return true;
  }

  async recordFailure(input: {
    event: Pick<MoneyOutboxEvent, "id">;
    retryAt: Date;
    maxAttempts: number;
  }) {
    const attempt = this.events.find((event) => event.id === input.event.id)?.attempt ?? 0;
    const outcome: RecordFailureResult =
      attempt >= input.maxAttempts ? "dead_letter" : "retry";
    this.failures.push({ id: input.event.id, outcome, retryAt: input.retryAt });
    return outcome;
  }
}

function eventFixture(
  overrides: Partial<MoneyOutboxEvent> & Pick<MoneyOutboxEvent, "id">,
): MoneyOutboxEvent {
  const { id, ...rest } = overrides;
  return {
    id,
    aggregateType: "trade",
    aggregateId: `aggregate-${overrides.id}`,
    eventType: "test",
    idempotencyKey: `outbox-${overrides.id}`,
    payload: { value: "secret-payload" },
    status: "processing",
    attempt: 1,
    availableAt: new Date("2026-07-25T00:00:00.000Z"),
    createdAt: new Date("2026-07-25T00:00:00.000Z"),
    lockToken: "00000000-0000-4000-8000-000000000001",
    ...rest,
  };
}
