import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import pg, { type Pool as PgPool, type PoolClient } from "pg";
import {
  buildCoinWalletService,
  CoinWalletError,
  type VerifiedWithdrawalProviderOutcome,
} from "../src/coinWallets.js";
import type { Database, Queryable } from "../src/db.js";
import {
  ExchangeRateError,
  type ExchangeRateProvider,
} from "../src/exchangeRates.js";
import {
  formatAtomic,
  usdRateNanos,
} from "../src/money.js";
import { PostgresCoinLedgerRepository } from "../src/coins.js";
import {
  LOCAL_SIMULATED_TRADING_MODE,
  TRADING_MODE_REAL_MONEY_WARNING,
  placeCoinTradingOrder,
  type TradingMode,
} from "../src/trading.js";
import { PostgresPortfolioRepository } from "../src/portfolioRepository.js";
import { normalizeMarketDetail } from "../src/normalizers.js";
import { marketFixture } from "../src/testUtils.js";
import {
  buildSettlementService,
  PostgresSettlementRepository,
  SettlementError,
} from "../src/settlement.js";
import { buildLedgerService, MemoryLedgerRepository } from "../src/ledger.js";
import {
  buildAuditService,
  MemoryAuditLogRepository,
} from "../src/audit.js";
import type { RealMoneyExecutionVenueRuntime } from "../src/realMoneyAdapterRuntime.js";
import { buildRealMoneyLaunchApprovalCapabilities } from "../src/realMoneyLaunchApproval.js";
import {
  applyMigration,
  inspectMigration,
} from "./coinsMigration.js";
import { runCoinReconciliation } from "./reconcileCoins.js";
import { migrations } from "../src/migrationPlan.js";
import { auditPostgresTestDatabaseSafety } from "../src/postgresTestDatabaseSafety.js";
import { PostgresMoneyOutboxRepository } from "../src/moneyOutbox.js";

const { Pool } = pg;
const VALID_TRON_ADDRESS = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const USDT_TRON_CONTRACT = VALID_TRON_ADDRESS;
const postgresTestUrl = process.env.TEST_DATABASE_URL;
const databaseSafety = auditPostgresTestDatabaseSafety(process.env);
const skipReason = postgresTestUrl
  ? databaseSafety.ok
    ? false
    : `Unsafe TEST_DATABASE_URL: ${databaseSafety.issues
        .map((issue) => issue.code)
        .join(", ")}`
  : "Set TEST_DATABASE_URL to run Coin Postgres tests.";

test(
  "money outbox claims concurrently, fences stale owners, retries, and dead-letters",
  { skip: skipReason },
  async () => {
    await withIsolatedCoinSchema(async (client, schemaName, pool) => {
      const ids = Array.from({ length: 4 }, () => randomUUID());
      for (const [index, id] of ids.entries()) {
        await client.query(
          `insert into money_outbox_events (
             id, aggregate_type, aggregate_id, event_type, idempotency_key, payload
           ) values ($1, 'test', $1, 'test.event', $2, '{}'::jsonb)`,
          [id, `outbox-postgres-${index}-${id}`],
        );
      }

      const database = databaseForSchema(pool, schemaName);
      const first = new PostgresMoneyOutboxRepository(database);
      const second = new PostgresMoneyOutboxRepository(database);
      const [firstClaim, secondClaim] = await Promise.all([
        first.claimBatch({
          workerId: "worker-a",
          batchSize: 3,
          leaseDurationMs: 30_000,
          maxAttempts: 2,
        }),
        second.claimBatch({
          workerId: "worker-b",
          batchSize: 3,
          leaseDurationMs: 30_000,
          maxAttempts: 2,
        }),
      ]);
      const claimed = [...firstClaim, ...secondClaim];
      assert.equal(claimed.length, 4);
      assert.equal(new Set(claimed.map((event) => event.id)).size, 4);

      const sent = claimed[0];
      assert.ok(sent);
      assert.equal(
        await first.markSent({
          id: sent.id,
          lockToken: "00000000-0000-4000-8000-000000000000",
        }),
        false,
      );
      assert.equal(await first.markSent(sent), true);

      const retry = claimed[1];
      assert.ok(retry);
      assert.equal(
        await first.recordFailure({
          event: retry,
          error: "temporary failure",
          retryAt: new Date(Date.now() - 1_000),
          maxAttempts: 2,
        }),
        "retry",
      );
      const retryClaim = await second.claimBatch({
        workerId: "worker-b",
        batchSize: 1,
        leaseDurationMs: 30_000,
        maxAttempts: 2,
      });
      assert.equal(retryClaim[0]?.id, retry.id);
      assert.equal(retryClaim[0]?.attempt, 2);
      assert.equal(
        await second.recordFailure({
          event: retryClaim[0]!,
          error: "permanent failure",
          retryAt: new Date(),
          maxAttempts: 2,
        }),
        "dead_letter",
      );

      const stale = claimed[2];
      assert.ok(stale);
      await client.query(
        `update money_outbox_events
         set locked_at = now() - interval '2 minutes'
         where id = $1`,
        [stale.id],
      );
      const reclaimed = await second.claimBatch({
        workerId: "worker-b",
        batchSize: 1,
        leaseDurationMs: 1_000,
        maxAttempts: 3,
      });
      assert.equal(reclaimed[0]?.id, stale.id);
      assert.notEqual(reclaimed[0]?.lockToken, stale.lockToken);
      assert.equal(await first.markSent(stale), false);
      assert.equal(await second.markSent(reclaimed[0]!), true);

      const deadLetter = await client.query<{ status: string; dead_lettered_at: Date | null }>(
        `select status, dead_lettered_at
         from money_outbox_events
         where id = $1`,
        [retry.id],
      );
      assert.equal(deadLetter.rows[0]?.status, "dead_letter");
      assert.ok(deadLetter.rows[0]?.dead_lettered_at);
    });
  },
);

test(
  "Coin ledger serializes concurrent debits, protects cached balances, and is immutable",
  { skip: skipReason },
  async () => {
    await withIsolatedCoinSchema(async (client, schemaName, pool) => {
      const userId = randomUUID();
      await insertTestUser(client, userId, `coin-concurrency-${userId}@example.com`);
      await client.query(
        `update money_system_state
         set active_system = 'coin', legacy_writes_enabled = false,
             cutover_completed_at = now(), updated_at = now()
         where singleton = true`,
      );

      const credit = await postCoinEntry(client, {
        userId,
        operationType: "bonus_credit",
        availableDelta: 100_000_000n,
        reservedDelta: 0n,
        idempotencyKey: "test:initial-credit",
        sourceType: "postgres_test",
        sourceId: userId,
        reason: "Coin concurrency test credit",
      });
      const duplicateCredit = await postCoinEntry(client, {
        userId,
        operationType: "bonus_credit",
        availableDelta: 100_000_000n,
        reservedDelta: 0n,
        idempotencyKey: "test:initial-credit",
        sourceType: "postgres_test",
        sourceId: userId,
        reason: "Coin concurrency test credit",
      });
      assert.equal(duplicateCredit.id, credit.id);

      await assert.rejects(
        () =>
          postCoinEntry(client, {
            userId,
            operationType: "bonus_credit",
            availableDelta: 99_000_000n,
            reservedDelta: 0n,
            idempotencyKey: "test:initial-credit",
            sourceType: "postgres_test",
            sourceId: userId,
            reason: "Coin concurrency test credit",
          }),
        /COIN_IDEMPOTENCY_KEY_REUSE_MISMATCH/,
      );

      const first = await pool.connect();
      const second = await pool.connect();
      try {
        await setSearchPath(first, schemaName);
        await setSearchPath(second, schemaName);
        const results = await Promise.allSettled([
          postCoinEntry(first, {
            userId,
            operationType: "correction_debit",
            availableDelta: -80_000_000n,
            reservedDelta: 0n,
            idempotencyKey: "test:concurrent-debit:1",
            sourceType: "postgres_test",
            sourceId: userId,
            reason: "First concurrent debit",
            adminActor: "postgres-test",
          }),
          postCoinEntry(second, {
            userId,
            operationType: "correction_debit",
            availableDelta: -80_000_000n,
            reservedDelta: 0n,
            idempotencyKey: "test:concurrent-debit:2",
            sourceType: "postgres_test",
            sourceId: userId,
            reason: "Second concurrent debit",
            adminActor: "postgres-test",
          }),
        ]);
        assert.equal(
          results.filter((result) => result.status === "fulfilled").length,
          1,
        );
        assert.equal(
          results.filter(
            (result) =>
              result.status === "rejected" &&
              String(result.reason).includes("INSUFFICIENT_COIN_BALANCE"),
          ).length,
          1,
        );
      } finally {
        first.release();
        second.release();
      }

      const balance = await client.query<{
        available_coin_micros: string;
        reserved_coin_micros: string;
      }>(
        `select available_coin_micros::text, reserved_coin_micros::text
         from coin_accounts where user_id = $1`,
        [userId],
      );
      assert.deepEqual(balance.rows[0], {
        available_coin_micros: "20000000",
        reserved_coin_micros: "0",
      });

      await assert.rejects(
        () =>
          client.query(
            `update coin_accounts
             set available_coin_micros = available_coin_micros + 1
             where user_id = $1`,
            [userId],
          ),
        /only change through coin_post_ledger_entry/,
      );
      await assert.rejects(
        () =>
          client.query(
            `update coin_ledger_entries set reason = 'mutated' where id = $1`,
            [credit.id],
          ),
        /immutable/,
      );
    });
  },
);

test(
  "legacy cutover snapshots under a fence, preserves totals, is a second-run no-op, and reconciles",
  { skip: skipReason },
  async () => {
    await withIsolatedCoinSchema(async (client) => {
      const userId = randomUUID();
      const walletId = randomUUID();
      await insertTestUser(client, userId, `coin-migration-${userId}@example.com`);
      await client.query(`delete from money_system_state where singleton = true`);
      await assert.rejects(
        () =>
          postCoinEntry(client, {
            userId,
            operationType: "migration_credit",
            availableDelta: 1n,
            reservedDelta: 0n,
            idempotencyKey: "missing-cutover-state",
            sourceType: "postgres_test",
            sourceId: userId,
            reason: "Missing cutover state must fail closed",
          }),
        /COIN_CUTOVER_INCOMPLETE/,
      );
      await client.query(
        `insert into money_system_state (
           singleton, active_system, legacy_writes_enabled
         ) values (true, 'legacy', true)`,
      );
      await client.query(
        `insert into wallets (
           id, user_id, asset, network, balance, initial_balance, status,
           address, provider, created_at, updated_at
         ) values (
           $1, $2, 'USDT', 'TRON', 0, 0, 'active',
           'TQ7mYw3xFv8pLk2nR6sD4hJ9aBcEfGhijK', 'internal_wallet', now(), now()
         )`,
        [walletId, userId],
      );
      const entries = [
        ["credit", "100.123456", "legacy-credit"],
        ["debit", "10", "legacy-debit"],
        ["hold", "20", "legacy-hold"],
        ["release", "5", "legacy-release"],
      ] as const;
      for (const [entryType, amount, key] of entries) {
        await client.query(
          `insert into ledger_entries (
             id, user_id, wallet_id, entry_type, asset, amount, reason,
             reference_type, reference_id, idempotency_key, metadata,
             created_at, updated_at
           ) values (
             $1, $2, $3, $4, 'USDT', $5::numeric, $6,
             'postgres_test', $8, $7, '{}'::jsonb, now(), now()
           )`,
          [
            randomUUID(),
            userId,
            walletId,
            entryType,
            amount,
            key,
            `migration:${key}`,
            userId,
          ],
        );
      }
      await client.query(
        `insert into wallet_deposit_events (
           id, tx_hash, log_index, wallet_id, user_id, amount, asset, network,
           confirmations, status, provider, recipient_address, event_fingerprint,
           raw_payload, created_at, updated_at
         ) values (
           $1, $2, '0', $3, $4, 7, 'USDT', 'TRON', 1, 'detected',
           'internal_wallet', 'TQ7mYw3xFv8pLk2nR6sD4hJ9aBcEfGhijK', $5,
           '{}'::jsonb, now(), now()
         )`,
        [
          randomUUID(),
          `migration-pending-${userId}`,
          walletId,
          userId,
          `migration-pending-fingerprint-${userId}`,
        ],
      );
      await client.query(
        `insert into wallet_withdrawal_requests (
           id, user_id, asset, network, destination_address, amount, status,
           provider, idempotency_key, request_fingerprint, real_transfer_blocked,
           block_reason, metadata, created_at, updated_at
         ) values (
           $1, $2, 'USDT', 'TRON',
           'TQ7mYw3xFv8pLk2nR6sD4hJ9aBcEfGhijK', 4, 'pending_review',
           'internal_wallet', $3, $4, true, 'TRANSFERS_UNAVAILABLE',
           '{}'::jsonb, now(), now()
         )`,
        [
          randomUUID(),
          userId,
          `migration-withdrawal-${userId}`,
          `migration-withdrawal-fingerprint-${userId}`,
        ],
      );
      const historicalTradeId = randomUUID();
      const historicalPositionId = randomUUID();
      const historicalSettlementId = randomUUID();
      const historicalPayoutId = randomUUID();
      await client.query(
        `insert into trades (
           id, user_id, wallet_id, market_id, market_external_id, side,
           trade_type, amount, price, shares, status, idempotency_key,
           metadata, created_at, updated_at
         ) values (
           $1, $2, null, null, 'legacy-market', 'yes',
           'buy', 12.5, 0.5, 25, 'filled', $3,
           '{"publicActivity":false}'::jsonb, now(), now()
         )`,
        [historicalTradeId, userId, `legacy-trade-${userId}`],
      );
      await client.query(
        `insert into positions (
           id, user_id, market_id, market_external_id, market_title, side,
           shares, total_cost, average_price, last_price, created_at,
           opened_at, updated_at
         ) values (
           $1, $2, null, 'legacy-market', 'Legacy market', 'yes',
           25, 12.5, 0.5, 0.6, now(), now(), now()
         )`,
        [historicalPositionId, userId],
      );
      await client.query(
        `insert into market_settlements (
           id, market_external_id, status, winning_side, total_pool,
           winning_pool, platform_fee, distributable_pool, payout_count,
           idempotency_key, metadata, created_at, updated_at
         ) values (
           $1, 'legacy-settlement-market', 'resolved', 'yes', 10, 5, 1, 9, 1,
           $2, '{}'::jsonb, now(), now()
         )`,
        [
          historicalSettlementId,
          `legacy-settlement-${historicalSettlementId}`,
        ],
      );
      await client.query(
        `insert into market_settlement_payouts (
           id, settlement_id, market_external_id, user_id, side,
           original_stake, payout, profit, kind, metadata, created_at, updated_at
         ) values (
           $1, $2, 'legacy-settlement-market', $3, 'yes',
           5, 9, 4, 'payout', '{}'::jsonb, now(), now()
         )`,
        [historicalPayoutId, historicalSettlementId, userId],
      );

      const dryRun = await inspectMigration(client);
      assert.equal(dryRun.legacyAvailableCoinMicros, "75123456");
      assert.equal(dryRun.legacyReservedCoinMicros, "15000000");
      assert.equal(dryRun.pendingDepositCount, "1");
      assert.equal(dryRun.pendingWithdrawalCount, "1");
      assert.equal(dryRun.pendingDepositCoinMicros, "7000000");
      assert.equal(dryRun.pendingWithdrawalCoinMicros, "4000000");
      assert.equal(dryRun.accountsToMigrate, 1);

      await assert.rejects(
        () => applyMigration(client),
        /legacy pending operations must be drained first \(deposits=1, withdrawals=1\)/,
      );
      const blockedApplyState = await client.query<{
        active_system: string;
        legacy_writes_enabled: boolean;
        account_count: string;
        marker_count: string;
        cutover_run_count: string;
        trade_migration_version: string | null;
      }>(
        `select
           state.active_system,
           state.legacy_writes_enabled,
           (select count(*) from coin_accounts)::text as account_count,
           (select count(*) from coin_migration_markers)::text as marker_count,
           (select count(*) from coin_cutover_runs)::text as cutover_run_count,
           (select coin_migration_version from trades where id = $1)
             as trade_migration_version
         from money_system_state state
         where state.singleton = true`,
        [historicalTradeId],
      );
      assert.deepEqual(blockedApplyState.rows[0], {
        active_system: "legacy",
        legacy_writes_enabled: true,
        account_count: "0",
        marker_count: "0",
        cutover_run_count: "0",
        trade_migration_version: null,
      });

      const unsafeSharesTradeId = randomUUID();
      const unsafeSharesPositionId = randomUUID();
      await client.query(
        `insert into trades (
           id, user_id, wallet_id, market_id, market_external_id, side,
           trade_type, amount, price, shares, status, idempotency_key,
           metadata, created_at, updated_at
         ) values (
           $1, $2, null, null, 'unsafe-shares-trade', 'yes',
           'buy', 1, 0.5, 1.0000001, 'filled', $3,
           '{"publicActivity":false}'::jsonb, now(), now()
         )`,
        [
          unsafeSharesTradeId,
          userId,
          `unsafe-shares-trade-${unsafeSharesTradeId}`,
        ],
      );
      await client.query(
        `insert into positions (
           id, user_id, market_id, market_external_id, market_title, side,
           shares, total_cost, average_price, last_price, created_at,
           opened_at, updated_at
         ) values (
           $1, $2, null, 'unsafe-shares-position', 'Unsafe shares position',
           'yes', 9223372036855, 1, 0.5, 0.5, now(), now(), now()
         )`,
        [unsafeSharesPositionId, userId],
      );
      const unsafeSharesDryRun = await inspectMigration(client);
      assert.ok(
        unsafeSharesDryRun.unsafeProjectionRows.includes(
          `trade:${unsafeSharesTradeId}`,
        ),
      );
      assert.ok(
        unsafeSharesDryRun.unsafeProjectionRows.includes(
          `position:${unsafeSharesPositionId}`,
        ),
      );
      await client.query(`delete from trades where id = $1`, [unsafeSharesTradeId]);
      await client.query(`delete from positions where id = $1`, [
        unsafeSharesPositionId,
      ]);

      await client.query(
        `update wallet_deposit_events
         set status = 'rejected',
             rejection_reason = 'Drained before Coin cutover',
             updated_at = now()
         where id = (
           select id from wallet_deposit_events
           where tx_hash = $1
         )`,
        [`migration-pending-${userId}`],
      );
      await client.query(
        `update wallet_withdrawal_requests
         set status = 'cancelled', updated_at = now()
         where idempotency_key = $1`,
        [`migration-withdrawal-${userId}`],
      );
      const drainedDryRun = await inspectMigration(client);
      assert.equal(drainedDryRun.pendingDepositCount, "0");
      assert.equal(drainedDryRun.pendingWithdrawalCount, "0");
      assert.equal(drainedDryRun.pendingDepositCoinMicros, "0");
      assert.equal(drainedDryRun.pendingWithdrawalCoinMicros, "0");

      const snapshotOptions = {
        releaseMarker: `postgres-test-cutover-${userId}`,
        databaseTarget: {
          urlHostname: "postgres-test.example",
          urlPort: 5432,
          urlDatabaseName: "mpulse_coins_test",
          connectedDatabaseName: "mpulse_coins_test",
          serverAddress: "127.0.0.1",
          serverPort: 5432,
          ssl: false,
          fingerprint: "a".repeat(64),
        },
      };
      const applied = await applyMigration(client, snapshotOptions);
      assert.equal(applied.noOp, false);
      assert.deepEqual(applied.afterCoinTotals, {
        accounts: "1",
        availableCoinMicros: "75123456",
        reservedCoinMicros: "15000000",
        totalCoinMicros: "90123456",
      });
      const migratedProjection = await client.query<{
        amount_coin_micros: string;
        price_nanos: string;
        trade_migration_version: string | null;
        total_cost_coin_micros: string;
        payout_coin_micros: string;
      }>(
        `select
           trades.amount_coin_micros::text,
           trades.price_nanos::text,
           trades.coin_migration_version as trade_migration_version,
           positions.total_cost_coin_micros::text,
           payouts.payout_coin_micros::text
         from trades
         join positions on positions.id = $2
         join market_settlement_payouts payouts on payouts.id = $3
         where trades.id = $1`,
        [historicalTradeId, historicalPositionId, historicalPayoutId],
      );
      assert.deepEqual(migratedProjection.rows[0], {
        amount_coin_micros: "12500000",
        price_nanos: "500000000",
        trade_migration_version: "coins-v1-legacy-usdt-parity",
        total_cost_coin_micros: "12500000",
        payout_coin_micros: "9000000",
      });

      const snapshotEvidence = await client.query<{
        snapshot_count: string;
        balance_row_count: string;
        balance_snapshot_sha256: string;
        legacy_account_count: number;
      }>(
        `select
           (select count(*) from coin_cutover_snapshots
             where release_marker = $1)::text as snapshot_count,
           (select count(*) from coin_cutover_balance_snapshots
             where release_marker = $1)::text as balance_row_count,
           snapshots.balance_snapshot_sha256,
           snapshots.legacy_account_count
         from coin_cutover_snapshots snapshots
         where snapshots.release_marker = $1`,
        [snapshotOptions.releaseMarker],
      );
      assert.equal(snapshotEvidence.rows[0]?.snapshot_count, "1");
      assert.equal(snapshotEvidence.rows[0]?.balance_row_count, "1");
      assert.equal(snapshotEvidence.rows[0]?.legacy_account_count, 1);
      assert.match(
        snapshotEvidence.rows[0]?.balance_snapshot_sha256 ?? "",
        /^[a-f0-9]{64}$/,
      );

      const postCutoverUserId = randomUUID();
      await insertTestUser(
        client,
        postCutoverUserId,
        `coin-post-cutover-${postCutoverUserId}@example.com`,
      );
      const secondRun = await applyMigration(client, snapshotOptions);
      assert.equal(secondRun.noOp, true);
      assert.deepEqual(secondRun.afterCoinTotals, applied.afterCoinTotals);
      const repeatedEvidence = await client.query<{
        snapshot_count: string;
        balance_row_count: string;
      }>(
        `select
           (select count(*) from coin_cutover_snapshots
             where release_marker = $1)::text as snapshot_count,
           (select count(*) from coin_cutover_balance_snapshots
             where release_marker = $1)::text as balance_row_count`,
        [snapshotOptions.releaseMarker],
      );
      assert.deepEqual(repeatedEvidence.rows[0], {
        snapshot_count: "1",
        balance_row_count: "1",
      });
      await assert.rejects(
        () =>
          applyMigration(client, {
            ...snapshotOptions,
            databaseTarget: {
              ...snapshotOptions.databaseTarget,
              fingerprint: "b".repeat(64),
            },
          }),
        /lacks matching pre-cutover production snapshot evidence/,
      );
      await assert.rejects(
        () =>
          client.query(
            `update coin_cutover_snapshots
             set legacy_account_count = legacy_account_count + 1
             where release_marker = $1`,
            [snapshotOptions.releaseMarker],
          ),
        /immutable/,
      );

      await client.query(
        `update wallets
         set provider = 'fireblocks', updated_at = now()
         where id = $1`,
        [walletId],
      );
      const otherUserId = randomUUID();
      await insertTestUser(
        client,
        otherUserId,
        `coin-fireblocks-owner-${otherUserId}@example.com`,
      );
      await assert.rejects(
        () =>
          client.query(
            `insert into wallets (
               id, user_id, asset, network, balance, initial_balance, status,
               address, provider, created_at, updated_at
             ) values (
               $1, $2, 'USDT', 'TRON', 0, 0, 'active',
               'TQ7mYw3xFv8pLk2nR6sD4hJ9aBcEfGhijK', 'fireblocks', now(), now()
             )`,
            [randomUUID(), otherUserId],
          ),
        /wallets_fireblocks_destination_ownership_uidx/,
      );

      const activeSellOrderId = randomUUID();
      await client.query(
        `insert into trade_execution_orders (
           id, user_id, market_external_id, market_title, side, action, status,
           requested_coin_micros, requested_shares, quote_price_nanos,
           idempotency_key, request_fingerprint
         ) values (
           $1, $2, 'active-sell-market', 'Active sell market', 'yes', 'sell',
           'execution_pending', 0, 1, 500000000, $3, $4
         )`,
        [
          activeSellOrderId,
          userId,
          `active-sell-${activeSellOrderId}`,
          `active-sell-fingerprint-${activeSellOrderId}`,
        ],
      );
      await assert.rejects(
        () =>
          client.query(
            `insert into trade_execution_orders (
               id, user_id, market_external_id, market_title, side, action, status,
               requested_coin_micros, requested_shares, quote_price_nanos,
               idempotency_key, request_fingerprint
             ) values (
               $1, $2, 'active-sell-market', 'Active sell market', 'yes', 'sell',
               'manual_review', 0, 1, 500000000, $3, $4
             )`,
            [
              randomUUID(),
              userId,
              `active-sell-conflict-${activeSellOrderId}`,
              `active-sell-conflict-fingerprint-${activeSellOrderId}`,
            ],
          ),
        /trade_execution_orders_active_sell_execution_uidx/,
      );
      await client.query(`delete from trade_execution_orders where id = $1`, [
        activeSellOrderId,
      ]);

      await assert.rejects(
        () =>
          client.query(
            `insert into ledger_entries (
               id, user_id, wallet_id, entry_type, asset, amount, reason,
               reference_type, reference_id, idempotency_key, metadata,
               created_at, updated_at
             ) values (
               $1, $2, $3, 'credit', 'USDT', 1, 'post-cutover-write',
               'postgres_test', $5, $4, '{}'::jsonb, now(), now()
             )`,
            [
              randomUUID(),
              userId,
              walletId,
              `post-cutover-${userId}`,
              userId,
            ],
          ),
        /LEGACY_MONEY_WRITES_FENCED/,
      );

      await client.query("begin");
      try {
        await client.query(
          `alter table ledger_entries
           disable trigger ledger_entries_coin_cutover_fence`,
        );
        await client.query(
          `insert into ledger_entries (
             id, user_id, wallet_id, entry_type, asset, amount, reason,
             reference_type, reference_id, idempotency_key, metadata,
             created_at, updated_at
           ) values (
             $1, $2, $3, 'credit', 'USDT', 1, 'injected-post-cutover-write',
             'postgres_test', $5, $4, '{}'::jsonb,
             clock_timestamp(), clock_timestamp()
           )`,
          [
            randomUUID(),
            userId,
            walletId,
            `injected-post-cutover-${userId}`,
            userId,
          ],
        );
        const malformedSellOrderId = randomUUID();
        await client.query(
          `insert into trade_execution_orders (
             id, user_id, market_external_id, market_title, side, action, status,
             requested_coin_micros, requested_shares, quote_price_nanos,
             filled_coin_micros, fee_coin_micros, executed_shares,
             executed_price_nanos, idempotency_key, request_fingerprint
           ) values (
             $1, $2, 'malformed-sell-market', 'Malformed sell market',
             'yes', 'sell', 'filled', 0, 1, 500000000,
             500000, 10000, 1, 500000000, $3, $4
           )`,
          [
            malformedSellOrderId,
            userId,
            `malformed-sell-${malformedSellOrderId}`,
            `malformed-sell-fingerprint-${malformedSellOrderId}`,
          ],
        );
        await client.query(
          `insert into money_outbox_events (
             aggregate_type, aggregate_id, event_type, idempotency_key,
             status, available_at, created_at
           ) values (
             'postgres_test', $1, 'postgres_test.stale', $2,
             'pending', now() - interval '1 hour', now() - interval '1 hour'
           )`,
          [
            malformedSellOrderId,
            `stale-outbox-${malformedSellOrderId}`,
          ],
        );

        const detected = await runCoinReconciliation(client);
        assert.equal(detected.status, "failed");
        assert.ok(detected.categoryCounts.legacy_writes_after_coin_cutover > 0);
        assert.ok(detected.categoryCounts.trade_execution_accounting > 0);
        assert.ok(detected.categoryCounts.trade_projection > 0);
        assert.ok(detected.categoryCounts.outbox_delivery > 0);
      } finally {
        await client.query("rollback");
      }

      const reconciliation = await runCoinReconciliation(client);
      assert.equal(reconciliation.status, "passed");
      assert.equal(reconciliation.discrepancyCount, 0);
    });
  },
);

test(
  "signed deposits are concurrent-idempotent, persist one atomic credit, detect conflicts, and compensate reversals",
  { skip: skipReason },
  async () => {
    await withIsolatedCoinSchema(async (client, schemaName, pool) => {
      const userId = randomUUID();
      await insertTestUser(client, userId, `coin-deposit-${userId}@example.com`);
      await insertFireblocksWallet(client, userId);
      await activateCoinSystem(client);
      const clock = () => new Date("2026-07-25T12:00:00.000Z");
      const db = buildSchemaDatabase(pool, schemaName);
      const service = buildCoinWalletService({
        db,
        rateProvider: fixedRateProvider(clock, {
          rateNanos: 1_020_000_000n,
        }),
        rateTtlSeconds: 60,
        requiredConfirmations: 10,
        usdtTronContract: USDT_TRON_CONTRACT,
        allowDepositCredits: true,
        now: clock,
      });

      await service.createDepositIntent({
        userId,
        expectedUsdtAtomic: "10000000",
      });
      const event = buildVerifiedDepositEvent({
        eventId: `deposit-event-${userId}`,
        providerTransactionId: `fireblocks-deposit-${userId}`,
        txHash: `chain-deposit-${userId}`,
        amount: "10",
      });
      const concurrent = await Promise.all([
        service.processFireblocksWebhook(event),
        service.processFireblocksWebhook(event),
      ]);
      assert.equal(new Set(concurrent.map((result) => result.deposit?.id)).size, 1);
      assert.equal(
        concurrent.filter((result) => result.idempotent === false).length,
        1,
      );
      assert.equal(
        concurrent.filter((result) => result.idempotent === true).length,
        1,
      );
      assert.equal(
        concurrent[0]?.deposit?.status,
        "credited",
        JSON.stringify(concurrent[0]),
      );
      assert.equal(concurrent[0]?.deposit?.creditedCoinMicros, "10200000");

      const duplicate = await service.processFireblocksWebhook(event);
      assert.equal(duplicate.idempotent, true);
      assert.equal(duplicate.deposit?.status, "credited");

      const conflict = await service.processFireblocksWebhook(
        buildVerifiedDepositEvent({
          eventId: `deposit-event-${userId}`,
          providerTransactionId: `fireblocks-deposit-${userId}`,
          txHash: `chain-deposit-${userId}`,
          amount: "11",
        }),
      );
      assert.equal(conflict.conflict, true);
      assert.equal(
        conflict.creditBlockedReason,
        "PROVIDER_EVENT_ID_PAYLOAD_CONFLICT",
      );

      const afterCredit = await new PostgresCoinLedgerRepository(db).getBalance(
        userId,
      );
      assert.deepEqual(afterCredit, {
        userId,
        availableCoinMicros: "10200000",
        reservedCoinMicros: "0",
        totalCoinMicros: "10200000",
      });
      const persisted = await client.query<{
        ledger_count: string;
        rate_count: string;
        credited_count: string;
      }>(
        `select
           (select count(*) from coin_ledger_entries
             where user_id = $1 and operation_type = 'crypto_deposit_credit')::text
               as ledger_count,
           (select count(*) from exchange_rate_snapshots)::text as rate_count,
           (select count(*) from crypto_deposits where status = 'credited')::text
               as credited_count`,
        [userId],
      );
      assert.deepEqual(persisted.rows[0], {
        ledger_count: "1",
        rate_count: "1",
        credited_count: "1",
      });

      const reversalEvent = buildVerifiedDepositEvent({
        eventId: `deposit-reversal-${userId}`,
        providerTransactionId: `fireblocks-deposit-${userId}`,
        txHash: `chain-deposit-${userId}`,
        amount: "10",
        status: "FAILED",
        eventType: "TRANSACTION_REORGED",
      });
      const reversal = await service.processFireblocksWebhook(reversalEvent);
      assert.equal(reversal.deposit?.status, "reversed");
      assert.equal(reversal.ledgerEntry?.operationType, "reversed_deposit");
      const repeatedReversal =
        await service.processFireblocksWebhook(reversalEvent);
      assert.equal(repeatedReversal.idempotent, true);

      const afterReversal =
        await new PostgresCoinLedgerRepository(db).getBalance(userId);
      assert.equal(afterReversal.availableCoinMicros, "0");
      const entries = await new PostgresCoinLedgerRepository(db).listEntries(
        userId,
      );
      assert.deepEqual(
        entries.map((entry) => entry.operationType).sort(),
        ["crypto_deposit_credit", "reversed_deposit"],
      );
    });
  },
);

test(
  "deposit reversal retries stay pending until available Coins are released and then reverse exactly once",
  { skip: skipReason },
  async () => {
    await withIsolatedCoinSchema(async (client, schemaName, pool) => {
      const userId = randomUUID();
      await insertTestUser(
        client,
        userId,
        `coin-deposit-reversal-retry-${userId}@example.com`,
      );
      await insertFireblocksWallet(client, userId);
      await activateCoinSystem(client);
      const clock = () => new Date("2026-07-25T12:00:00.000Z");
      const db = buildSchemaDatabase(pool, schemaName);
      const service = buildCoinWalletService({
        db,
        rateProvider: fixedRateProvider(clock),
        rateTtlSeconds: 60,
        requiredConfirmations: 10,
        usdtTronContract: USDT_TRON_CONTRACT,
        allowDepositCredits: true,
        now: clock,
      });

      await service.createDepositIntent({
        userId,
        expectedUsdtAtomic: "10000000",
      });
      const providerTransactionId = `fireblocks-deposit-reversal-retry-${userId}`;
      const txHash = `chain-deposit-reversal-retry-${userId}`;
      const credited = await service.processFireblocksWebhook(
        buildVerifiedDepositEvent({
          eventId: `deposit-event-${userId}`,
          providerTransactionId,
          txHash,
          amount: "10",
        }),
      );
      assert.equal(credited.deposit?.status, "credited");
      assert.equal(credited.deposit?.creditedCoinMicros, "10000000");

      await postCoinEntry(client, {
        userId,
        operationType: "withdrawal_reserve",
        availableDelta: -10_000_000n,
        reservedDelta: 10_000_000n,
        idempotencyKey: `test:deposit-reversal-reserve:${userId}`,
        sourceType: "postgres_test",
        sourceId: userId,
        reason: "Reserve credited Coins before a provider reversal retry",
      });

      const reversalEvent = buildVerifiedDepositEvent({
        eventId: `deposit-reversal-${userId}`,
        providerTransactionId,
        txHash,
        amount: "10",
        status: "FAILED",
        eventType: "TRANSACTION_REORGED",
      });
      const pending = await service.processFireblocksWebhook(reversalEvent);
      assert.equal(pending.deposit?.status, "reversal_pending");
      assert.equal(pending.ledgerEntry, null);
      assert.equal(
        pending.creditBlockedReason,
        "REVERSAL_INSUFFICIENT_AVAILABLE_COINS",
      );

      const pendingRetry =
        await service.processFireblocksWebhook(reversalEvent);
      assert.equal(pendingRetry.deposit?.status, "reversal_pending");
      assert.equal(pendingRetry.ledgerEntry, null);
      assert.equal(
        pendingRetry.creditBlockedReason,
        "REVERSAL_INSUFFICIENT_AVAILABLE_COINS",
      );
      const beforeRelease = await client.query<{ reversal_count: string }>(
        `select count(*)::text as reversal_count
         from coin_ledger_entries
         where user_id = $1 and operation_type = 'reversed_deposit'`,
        [userId],
      );
      assert.equal(beforeRelease.rows[0]?.reversal_count, "0");

      await postCoinEntry(client, {
        userId,
        operationType: "withdrawal_release",
        availableDelta: 10_000_000n,
        reservedDelta: -10_000_000n,
        idempotencyKey: `test:deposit-reversal-release:${userId}`,
        sourceType: "postgres_test",
        sourceId: userId,
        reason: "Release credited Coins for the provider reversal retry",
      });

      const reversed = await service.processFireblocksWebhook(reversalEvent);
      assert.equal(reversed.deposit?.status, "reversed");
      assert.equal(reversed.ledgerEntry?.operationType, "reversed_deposit");
      assert.ok(reversed.ledgerEntry?.id);

      const repeated = await service.processFireblocksWebhook(reversalEvent);
      assert.equal(repeated.deposit?.status, "reversed");
      assert.equal(repeated.idempotent, true);
      assert.equal(repeated.ledgerEntry?.id, reversed.ledgerEntry.id);

      const persisted = await client.query<{
        credit_count: string;
        reversal_count: string;
      }>(
        `select
           count(*) filter (
             where operation_type = 'crypto_deposit_credit'
           )::text as credit_count,
           count(*) filter (
             where operation_type = 'reversed_deposit'
           )::text as reversal_count
         from coin_ledger_entries
         where user_id = $1`,
        [userId],
      );
      assert.deepEqual(persisted.rows[0], {
        credit_count: "1",
        reversal_count: "1",
      });
      assert.deepEqual(
        await new PostgresCoinLedgerRepository(db).getBalance(userId),
        {
          userId,
          availableCoinMicros: "0",
          reservedCoinMicros: "0",
          totalCoinMicros: "0",
        },
      );
    });
  },
);

test(
  "deposit validation is monotonic and blocks wrong coordinates, unavailable rates, stale rates, and review-only crediting",
  { skip: skipReason },
  async () => {
    await withIsolatedCoinSchema(async (client, schemaName, pool) => {
      const userId = randomUUID();
      await insertTestUser(client, userId, `coin-deposit-state-${userId}@example.com`);
      await insertFireblocksWallet(client, userId);
      await activateCoinSystem(client);
      let currentTime = new Date("2026-07-25T12:00:00.000Z");
      const clock = () => new Date(currentTime);
      const db = buildSchemaDatabase(pool, schemaName);
      const buildService = (
        rateProvider: ExchangeRateProvider,
        allowDepositCredits = true,
      ) =>
        buildCoinWalletService({
          db,
          rateProvider,
          rateTtlSeconds: 60,
          requiredConfirmations: 10,
          usdtTronContract: USDT_TRON_CONTRACT,
          allowDepositCredits,
          now: clock,
        });
      const service = buildService(fixedRateProvider(clock));

      await service.createDepositIntent({
        userId,
        expectedUsdtAtomic: "5000000",
      });
      const pending = await service.processFireblocksWebhook(
        buildVerifiedDepositEvent({
          eventId: `pending-${userId}`,
          providerTransactionId: `ordered-${userId}`,
          txHash: `ordered-chain-${userId}`,
          amount: "5",
          confirmations: 2,
          status: "PENDING_AML_SCREENING",
        }),
      );
      assert.equal(pending.deposit?.status, "confirming");
      assert.equal(pending.deposit?.actualConfirmations, "2");

      const confirmed = await service.processFireblocksWebhook(
        buildVerifiedDepositEvent({
          eventId: `confirmed-${userId}`,
          providerTransactionId: `ordered-${userId}`,
          txHash: `ordered-chain-${userId}`,
          amount: "5",
          confirmations: 12,
        }),
      );
      assert.equal(
        confirmed.deposit?.status,
        "credited",
        JSON.stringify(confirmed),
      );
      const outOfOrder = await service.processFireblocksWebhook(
        buildVerifiedDepositEvent({
          eventId: `late-old-${userId}`,
          providerTransactionId: `ordered-${userId}`,
          txHash: `ordered-chain-${userId}`,
          amount: "5",
          confirmations: 1,
          status: "PENDING_AML_SCREENING",
        }),
      );
      assert.equal(outOfOrder.deposit?.status, "credited");
      assert.equal(outOfOrder.deposit?.actualConfirmations, "12");

      currentTime = new Date(currentTime.getTime() + 1_000);
      await service.createDepositIntent({
        userId,
        expectedUsdtAtomic: "3000000",
      });
      const stale = await buildService(
        fixedRateProvider(clock, { stale: true }),
      ).processFireblocksWebhook(
        buildVerifiedDepositEvent({
          eventId: `stale-${userId}`,
          providerTransactionId: `stale-tx-${userId}`,
          txHash: `stale-chain-${userId}`,
          amount: "3",
        }),
      );
      assert.equal(stale.deposit?.status, "confirmed_unpriced");
      assert.equal(stale.creditBlockedReason, "RATE_STALE");

      await client.query(
        `update wallet_deposit_intents
         set status = 'expired'
         where user_id = $1 and status in ('waiting', 'detected')`,
        [userId],
      );
      currentTime = new Date(currentTime.getTime() + 1_000);
      await service.createDepositIntent({
        userId,
        expectedUsdtAtomic: "4000000",
      });
      const unavailable = await buildService(
        fixedRateProvider(clock, { unavailable: true }),
      ).processFireblocksWebhook(
        buildVerifiedDepositEvent({
          eventId: `unavailable-${userId}`,
          providerTransactionId: `unavailable-tx-${userId}`,
          txHash: `unavailable-chain-${userId}`,
          amount: "4",
        }),
      );
      assert.equal(unavailable.deposit?.status, "pending_rate");
      assert.equal(unavailable.creditBlockedReason, "RATE_UNAVAILABLE");

      await client.query(
        `update wallet_deposit_intents
         set status = 'expired'
         where user_id = $1 and status in ('waiting', 'detected')`,
        [userId],
      );
      currentTime = new Date(currentTime.getTime() + 1_000);
      await service.createDepositIntent({
        userId,
        expectedUsdtAtomic: "2000000",
      });
      const wrongContract = await service.processFireblocksWebhook(
        buildVerifiedDepositEvent({
          eventId: `wrong-contract-${userId}`,
          providerTransactionId: `wrong-contract-tx-${userId}`,
          txHash: `wrong-contract-chain-${userId}`,
          amount: "2",
          tokenContract: "TInvalidContractAddress",
        }),
      );
      assert.equal(wrongContract.deposit?.status, "manual_review");
      assert.equal(wrongContract.creditBlockedReason, "TOKEN_CONTRACT_MISMATCH");

      const wrongNetwork = await service.processFireblocksWebhook(
        buildVerifiedDepositEvent({
          eventId: `wrong-network-${userId}`,
          providerTransactionId: `wrong-network-tx-${userId}`,
          txHash: `wrong-network-chain-${userId}`,
          amount: "2",
          network: "ETHEREUM",
        }),
      );
      assert.equal(wrongNetwork.deposit?.status, "manual_review");
      assert.equal(wrongNetwork.creditBlockedReason, "UNSUPPORTED_NETWORK");

      const wrongDestination = await service.processFireblocksWebhook(
        buildVerifiedDepositEvent({
          eventId: `wrong-destination-${userId}`,
          providerTransactionId: `wrong-destination-tx-${userId}`,
          txHash: `wrong-destination-chain-${userId}`,
          amount: "2",
          destinationAddress: "TInvalidDestination",
        }),
      );
      assert.equal(wrongDestination.deposit?.status, "manual_review");
      assert.equal(
        wrongDestination.creditBlockedReason,
        "INVALID_DESTINATION_ADDRESS",
      );

      await client.query(
        `update wallet_deposit_intents
         set status = 'expired'
         where user_id = $1 and status in ('waiting', 'detected')`,
        [userId],
      );
      currentTime = new Date(currentTime.getTime() + 1_000);
      await service.createDepositIntent({
        userId,
        expectedUsdtAtomic: "6000000",
      });
      const reviewOnly = await buildService(
        fixedRateProvider(clock),
        false,
      ).processFireblocksWebhook(
        buildVerifiedDepositEvent({
          eventId: `review-only-${userId}`,
          providerTransactionId: `review-only-tx-${userId}`,
          txHash: `review-only-chain-${userId}`,
          amount: "6",
        }),
      );
      assert.equal(reviewOnly.deposit?.status, "manual_review");
      assert.equal(
        reviewOnly.creditBlockedReason,
        "REAL_MONEY_LAUNCH_NOT_APPROVED",
      );

      const balance =
        await new PostgresCoinLedgerRepository(db).getBalance(userId);
      assert.equal(balance.availableCoinMicros, "5000000");
      const creditCount = await client.query<{ count: string }>(
        `select count(*)::text as count
         from coin_ledger_entries
         where user_id = $1 and operation_type = 'crypto_deposit_credit'`,
        [userId],
      );
      assert.equal(creditCount.rows[0]?.count, "1");
    });
  },
);

test(
  "provider-event payload conflicts preserve deposits already in reversal processing",
  { skip: skipReason },
  async () => {
    await withIsolatedCoinSchema(async (client, schemaName, pool) => {
      const userId = randomUUID();
      await insertTestUser(client, userId, `coin-reversal-conflict-${userId}@example.com`);
      await insertFireblocksWallet(client, userId);
      await activateCoinSystem(client);
      const clock = () => new Date("2026-07-25T12:00:00.000Z");
      const db = buildSchemaDatabase(pool, schemaName);
      const service = buildCoinWalletService({
        db,
        rateProvider: fixedRateProvider(clock),
        rateTtlSeconds: 60,
        requiredConfirmations: 10,
        usdtTronContract: USDT_TRON_CONTRACT,
        allowDepositCredits: true,
        now: clock,
      });

      await service.createDepositIntent({
        userId,
        expectedUsdtAtomic: "10000000",
      });
      const eventId = `deposit-reversal-conflict-${userId}`;
      const providerTransactionId = `fireblocks-reversal-conflict-${userId}`;
      const txHash = `chain-reversal-conflict-${userId}`;
      const credited = await service.processFireblocksWebhook(
        buildVerifiedDepositEvent({
          eventId,
          providerTransactionId,
          txHash,
          amount: "10",
        }),
      );
      assert.equal(credited.deposit?.status, "credited");

      for (const [status, amount] of [
        ["reversal_pending", "11"],
        ["reversing", "12"],
      ] as const) {
        await client.query(
          `update crypto_deposits
           set status = $1, updated_at = now()
           where id = $2`,
          [status, credited.deposit?.id],
        );
        const conflict = await service.processFireblocksWebhook(
          buildVerifiedDepositEvent({
            eventId,
            providerTransactionId,
            txHash,
            amount,
          }),
        );
        assert.equal(conflict.conflict, true);
        assert.equal(conflict.deposit?.status, status);
        assert.equal(
          conflict.creditBlockedReason,
          "PROVIDER_EVENT_ID_PAYLOAD_CONFLICT",
        );
      }
    });
  },
);

test(
  "deposit owner transaction rolls back provider evidence, rate, ledger, audit, and balance together",
  { skip: skipReason },
  async () => {
    await withIsolatedCoinSchema(async (client, schemaName, pool) => {
      const userId = randomUUID();
      await insertTestUser(client, userId, `coin-deposit-rollback-${userId}@example.com`);
      await insertFireblocksWallet(client, userId);
      await activateCoinSystem(client);
      const clock = () => new Date("2026-07-25T12:00:00.000Z");
      const db = buildSchemaDatabase(pool, schemaName, (_text, values) => {
        if (values?.[2] === "crypto_deposit.credited") {
          throw new Error("test outbox failure");
        }
      });
      const service = buildCoinWalletService({
        db,
        rateProvider: fixedRateProvider(clock),
        rateTtlSeconds: 60,
        requiredConfirmations: 10,
        usdtTronContract: USDT_TRON_CONTRACT,
        allowDepositCredits: true,
        now: clock,
      });
      await service.createDepositIntent({
        userId,
        expectedUsdtAtomic: "1000000",
      });

      await assert.rejects(
        () =>
          service.processFireblocksWebhook(
            buildVerifiedDepositEvent({
              eventId: `rollback-${userId}`,
              providerTransactionId: `rollback-tx-${userId}`,
              txHash: `rollback-chain-${userId}`,
              amount: "1",
            }),
          ),
        /test outbox failure/,
      );

      const counts = await client.query<{
        deposits: string;
        provider_events: string;
        rates: string;
        ledger_entries: string;
        accounts: string;
      }>(
        `select
           (select count(*) from crypto_deposits)::text as deposits,
           (select count(*) from money_provider_events)::text as provider_events,
           (select count(*) from exchange_rate_snapshots)::text as rates,
           (select count(*) from coin_ledger_entries)::text as ledger_entries,
           (select count(*) from coin_accounts)::text as accounts`,
      );
      assert.deepEqual(counts.rows[0], {
        deposits: "0",
        provider_events: "0",
        rates: "0",
        ledger_entries: "0",
        accounts: "0",
      });
    });
  },
);

test(
  "withdrawals quote, reserve, serialize concurrent debits, release safely, and reconcile verified provider outcomes",
  { skip: skipReason },
  async () => {
    await withIsolatedCoinSchema(async (client, schemaName, pool) => {
      const userId = randomUUID();
      await insertTestUser(client, userId, `coin-withdrawal-${userId}@example.com`);
      await activateCoinSystem(client);
      const clock = () => new Date("2026-07-25T12:00:00.000Z");
      const db = buildSchemaDatabase(pool, schemaName);
      const coins = new PostgresCoinLedgerRepository(db);
      await coins.postEntry({
        userId,
        operationType: "bonus_credit",
        availableDeltaCoinMicros: 200_000_000n,
        idempotencyKey: "withdrawal-test-funding",
        sourceType: "postgres_test",
        sourceId: userId,
        reason: "Fund withdrawal integration test",
      });
      const service = buildCoinWalletService({
        db,
        rateProvider: fixedRateProvider(clock),
        rateTtlSeconds: 60,
        requiredConfirmations: 10,
        usdtTronContract: USDT_TRON_CONTRACT,
        allowDepositCredits: false,
        withdrawalNetworkFeeUsdtAtomic: 1_000_000n,
        withdrawalProviderFeeUsdtAtomic: 500_000n,
        now: clock,
      });

      const quote = await service.createWithdrawalQuote({
        userId,
        destinationAddress: VALID_TRON_ADDRESS,
        coinAmountMicros: "20000000",
        idempotencyKey: "withdrawal-quote-main",
      });
      assert.equal(quote.estimatedUsdtAtomic, "18500000");
      assert.equal(quote.networkFeeUsdtAtomic, "1000000");
      assert.equal(quote.providerFeeUsdtAtomic, "500000");
      const confirmed = await service.confirmWithdrawal({
        userId,
        quoteId: quote.id,
        idempotencyKey: "withdrawal-main",
      });
      assert.equal(confirmed.withdrawalRequest.status, "pending_review");
      assert.equal(confirmed.balance.availableCoinMicros, "180000000");
      assert.equal(confirmed.balance.reservedCoinMicros, "20000000");
      const repeated = await service.confirmWithdrawal({
        userId,
        quoteId: quote.id,
        idempotencyKey: "withdrawal-main",
      });
      assert.equal(repeated.idempotent, true);

      const approved = await service.approveWithdrawalForReview({
        withdrawalId: confirmed.withdrawalRequest.id,
        adminActor: "finance-test",
        reason: "Verified manual review",
      });
      assert.equal(approved.broadcastAttempted, false);
      const repeatedApproval = await service.approveWithdrawalForReview({
        withdrawalId: confirmed.withdrawalRequest.id,
        adminActor: "finance-test",
        reason: "Verified manual review",
      });
      assert.equal(repeatedApproval.idempotent, true);
      const cancelled = await service.cancelWithdrawal({
        userId,
        withdrawalId: confirmed.withdrawalRequest.id,
        reason: "User cancelled before broadcast",
      });
      assert.equal(cancelled.withdrawalRequest.status, "cancelled");
      assert.equal(cancelled.balance.reservedCoinMicros, "0");
      const repeatedCancel = await service.cancelWithdrawal({
        userId,
        withdrawalId: confirmed.withdrawalRequest.id,
        reason: "User cancelled before broadcast",
      });
      assert.equal(repeatedCancel.idempotent, true);

      const competingQuotes = await Promise.all(
        ["a", "b"].map((suffix) =>
          service.createWithdrawalQuote({
            userId,
            destinationAddress: VALID_TRON_ADDRESS,
            coinAmountMicros: "140000000",
            idempotencyKey: `withdrawal-concurrent-quote-${suffix}`,
          }),
        ),
      );
      const competing = await Promise.allSettled(
        competingQuotes.map((item, index) =>
          service.confirmWithdrawal({
            userId,
            quoteId: item.id,
            idempotencyKey: `withdrawal-concurrent-${index}`,
          }),
        ),
      );
      assert.equal(
        competing.filter((result) => result.status === "fulfilled").length,
        1,
      );
      assert.equal(
        competing.filter(
          (result) =>
            result.status === "rejected" &&
            String(result.reason).includes("insufficient"),
        ).length,
        1,
      );
      const held = competing.find(
        (result): result is PromiseFulfilledResult<
          Awaited<ReturnType<typeof service.confirmWithdrawal>>
        > => result.status === "fulfilled",
      );
      assert.ok(held);
      await service.rejectWithdrawal({
        withdrawalId: held.value.withdrawalRequest.id,
        adminActor: "finance-test",
        reason: "Release competing reserve",
      });

      const failureQuote = await service.createWithdrawalQuote({
        userId,
        destinationAddress: VALID_TRON_ADDRESS,
        coinAmountMicros: "10000000",
        idempotencyKey: "withdrawal-failure-quote",
      });
      const failureRequest = await service.confirmWithdrawal({
        userId,
        quoteId: failureQuote.id,
        idempotencyKey: "withdrawal-failure",
      });
      const failed = await service.reconcileVerifiedWithdrawalOutcome({
        withdrawalId: failureRequest.withdrawalRequest.id,
        outcome: verifiedWithdrawalOutcome({
          state: "failed",
          evidenceHash: "b".repeat(64),
        }),
      });
      assert.equal(failed.withdrawalRequest.status, "failed");
      assert.equal(failed.withdrawalRequest.failureState, "PROVIDER_CONFIRMED_FAILED");
      assert.ok(failed.withdrawalRequest.releaseLedgerEntryId);
      assert.equal(failed.withdrawalRequest.fireblocksReference?.startsWith("fb-"), true);

      const unknownQuote = await service.createWithdrawalQuote({
        userId,
        destinationAddress: VALID_TRON_ADDRESS,
        coinAmountMicros: "10000000",
        idempotencyKey: "withdrawal-unknown-quote",
      });
      const unknownRequest = await service.confirmWithdrawal({
        userId,
        quoteId: unknownQuote.id,
        idempotencyKey: "withdrawal-unknown",
      });
      const unknown = await service.reconcileVerifiedWithdrawalOutcome({
        withdrawalId: unknownRequest.withdrawalRequest.id,
        outcome: verifiedWithdrawalOutcome({
          state: "unknown",
          evidenceHash: "c".repeat(64),
        }),
      });
      assert.equal(unknown.withdrawalRequest.failureState, "PROVIDER_STATE_UNKNOWN");
      assert.equal(unknown.withdrawalRequest.releaseLedgerEntryId, null);
      await assert.rejects(
        () =>
          service.rejectWithdrawal({
            withdrawalId: unknownRequest.withdrawalRequest.id,
            adminActor: "finance-test",
            reason: "Unknown provider state must keep the reserve locked",
          }),
        (error: unknown) =>
          error instanceof CoinWalletError &&
          error.code === "WITHDRAWAL_NOT_CANCELLABLE",
      );
      const confirmedFailureAfterUnknown =
        await service.reconcileVerifiedWithdrawalOutcome({
          withdrawalId: unknownRequest.withdrawalRequest.id,
          outcome: verifiedWithdrawalOutcome({
            state: "failed",
            providerReference: `fb-confirmed-failed-${userId}`,
            evidenceHash: "e".repeat(64),
          }),
        });
      assert.equal(
        confirmedFailureAfterUnknown.withdrawalRequest.failureState,
        "PROVIDER_CONFIRMED_FAILED",
      );
      assert.ok(
        confirmedFailureAfterUnknown.withdrawalRequest.releaseLedgerEntryId,
      );
      const rejectedAfterConfirmedFailure = await service.rejectWithdrawal({
        withdrawalId: unknownRequest.withdrawalRequest.id,
        adminActor: "finance-test",
        reason: "Provider conclusively confirmed no transfer",
      });
      assert.equal(
        rejectedAfterConfirmedFailure.withdrawalRequest.status,
        "rejected",
      );
      assert.equal(rejectedAfterConfirmedFailure.idempotent, false);

      const completedQuote = await service.createWithdrawalQuote({
        userId,
        destinationAddress: VALID_TRON_ADDRESS,
        coinAmountMicros: "10000000",
        idempotencyKey: "withdrawal-completed-quote",
      });
      const completedRequest = await service.confirmWithdrawal({
        userId,
        quoteId: completedQuote.id,
        idempotencyKey: "withdrawal-completed",
      });
      const completedOutcome = verifiedWithdrawalOutcome({
        state: "completed",
        providerReference: `fb-completed-${userId}`,
        transactionHash: `tron-completed-${userId}`,
        finalUsdtAtomic: "8500000",
        networkFeeUsdtAtomic: "1000000",
        providerFeeUsdtAtomic: "500000",
        evidenceHash: "d".repeat(64),
      });
      const completed = await service.reconcileVerifiedWithdrawalOutcome({
        withdrawalId: completedRequest.withdrawalRequest.id,
        outcome: completedOutcome,
      });
      assert.equal(completed.withdrawalRequest.status, "broadcasted");
      assert.equal(completed.withdrawalRequest.coinDebitedMicros, "10000000");
      assert.equal(completed.withdrawalRequest.finalUsdtAtomic, "8500000");
      assert.ok(completed.withdrawalRequest.finalLedgerEntryId);
      assert.ok(completed.withdrawalRequest.finalRateSnapshotId);
      const repeatedCompleted = await service.reconcileVerifiedWithdrawalOutcome({
        withdrawalId: completedRequest.withdrawalRequest.id,
        outcome: completedOutcome,
      });
      assert.equal(repeatedCompleted.idempotent, true);

      const finalBalance = await coins.getBalance(userId);
      assert.deepEqual(finalBalance, {
        userId,
        availableCoinMicros: "190000000",
        reservedCoinMicros: "0",
        totalCoinMicros: "190000000",
      });
      const debitCount = await client.query<{ count: string }>(
        `select count(*)::text as count
         from coin_ledger_entries
         where user_id = $1 and operation_type = 'withdrawal_debit'`,
        [userId],
      );
      assert.equal(debitCount.rows[0]?.count, "1");
    });
  },
);

test(
  "ambiguous trade execution keeps the Coin reserve locked and projection unreleased",
  { skip: skipReason },
  async () => {
    await withIsolatedCoinSchema(async (client, schemaName, pool) => {
      const userId = randomUUID();
      const marketId = `coin-ambiguous-market-${userId}`;
      await insertTestUser(client, userId, `coin-ambiguous-${userId}@example.com`);
      await activateCoinSystem(client);
      const db = buildSchemaDatabase(pool, schemaName);
      const coins = new PostgresCoinLedgerRepository(db);
      const portfolio = new PostgresPortfolioRepository(db);
      await coins.postEntry({
        userId,
        operationType: "bonus_credit",
        availableDeltaCoinMicros: 100_000_000n,
        idempotencyKey: "ambiguous-trade-test-funding",
        sourceType: "postgres_test",
        sourceId: userId,
        reason: "Fund ambiguous trade integration test",
      });
      const market = normalizeMarketDetail(
        marketFixture({
          id: marketId,
          outcomePrices: JSON.stringify(["0.5", "0.5"]),
          bestBid: 0.49,
          bestAsk: 0.51,
          lastTradePrice: 0.5,
        }),
      );
      const timeoutRuntime = {
        kind: "execution_venue",
        adapterId: "postgres-ambiguous-execution-test",
        provider: "polymarket",
        executesOrders: true,
        async executeOrder() {
          throw new Error("provider timeout with unknown execution state");
        },
      } as unknown as RealMoneyExecutionVenueRuntime;

      const result = await placeCoinTradingOrder({
        market,
        side: "yes",
        action: "buy",
        amountCoinMicros: "10000000",
        userId,
        tradingMode: realExecutionTestMode(),
        coinLedger: coins,
        portfolioRepository: portfolio,
        idempotencyKey: "coin-ambiguous-execution",
        realExecutionRuntime: timeoutRuntime,
        createdAt: "2026-07-25T12:00:00.000Z",
      });
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, "EXECUTION_RECONCILIATION_REQUIRED");
      }

      const order = await portfolio.findCoinTradeOrderByIdempotencyKey(
        userId,
        "coin-ambiguous-execution",
      );
      assert.equal(order?.status, "manual_review");
      assert.equal(order?.reservedCoinMicros, "10200000");
      assert.equal(order?.releasedCoinMicros, "0");
      assert.equal(order?.releaseLedgerEntryId, null);
      assert.deepEqual(await coins.getBalance(userId), {
        userId,
        availableCoinMicros: "89800000",
        reservedCoinMicros: "10200000",
        totalCoinMicros: "100000000",
      });

      const reconciliation = await runCoinReconciliation(client);
      assert.equal(
        reconciliation.status,
        "passed",
        JSON.stringify(reconciliation.discrepancies),
      );
    });
  },
);

test(
  "Postgres trading reserves Coins, releases partial/cancelled fills, and prevents double settlement",
  { skip: skipReason },
  async () => {
    await withIsolatedCoinSchema(async (client, schemaName, pool) => {
      const userId = randomUUID();
      const marketId = `coin-market-${userId}`;
      await insertTestUser(client, userId, `coin-trading-${userId}@example.com`);
      await activateCoinSystem(client);
      const db = buildSchemaDatabase(pool, schemaName);
      const coins = new PostgresCoinLedgerRepository(db);
      const portfolio = new PostgresPortfolioRepository(db);
      const settlements = new PostgresSettlementRepository(db);
      await coins.postEntry({
        userId,
        operationType: "bonus_credit",
        availableDeltaCoinMicros: 100_000_000n,
        idempotencyKey: "trading-test-funding",
        sourceType: "postgres_test",
        sourceId: userId,
        reason: "Fund trading integration test",
      });
      const market = normalizeMarketDetail(
        marketFixture({
          id: marketId,
          question: "Will the Coin integration test settle?",
          outcomePrices: JSON.stringify(["0.5", "0.5"]),
          bestBid: 0.49,
          bestAsk: 0.51,
          lastTradePrice: 0.5,
        }),
      );
      const tradingMode = realExecutionTestMode();
      let partialCalls = 0;
      const partialRuntime = {
        kind: "execution_venue",
        adapterId: "postgres-partial-fill-test",
        provider: "polymarket",
        executesOrders: true,
        async executeOrder() {
          partialCalls += 1;
          return {
            status: "partially_filled",
            providerOrderId: `provider-order-${userId}`,
            providerTradeId: `provider-trade-${userId}`,
            executedPrice: 0.5,
            executedShares: 10,
            executedAmount: 5,
            feeAmount: 0.1,
            settledAt: "2026-07-25T12:00:00.000Z",
            raw: { fixture: "partial-fill" },
          };
        },
      } as unknown as RealMoneyExecutionVenueRuntime;

      const partial = await placeCoinTradingOrder({
        market,
        side: "yes",
        action: "buy",
        amountCoinMicros: "10000000",
        userId,
        tradingMode,
        coinLedger: coins,
        portfolioRepository: portfolio,
        settlementRepository: settlements,
        idempotencyKey: "coin-partial-fill",
        realExecutionRuntime: partialRuntime,
        createdAt: "2026-07-25T11:59:59.000Z",
      });
      assert.equal(partial.ok, true, JSON.stringify(partial));
      if (!partial.ok) return;
      assert.equal(partial.orderStatus, "partially_filled");
      assert.equal(partial.trade.amountCoinMicros, "5000000");
      assert.equal(partial.trade.feeCoinMicros, "100000");
      assert.equal(partial.portfolio.wallet.availableCoinMicros, "94900000");
      assert.equal(partial.portfolio.wallet.reservedCoinMicros, "0");
      assert.equal(partial.portfolio.positions[0]?.yesShares, "10");

      const repeatedPartial = await placeCoinTradingOrder({
        market,
        side: "yes",
        action: "buy",
        amountCoinMicros: "10000000",
        userId,
        tradingMode,
        coinLedger: coins,
        portfolioRepository: portfolio,
        settlementRepository: settlements,
        idempotencyKey: "coin-partial-fill",
        realExecutionRuntime: partialRuntime,
        createdAt: "2026-07-25T11:59:59.000Z",
      });
      assert.equal(repeatedPartial.ok, true);
      if (repeatedPartial.ok) {
        assert.equal(repeatedPartial.idempotent, true);
      }
      assert.equal(partialCalls, 1);

      const cancelledRuntime = {
        kind: "execution_venue",
        adapterId: "postgres-cancelled-fill-test",
        provider: "polymarket",
        executesOrders: true,
        async executeOrder() {
          return {
            status: "cancelled",
            providerOrderId: `cancelled-order-${userId}`,
            executedPrice: 0,
            executedShares: 0,
            executedAmount: 0,
            feeAmount: 0,
            raw: { fixture: "cancelled" },
          };
        },
      } as unknown as RealMoneyExecutionVenueRuntime;
      const beforeCancelled = await coins.getBalance(userId);
      const cancelled = await placeCoinTradingOrder({
        market,
        side: "no",
        action: "buy",
        amountCoinMicros: "10000000",
        userId,
        tradingMode,
        coinLedger: coins,
        portfolioRepository: portfolio,
        settlementRepository: settlements,
        idempotencyKey: "coin-cancelled-fill",
        realExecutionRuntime: cancelledRuntime,
        createdAt: "2026-07-25T12:00:01.000Z",
      });
      assert.equal(cancelled.ok, false);
      if (!cancelled.ok) {
        assert.equal(cancelled.code, "TRADING_EXECUTION_REJECTED");
      }
      assert.deepEqual(await coins.getBalance(userId), beforeCancelled);
      const cancelledOrder = await portfolio.findCoinTradeOrderByIdempotencyKey(
        userId,
        "coin-cancelled-fill",
      );
      assert.equal(cancelledOrder?.status, "cancelled");
      assert.ok(cancelledOrder?.releaseLedgerEntryId);

      const settlementService = buildSettlementService({
        repository: settlements,
        portfolioRepository: portfolio,
        ledger: buildLedgerService(new MemoryLedgerRepository()),
        coinLedger: coins,
        audit: buildAuditService(new MemoryAuditLogRepository()),
        requireAtomicSettlementCommits: true,
      });
      await assert.rejects(
        () =>
          settlementService.resolveMarket({
            marketId,
            winningSide: "yes",
            adminUserId: null,
            adminActorId: "finance-postgres-test",
            idempotencyKey: "coin-resolution-without-provider-funding",
          }),
        (error: unknown) =>
          error instanceof SettlementError &&
          error.code === "SETTLEMENT_PROVIDER_FUNDING_UNVERIFIED",
      );
      assert.equal((await portfolio.getPositionsByUserId(userId)).length, 1);
      const blockedResolution = await client.query<{
        settlements: string;
        payout_credits: string;
      }>(
        `select
           (select count(*) from market_settlements
             where market_external_id = $1)::text as settlements,
           (select count(*) from coin_ledger_entries
             where operation_type = 'trade_settlement_credit'
               and source_type = 'market_settlement')::text as payout_credits`,
        [marketId],
      );
      assert.deepEqual(blockedResolution.rows[0], {
        settlements: "0",
        payout_credits: "0",
      });

      const settled = await settlementService.cancelMarket({
        marketId,
        adminUserId: null,
        adminActorId: "finance-postgres-test",
        idempotencyKey: "coin-settlement-once",
      });
      assert.equal(settled.idempotent, false);
      assert.equal(settled.settlement.totalPoolCoinMicros, "5000000");
      assert.equal(settled.settlement.platformFeeCoinMicros, "0");
      assert.equal(settled.balancing.payoutTotalCoinMicros, "5000000");
      assert.equal(settled.balancing.balanced, true);
      assert.ok(settled.payouts[0]?.coinLedgerEntryId);

      const repeatedSettlement = await settlementService.cancelMarket({
        marketId,
        adminUserId: null,
        adminActorId: "finance-postgres-test",
        idempotencyKey: "coin-settlement-once",
      });
      assert.equal(repeatedSettlement.idempotent, true);
      await assert.rejects(
        () =>
          settlementService.resolveMarket({
            marketId,
            winningSide: "yes",
            adminUserId: null,
            adminActorId: "finance-postgres-test",
            idempotencyKey: "coin-settlement-different-key",
          }),
        (error: unknown) =>
          error instanceof SettlementError &&
          error.code === "MARKET_ALREADY_SETTLED",
      );

      const finalBalance = await coins.getBalance(userId);
      assert.deepEqual(finalBalance, {
        userId,
        availableCoinMicros: "99900000",
        reservedCoinMicros: "0",
        totalCoinMicros: "99900000",
      });
      assert.equal((await portfolio.getPositionsByUserId(userId)).length, 0);
      const ledgerOperations = await coins.listEntries(userId, 100);
      assert.deepEqual(
        ledgerOperations
          .map((entry) => entry.operationType)
          .filter(
            (operation) =>
              operation.startsWith("trade") ||
              operation === "fee_debit" ||
              operation === "refund_credit",
          )
          .sort(),
        [
          "fee_debit",
          "trade_debit",
          "trade_release",
          "trade_release",
          "trade_reserve",
          "trade_reserve",
          "refund_credit",
        ].sort(),
      );

      const reconciliation = await runCoinReconciliation(client);
      assert.equal(
        reconciliation.status,
        "passed",
        JSON.stringify(reconciliation.discrepancies),
      );
    });
  },
);

test(
  "Coin trade finalization racing settlement cannot lose a newer position snapshot",
  { skip: skipReason },
  async () => {
    await withIsolatedCoinSchema(async (client, schemaName, pool) => {
      const userId = randomUUID();
      const marketId = `coin-settlement-race-${userId}`;
      const orderId = randomUUID();
      const orderKey = `coin-settlement-race-order-${userId}`;
      const positionId = randomUUID();
      await insertTestUser(
        client,
        userId,
        `coin-settlement-race-${userId}@example.com`,
      );
      await activateCoinSystem(client);

      const baseDb = buildSchemaDatabase(pool, schemaName);
      const coins = new PostgresCoinLedgerRepository(baseDb);
      await coins.postEntry({
        userId,
        operationType: "bonus_credit",
        availableDeltaCoinMicros: 10_000_000n,
        idempotencyKey: `settlement-race-funding-${userId}`,
        sourceType: "postgres_test",
        sourceId: userId,
        reason: "Fund settlement concurrency regression",
      });
      await coins.postEntry({
        userId,
        operationType: "correction_debit",
        availableDeltaCoinMicros: -1_000_000n,
        idempotencyKey: `settlement-race-existing-position-${userId}`,
        sourceType: "postgres_test",
        sourceId: positionId,
        reason: "Debit the existing position cost basis",
        adminActor: "postgres-test",
      });
      await client.query(
        `insert into positions (
           id, user_id, market_external_id, market_title, side, shares,
           total_cost, average_price, last_price, total_cost_coin_micros,
           average_price_nanos, last_price_nanos, opened_at, updated_at
         ) values (
           $1, $2, $3, 'Settlement race market', 'yes', 1,
           1, 1, 1, 1000000, 1000000000, 1000000000, now(), now()
         )`,
        [positionId, userId, marketId],
      );

      const portfolio = new PostgresPortfolioRepository(baseDb);
      await portfolio.reserveCoinTradeOrder!({
        order: {
          id: orderId,
          userId,
          marketId,
          marketTitle: "Settlement race market",
          side: "yes",
          action: "buy",
          clobTokenId: null,
          status: "execution_pending",
          requestedCoinMicros: "1000000",
          requestedShares: "1",
          quotePriceNanos: "1000000000",
          reservedCoinMicros: "1000000",
          filledCoinMicros: "0",
          feeCoinMicros: "0",
          releasedCoinMicros: "0",
          executedShares: null,
          executedPriceNanos: null,
          provider: "postgres-test",
          providerOrderId: null,
          providerTradeId: null,
          reserveLedgerEntryId: null,
          debitLedgerEntryId: null,
          feeLedgerEntryId: null,
          releaseLedgerEntryId: null,
          creditLedgerEntryId: null,
          idempotencyKey: orderKey,
          requestFingerprint: `settlement-race-fingerprint-${userId}`,
          lastError: null,
          metadata: { fixture: "settlement-race" },
          createdAt: "2026-07-25T12:00:00.000Z",
          updatedAt: "2026-07-25T12:00:00.000Z",
        },
        reserveEntry: {
          userId,
          operationType: "trade_reserve",
          availableDeltaCoinMicros: -1_000_000n,
          reservedDeltaCoinMicros: 1_000_000n,
          idempotencyKey: `trade:${orderId}:reserve`,
          sourceType: "trade_execution_order",
          sourceId: orderId,
          reason: "Reserve the racing fill",
        },
        outboxPayload: { fixture: "settlement-race" },
      });

      let signalFinalizeLock!: () => void;
      const finalizeLockRequested = new Promise<void>((resolve) => {
        signalFinalizeLock = resolve;
      });
      let signalSettlementLock!: () => void;
      const settlementLockRequested = new Promise<void>((resolve) => {
        signalSettlementLock = resolve;
      });
      const finalizationDb = buildSchemaDatabase(pool, schemaName, (text) => {
        if (text.includes("pg_advisory_xact_lock")) signalFinalizeLock();
      });
      const settlementDb = buildSchemaDatabase(pool, schemaName, (text) => {
        if (text.includes("pg_advisory_xact_lock")) signalSettlementLock();
      });
      const finalizingPortfolio = new PostgresPortfolioRepository(finalizationDb);
      const settlementRepository = new PostgresSettlementRepository(settlementDb);
      const settlementService = buildSettlementService({
        repository: settlementRepository,
        portfolioRepository: new PostgresPortfolioRepository(settlementDb),
        ledger: buildLedgerService(new MemoryLedgerRepository()),
        coinLedger: new PostgresCoinLedgerRepository(settlementDb),
        audit: buildAuditService(new MemoryAuditLogRepository()),
        requireAtomicSettlementCommits: true,
      });

      const blocker = await pool.connect();
      try {
        await setSearchPath(blocker, schemaName);
        await blocker.query("begin");
        await blocker.query(
          `select pg_advisory_xact_lock(
             hashtextextended('coin-market:' || $1::text, 0)
           )`,
          [marketId],
        );

        const finalized = finalizingPortfolio.finalizeCoinTradeOrder!({
          orderId,
          expectedUserId: userId,
          expectedIdempotencyKey: orderKey,
          terminalStatus: "filled",
          filledCoinMicros: 1_000_000n,
          feeCoinMicros: 0n,
          releasedCoinMicros: 0n,
          executedShares: "1",
          executedPriceNanos: 1_000_000_000n,
          provider: "postgres-test",
          providerOrderId: `settlement-race-provider-order-${userId}`,
          providerTradeId: `settlement-race-provider-trade-${userId}`,
          tradeDebitEntry: {
            userId,
            operationType: "trade_debit",
            availableDeltaCoinMicros: 0n,
            reservedDeltaCoinMicros: -1_000_000n,
            idempotencyKey: `trade:${orderId}:debit`,
            sourceType: "trade_execution_order",
            sourceId: orderId,
            reason: "Finalize the racing fill",
          },
          feeDebitEntry: null,
          tradeCreditEntry: null,
          releaseEntry: null,
          trade: {
            id: randomUUID(),
            userId,
            walletId: null,
            marketId,
            side: "yes",
            tradeType: "buy",
            amount: "1",
            price: "1",
            shares: "1",
            status: "filled",
            idempotencyKey: orderKey,
            metadata: { fixture: "settlement-race" },
            executionOrderId: orderId,
            amountCoinMicros: "1000000",
            feeCoinMicros: "0",
            realizedPnlCoinMicros: null,
            priceNanos: "1000000000",
            createdAt: "2026-07-25T12:00:01.000Z",
          },
          positions: [
            {
              id: positionId,
              userId,
              marketId,
              marketTitle: "Settlement race market",
              side: "yes",
              shares: "2",
              totalCost: "2",
              averagePrice: "1",
              lastPrice: "1",
              totalCostCoinMicros: "2000000",
              averagePriceNanos: "1000000000",
              lastPriceNanos: "1000000000",
              openedAt: "2026-07-25T11:59:00.000Z",
              updatedAt: "2026-07-25T12:00:01.000Z",
            },
          ],
          deletePositions: [],
          outboxPayload: { fixture: "settlement-race" },
        });
        await finalizeLockRequested;

        const settled = settlementService.cancelMarket({
          marketId,
          adminUserId: null,
          adminActorId: "finance-postgres-test",
          idempotencyKey: `settlement-race-cancel-${userId}`,
        });
        await settlementLockRequested;
        await blocker.query("commit");

        const [finalizationResult, settlementResult] =
          await Promise.all([finalized, settled]);
        assert.equal(finalizationResult.order.status, "filled");
        assert.equal(settlementResult.settlement.status, "cancelled");
        assert.equal(
          settlementResult.settlement.totalPoolCoinMicros,
          "2000000",
        );
        assert.equal(
          settlementResult.payouts[0]?.originalStakeCoinMicros,
          "2000000",
        );
        assert.equal(
          settlementResult.payouts[0]?.payoutCoinMicros,
          "2000000",
        );
      } finally {
        try {
          await blocker.query("rollback");
        } catch {
          // The blocker was already committed.
        }
        blocker.release();
      }

      assert.equal((await portfolio.getPositionsByUserId(userId)).length, 0);
      assert.deepEqual(await coins.getBalance(userId), {
        userId,
        availableCoinMicros: "10000000",
        reservedCoinMicros: "0",
        totalCoinMicros: "10000000",
      });
    });
  },
);

async function withIsolatedCoinSchema(
  callback: (
    client: PoolClient,
    schemaName: string,
    pool: PgPool,
  ) => Promise<void>,
) {
  assert.ok(postgresTestUrl);
  const pool = new Pool({
    connectionString: postgresTestUrl,
    ssl: ["1", "true", "yes", "on"].includes(
      (process.env.TEST_DATABASE_SSL ?? "").toLowerCase(),
    )
      ? { rejectUnauthorized: false }
      : false,
  });
  const client = await pool.connect();
  const schemaName = `coin_test_${randomUUID().replaceAll("-", "")}`;
  try {
    await client.query(`create schema ${quoteIdentifier(schemaName)}`);
    await setSearchPath(client, schemaName);
    for (const filename of migrations) {
      const sql = await readFile(join(process.cwd(), "migrations", filename), "utf8");
      await client.query(sql);
    }
    await callback(client, schemaName, pool);
  } finally {
    try {
      await client.query("rollback");
    } catch {
      // The callback may have committed its owner transaction.
    }
    await client.query("set search_path to public");
    await client.query(`drop schema ${quoteIdentifier(schemaName)} cascade`);
    client.release();
    await pool.end();
  }
}

async function setSearchPath(client: PoolClient, schemaName: string) {
  await client.query(
    `set search_path to ${quoteIdentifier(schemaName)}, public`,
  );
}

function quoteIdentifier(value: string) {
  assert.match(value, /^[a-z][a-z0-9_]+$/);
  return `"${value}"`;
}

function databaseForSchema(pool: PgPool, schemaName: string): Database {
  return {
    enabled: true,
    async query<T>(text: string, values?: readonly unknown[]) {
      const client = await pool.connect();
      try {
        await setSearchPath(client, schemaName);
        const result = await client.query(text, values ? [...values] : undefined);
        return { rows: result.rows as T[] };
      } finally {
        client.release();
      }
    },
    async transaction<T>(callback: (client: Queryable) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await setSearchPath(client, schemaName);
        const result = await callback({
          async query<TClient>(text: string, values?: readonly unknown[]) {
            const queryResult = await client.query(
              text,
              values ? [...values] : undefined,
            );
            return { rows: queryResult.rows as TClient[] };
          },
        });
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      // The isolated-schema harness owns the pool.
    },
  };
}

async function insertTestUser(client: PoolClient, userId: string, email: string) {
  await client.query(
    `insert into users (
       id, email, email_verified, display_name, password_hash, password_salt,
       role, created_at, updated_at
     ) values (
       $1, $2, false, 'Coin Postgres Test', 'test-hash', 'test-salt',
       'user', now(), now()
     )`,
    [userId, email],
  );
}

async function postCoinEntry(
  client: PoolClient,
  input: {
    userId: string;
    operationType: string;
    availableDelta: bigint;
    reservedDelta: bigint;
    idempotencyKey: string;
    sourceType: string;
    sourceId: string;
    reason: string;
    adminActor?: string;
  },
) {
  const result = await client.query<{ id: string }>(
    `select id from coin_post_ledger_entry(
       $1, $2, $3::bigint, $4::bigint, $5, $6, $7, $8,
       null, null, null, $9, '{}'::jsonb
     )`,
    [
      input.userId,
      input.operationType,
      input.availableDelta.toString(),
      input.reservedDelta.toString(),
      input.idempotencyKey,
      input.sourceType,
      input.sourceId,
      input.reason,
      input.adminActor ?? null,
    ],
  );
  const row = result.rows[0];
  assert.ok(row);
  return row;
}

function buildSchemaDatabase(
  pool: PgPool,
  schemaName: string,
  beforeQuery?: (text: string, values?: readonly unknown[]) => void,
): Database {
  const queryWithClient = async <T>(
    client: PoolClient,
    text: string,
    values?: readonly unknown[],
  ) => {
    beforeQuery?.(text, values);
    const result = await client.query(text, values ? [...values] : undefined);
    return { rows: result.rows as T[] };
  };

  return {
    enabled: true,
    async query<T>(text: string, values?: readonly unknown[]) {
      const client = await pool.connect();
      try {
        await setSearchPath(client, schemaName);
        return queryWithClient<T>(client, text, values);
      } finally {
        client.release();
      }
    },
    async transaction<T>(callback: (client: Queryable) => Promise<T>) {
      const client = await pool.connect();
      try {
        await setSearchPath(client, schemaName);
        await client.query("begin");
        const result = await callback({
          query: <TRow>(text: string, values?: readonly unknown[]) =>
            queryWithClient<TRow>(client, text, values),
        });
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      // The isolated-schema owner closes the shared test pool.
    },
  };
}

function fixedRateProvider(
  clock: () => Date,
  options: {
    rateNanos?: bigint;
    unavailable?: boolean;
    stale?: boolean;
  } = {},
): ExchangeRateProvider {
  return {
    providerName: "postgres-test-rate",
    async getUsdQuote(input) {
      if (options.unavailable) {
        throw new ExchangeRateError(
          "RATE_UNAVAILABLE",
          "Test exchange rate is unavailable.",
        );
      }
      const current = clock();
      const quotedAt = options.stale
        ? new Date(current.getTime() - 120_000)
        : current;
      const expiresAt = options.stale
        ? new Date(current.getTime() - 60_000)
        : new Date(current.getTime() + 60_000);
      const rate = usdRateNanos(options.rateNanos ?? 1_000_000_000n);
      return {
        asset: input.asset,
        network: input.network,
        amountUsdtAtomic: input.amountUsdtAtomic,
        usdRateNanos: rate,
        rateDecimal: formatAtomic(rate, 9),
        source: "postgres-test-rate",
        quotedAt: quotedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        kind:
          input.purpose === "withdrawal_indicative"
            ? "indicative"
            : "final",
        purpose: input.purpose,
      };
    },
  };
}

function buildVerifiedDepositEvent(input: {
  eventId: string;
  providerTransactionId: string;
  txHash: string;
  eventIndex?: string;
  destinationAddress?: string;
  tokenContract?: string;
  assetId?: string;
  network?: string;
  amount?: string;
  confirmations?: number;
  status?: string;
  eventType?: string;
}) {
  const eventType = input.eventType ?? "TRANSACTION_STATUS_UPDATED";
  return {
    verified: true as const,
    provider: "fireblocks" as const,
    signatureKid: "postgres-test-key",
    eventType,
    transactionId: input.providerTransactionId,
    payload: {
      eventId: input.eventId,
      eventType,
      data: {
        id: input.providerTransactionId,
        txHash: input.txHash,
        eventIndex: input.eventIndex ?? "0",
        destinationAddress: input.destinationAddress ?? VALID_TRON_ADDRESS,
        tokenContract: input.tokenContract ?? USDT_TRON_CONTRACT,
        assetId: input.assetId ?? "USDT_TRX",
        network: input.network ?? "TRON",
        amountInfo: { amount: input.amount ?? "10" },
        feeInfo: { networkFee: "0", serviceFee: "0" },
        numOfConfirmations: input.confirmations ?? 12,
        status: input.status ?? "COMPLETED",
      },
    },
  };
}

async function activateCoinSystem(client: PoolClient) {
  await client.query(
    `update money_system_state
     set active_system = 'coin', legacy_writes_enabled = false,
         migration_version = 'postgres-test-cutover',
         cutover_completed_at = now(), updated_at = now()
     where singleton = true`,
  );
}

async function insertFireblocksWallet(
  client: PoolClient,
  userId: string,
  walletId = randomUUID(),
) {
  await client.query(
    `insert into wallets (
       id, user_id, asset, network, balance, initial_balance, status,
       address, provider, created_at, updated_at
     ) values (
       $1, $2, 'USDT', 'TRON', 0, 0, 'active',
       $3, 'fireblocks', now(), now()
     )`,
    [walletId, userId, VALID_TRON_ADDRESS],
  );
  return walletId;
}

function verifiedWithdrawalOutcome(
  overrides: Partial<VerifiedWithdrawalProviderOutcome> = {},
): VerifiedWithdrawalProviderOutcome {
  return {
    verified: true,
    provider: "fireblocks",
    state: "failed",
    providerReference: `fb-${randomUUID()}`,
    evidenceHash: "a".repeat(64),
    observedAt: new Date("2026-07-25T12:00:10.000Z").toISOString(),
    ...overrides,
  };
}

function realExecutionTestMode(): TradingMode {
  return {
    ...LOCAL_SIMULATED_TRADING_MODE,
    mode: "real_money",
    warning: TRADING_MODE_REAL_MONEY_WARNING,
    realMoneyEnabled: true,
    simulated: false,
    localSimulationEnabled: false,
    localSimulationBlockReason: "LOCAL_SIMULATED_TRADING_APP_MODE_DISABLED",
    balance: {
      asset: "COIN",
      initialCoinMicros: "0",
      simulatedCreditEnabled: false,
    },
    orders: {
      simulatedExecutionEnabled: false,
      realExecutionEnabled: true,
      blockReason: null,
    },
    launchApproval: buildRealMoneyLaunchApprovalCapabilities({
      realMoneyLaunchApprovalRef: "docs/real-money-launch-approval.md",
      realMoneyLaunchApprovalArtifactApproved: true,
    }),
  };
}
