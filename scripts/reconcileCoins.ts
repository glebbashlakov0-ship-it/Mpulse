import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";
import type { Queryable } from "../src/db.js";
import { auditPostgresTestDatabaseSafety } from "../src/postgresTestDatabaseSafety.js";

type ReconciliationDiscrepancy = {
  category: string;
  entityType: string;
  entityId: string;
  userId: string | null;
  detail: Record<string, unknown>;
};

type ReconciliationCheck = {
  category: string;
  sql: string;
  values?: readonly unknown[];
};

type ReconciliationRow = {
  entity_type: string;
  entity_id: string;
  user_id: string | null;
  detail: Record<string, unknown> | null;
};

export type CoinReconciliationReport = {
  dryRun: true;
  status: "passed" | "failed";
  checkedAt: string;
  discrepancyCount: number;
  categoryCounts: Record<string, number>;
  totals: Record<string, string>;
  discrepancies: ReconciliationDiscrepancy[];
};

// Vercel Hobby Cron can invoke the bounded drain only once per day. The extra
// two hours prevent normal scheduler/startup jitter from becoming a false
// reconciliation incident.
export const OUTBOX_PENDING_FAILED_STALE_AFTER_MS = 26 * 60 * 60 * 1_000;
export const OUTBOX_PROCESSING_STALE_AFTER_MS = 15 * 60 * 1_000;

export const OUTBOX_DELIVERY_RECONCILIATION_SQL = `select
        'money_outbox_event'::text as entity_type,
        events.id::text as entity_id,
        null::text as user_id,
        jsonb_build_object(
          'aggregateType', events.aggregate_type,
          'aggregateId', events.aggregate_id,
          'eventType', events.event_type,
          'status', events.status,
          'attempts', events.attempts,
          'lastError', events.last_error,
          'availableAt', events.available_at,
          'lockedAt', events.locked_at,
          'lockedBy', events.locked_by,
          'deadLetteredAt', events.dead_lettered_at
        ) as detail
      from money_outbox_events events
      where events.status = 'dead_letter'
         or (
           events.status in ('pending', 'failed')
           and events.available_at
             < now() - ($1::bigint * interval '1 millisecond')
         )
         or (
           events.status = 'processing'
           and (
             events.locked_at is null
             or events.locked_at
               < now() - ($2::bigint * interval '1 millisecond')
           )
         )`;

const checks: ReconciliationCheck[] = [
  {
    category: "coin_cache_vs_ledger",
    sql: `select
            'coin_account'::text as entity_type,
            accounts.id::text as entity_id,
            accounts.user_id::text as user_id,
            jsonb_build_object(
              'cachedAvailableCoinMicros', accounts.available_coin_micros::text,
              'ledgerAvailableCoinMicros',
                coalesce(sum(entries.available_delta_coin_micros), 0)::bigint::text,
              'cachedReservedCoinMicros', accounts.reserved_coin_micros::text,
              'ledgerReservedCoinMicros',
                coalesce(sum(entries.reserved_delta_coin_micros), 0)::bigint::text
            ) as detail
          from coin_accounts accounts
          left join coin_ledger_entries entries on entries.account_id = accounts.id
          group by accounts.id, accounts.user_id, accounts.available_coin_micros,
                   accounts.reserved_coin_micros
          having accounts.available_coin_micros
                   <> coalesce(sum(entries.available_delta_coin_micros), 0)
              or accounts.reserved_coin_micros
                   <> coalesce(sum(entries.reserved_delta_coin_micros), 0)`,
  },
  {
    category: "coin_entry_running_balance",
    sql: `with running as (
            select entries.*,
              sum(available_delta_coin_micros) over (
                partition by account_id order by entry_sequence
              ) as expected_available,
              sum(reserved_delta_coin_micros) over (
                partition by account_id order by entry_sequence
              ) as expected_reserved
            from coin_ledger_entries entries
          )
          select
            'coin_ledger_entry'::text as entity_type,
            id::text as entity_id,
            user_id::text as user_id,
            jsonb_build_object(
              'storedAvailableAfterCoinMicros', available_after_coin_micros::text,
              'expectedAvailableAfterCoinMicros', expected_available::text,
              'storedReservedAfterCoinMicros', reserved_after_coin_micros::text,
              'expectedReservedAfterCoinMicros', expected_reserved::text
            ) as detail
          from running
          where available_after_coin_micros <> expected_available
             or reserved_after_coin_micros <> expected_reserved`,
  },
  {
    category: "legacy_writes_after_coin_cutover",
    sql: `with cutover as (
            select cutover_completed_at
            from money_system_state
            where singleton = true
              and active_system = 'coin'
              and legacy_writes_enabled = false
              and cutover_completed_at is not null
          )
          select
            'legacy_ledger_entry'::text as entity_type,
            entries.id::text as entity_id,
            entries.user_id::text as user_id,
            jsonb_build_object(
              'entryType', entries.entry_type,
              'asset', entries.asset,
              'amount', entries.amount::text,
              'createdAt', entries.created_at,
              'updatedAt', entries.updated_at,
              'cutoverCompletedAt', cutover.cutover_completed_at
            ) as detail
          from ledger_entries entries
          cross join cutover
          where greatest(entries.created_at, entries.updated_at)
            > cutover.cutover_completed_at

          union all

          select
            'legacy_wallet_deposit_event'::text,
            events.id::text,
            events.user_id::text,
            jsonb_build_object(
              'status', events.status,
              'amount', events.amount::text,
              'createdAt', events.created_at,
              'updatedAt', events.updated_at,
              'cutoverCompletedAt', cutover.cutover_completed_at
            )
          from wallet_deposit_events events
          cross join cutover
          where greatest(events.created_at, events.updated_at)
            > cutover.cutover_completed_at`,
  },
  {
    category: "deposit_ledger",
    sql: `select
            'crypto_deposit'::text as entity_type,
            deposits.id::text as entity_id,
            deposits.user_id::text as user_id,
            jsonb_build_object(
              'status', deposits.status,
              'creditedCoinMicros', deposits.credited_coin_micros::text,
              'ledgerEntryId', deposits.ledger_entry_id,
              'ledgerOperation', entries.operation_type,
              'ledgerAvailableDeltaCoinMicros',
                entries.available_delta_coin_micros::text,
              'rateSnapshotId', deposits.rate_snapshot_id
            ) as detail
          from crypto_deposits deposits
          left join coin_ledger_entries entries on entries.id = deposits.ledger_entry_id
          where deposits.status = 'credited'
            and (
              deposits.user_id is null
              or deposits.rate_snapshot_id is null
              or deposits.credited_coin_micros is null
              or deposits.ledger_entry_id is null
              or entries.id is null
              or entries.user_id is distinct from deposits.user_id
              or entries.operation_type <> 'crypto_deposit_credit'
              or entries.available_delta_coin_micros
                   is distinct from deposits.credited_coin_micros
              or entries.reserved_delta_coin_micros <> 0
              or entries.rate_snapshot_id is distinct from deposits.rate_snapshot_id
            )`,
  },
  {
    category: "deposit_rate_conversion",
    sql: `select
            'crypto_deposit'::text as entity_type,
            deposits.id::text as entity_id,
            deposits.user_id::text as user_id,
            jsonb_build_object(
              'netUsdtAtomic', deposits.net_usdt_atomic::text,
              'rateNanos', rates.rate_nanos::text,
              'creditedCoinMicros', deposits.credited_coin_micros::text,
              'expectedCoinMicros',
                trunc(deposits.net_usdt_atomic::numeric * rates.rate_nanos::numeric
                  / 1000000000)::bigint::text,
              'purpose', rates.purpose,
              'kind', rates.kind
            ) as detail
          from crypto_deposits deposits
          join exchange_rate_snapshots rates on rates.id = deposits.rate_snapshot_id
          where deposits.status = 'credited'
            and (
              deposits.credited_coin_micros is distinct from
                trunc(deposits.net_usdt_atomic::numeric * rates.rate_nanos::numeric
                  / 1000000000)::bigint
              or rates.purpose <> 'deposit_final'
              or rates.kind <> 'final'
            )`,
  },
  {
    category: "deposit_reversal",
    sql: `select
            'crypto_deposit'::text as entity_type,
            deposits.id::text as entity_id,
            deposits.user_id::text as user_id,
            jsonb_build_object(
              'status', deposits.status,
              'reversalLedgerEntryId', deposits.reversal_ledger_entry_id,
              'operationType', entries.operation_type,
              'availableDeltaCoinMicros', entries.available_delta_coin_micros::text
            ) as detail
          from crypto_deposits deposits
          left join coin_ledger_entries entries
            on entries.id = deposits.reversal_ledger_entry_id
          where deposits.status = 'reversed'
            and (
              entries.id is null
              or entries.operation_type <> 'reversed_deposit'
              or entries.available_delta_coin_micros
                   is distinct from -deposits.credited_coin_micros
              or entries.reserved_delta_coin_micros <> 0
            )`,
  },
  {
    category: "deposit_provider_record",
    sql: `select
            'crypto_deposit'::text as entity_type,
            deposits.id::text as entity_id,
            deposits.user_id::text as user_id,
            jsonb_build_object(
              'provider', deposits.provider,
              'providerEventId', deposits.provider_event_id,
              'lastProviderEventId', deposits.last_provider_event_id
            ) as detail
          from crypto_deposits deposits
          left join money_provider_events provider_events
            on provider_events.id = deposits.last_provider_event_id
          where deposits.status in (
              'credited', 'reversal_pending', 'reversing', 'reversed'
            )
            and (
              provider_events.id is null
              or provider_events.provider <> deposits.provider
            )`,
  },
  {
    category: "withdrawal_reserve",
    sql: `select
            'wallet_withdrawal_request'::text as entity_type,
            requests.id::text as entity_id,
            requests.user_id::text as user_id,
            jsonb_build_object(
              'status', requests.status,
              'coinReservedMicros', requests.coin_reserved_micros::text,
              'reserveLedgerEntryId', requests.reserve_ledger_entry_id,
              'reserveOperation', reserve_entry.operation_type,
              'reserveAvailableDeltaCoinMicros',
                reserve_entry.available_delta_coin_micros::text,
              'reserveReservedDeltaCoinMicros',
                reserve_entry.reserved_delta_coin_micros::text
            ) as detail
          from wallet_withdrawal_requests requests
          left join coin_ledger_entries reserve_entry
            on reserve_entry.id = requests.reserve_ledger_entry_id
          where coalesce(requests.coin_reserved_micros, 0) > 0
            and (
              reserve_entry.id is null
              or reserve_entry.operation_type <> 'withdrawal_reserve'
              or reserve_entry.available_delta_coin_micros
                   is distinct from -requests.coin_reserved_micros
              or reserve_entry.reserved_delta_coin_micros
                   is distinct from requests.coin_reserved_micros
            )`,
  },
  {
    category: "withdrawal_terminal",
    sql: `select
            'wallet_withdrawal_request'::text as entity_type,
            requests.id::text as entity_id,
            requests.user_id::text as user_id,
            jsonb_build_object(
              'status', requests.status,
              'coinReservedMicros', requests.coin_reserved_micros::text,
              'coinDebitedMicros', requests.coin_debited_micros::text,
              'releaseLedgerEntryId', requests.release_ledger_entry_id,
              'finalLedgerEntryId', requests.final_ledger_entry_id
            ) as detail
          from wallet_withdrawal_requests requests
          where (
              requests.status in ('rejected', 'cancelled')
              and coalesce(requests.coin_reserved_micros, 0) > 0
              and requests.release_ledger_entry_id is null
            )
            or (
              coalesce(requests.coin_debited_micros, 0) > 0
              and requests.final_ledger_entry_id is null
            )
            or (
              requests.release_ledger_entry_id is not null
              and requests.final_ledger_entry_id is not null
            )`,
  },
  {
    category: "trade_execution_accounting",
    sql: `select
            'trade_execution_order'::text as entity_type,
            orders.id::text as entity_id,
            orders.user_id::text as user_id,
            jsonb_build_object(
              'action', orders.action,
              'status', orders.status,
              'reservedCoinMicros', orders.reserved_coin_micros::text,
              'filledCoinMicros', orders.filled_coin_micros::text,
              'feeCoinMicros', orders.fee_coin_micros::text,
              'releasedCoinMicros', orders.released_coin_micros::text,
              'reserveLedgerEntryId', orders.reserve_ledger_entry_id,
              'debitLedgerEntryId', orders.debit_ledger_entry_id,
              'feeLedgerEntryId', orders.fee_ledger_entry_id,
              'releaseLedgerEntryId', orders.release_ledger_entry_id
            ) as detail
          from trade_execution_orders orders
          left join coin_ledger_entries reserve_entry
            on reserve_entry.id = orders.reserve_ledger_entry_id
          left join coin_ledger_entries debit_entry
            on debit_entry.id = orders.debit_ledger_entry_id
          left join coin_ledger_entries fee_entry
            on fee_entry.id = orders.fee_ledger_entry_id
          left join coin_ledger_entries release_entry
            on release_entry.id = orders.release_ledger_entry_id
          left join coin_ledger_entries credit_entry
            on credit_entry.id = orders.credit_ledger_entry_id
          where (
              orders.action = 'buy'
              and orders.reserved_coin_micros > 0
              and (
                reserve_entry.id is null
                or reserve_entry.user_id is distinct from orders.user_id
                or reserve_entry.operation_type <> 'trade_reserve'
                or reserve_entry.available_delta_coin_micros
                     is distinct from -orders.reserved_coin_micros
                or reserve_entry.reserved_delta_coin_micros
                     is distinct from orders.reserved_coin_micros
                or reserve_entry.source_type <> 'trade_execution_order'
                or reserve_entry.source_id <> orders.id::text
              )
            )
            or (
              orders.action = 'buy'
              and orders.status in (
                'partially_filled', 'filled', 'cancelled', 'failed'
              )
              and orders.filled_coin_micros + orders.fee_coin_micros
                    + orders.released_coin_micros
                  <> orders.reserved_coin_micros
            )
            or (
              orders.action = 'buy'
              and orders.filled_coin_micros > 0
              and (
                debit_entry.id is null
                or debit_entry.user_id is distinct from orders.user_id
                or debit_entry.operation_type <> 'trade_debit'
                or debit_entry.available_delta_coin_micros <> 0
                or debit_entry.reserved_delta_coin_micros
                     is distinct from -orders.filled_coin_micros
                or debit_entry.source_type <> 'trade_execution_order'
                or debit_entry.source_id <> orders.id::text
              )
            )
            or (
              orders.action = 'sell'
              and orders.filled_coin_micros > 0
              and (
                credit_entry.id is null
                or credit_entry.user_id is distinct from orders.user_id
                or credit_entry.operation_type <> 'trade_settlement_credit'
                or credit_entry.available_delta_coin_micros
                     is distinct from orders.filled_coin_micros
                or credit_entry.reserved_delta_coin_micros <> 0
                or credit_entry.source_type <> 'trade_execution_order'
                or credit_entry.source_id <> orders.id::text
              )
            )
            or (
              orders.fee_coin_micros > 0
              and (
                fee_entry.id is null
                or fee_entry.user_id is distinct from orders.user_id
                or fee_entry.operation_type <> 'fee_debit'
                or fee_entry.available_delta_coin_micros is distinct from
                  case when orders.action = 'sell'
                    then -orders.fee_coin_micros else 0 end
                or fee_entry.reserved_delta_coin_micros is distinct from
                  case when orders.action = 'buy'
                    then -orders.fee_coin_micros else 0 end
                or fee_entry.source_type <> 'trade_execution_order'
                or fee_entry.source_id <> orders.id::text
              )
            )
            or (
              orders.released_coin_micros > 0
              and (
                release_entry.id is null
                or release_entry.user_id is distinct from orders.user_id
                or release_entry.operation_type <> 'trade_release'
                or release_entry.available_delta_coin_micros
                     is distinct from orders.released_coin_micros
                or release_entry.reserved_delta_coin_micros
                     is distinct from -orders.released_coin_micros
                or release_entry.source_type <> 'trade_execution_order'
                or release_entry.source_id <> orders.id::text
              )
            )
            or (
              orders.action = 'sell'
              and (
                orders.reserve_ledger_entry_id is not null
                or orders.debit_ledger_entry_id is not null
                or orders.release_ledger_entry_id is not null
              )
            )
            or (
              orders.action = 'buy'
              and orders.credit_ledger_entry_id is not null
            )
            or (
              orders.filled_coin_micros = 0
              and (
                orders.debit_ledger_entry_id is not null
                or orders.credit_ledger_entry_id is not null
              )
            )
            or (
              orders.fee_coin_micros = 0
              and orders.fee_ledger_entry_id is not null
            )
            or (
              orders.released_coin_micros = 0
              and orders.release_ledger_entry_id is not null
            )
            or (
              orders.action = 'sell'
              and orders.fee_coin_micros > orders.filled_coin_micros
            )
            or exists (
              select 1
              from coin_ledger_entries source_entries
              where source_entries.source_type = 'trade_execution_order'
                and source_entries.source_id = orders.id::text
                and source_entries.operation_type in (
                  'trade_reserve', 'trade_debit', 'trade_release',
                  'trade_settlement_credit', 'fee_debit'
                )
                and not (
                  source_entries.id is not distinct from orders.reserve_ledger_entry_id
                  or source_entries.id is not distinct from orders.debit_ledger_entry_id
                  or source_entries.id is not distinct from orders.release_ledger_entry_id
                  or source_entries.id is not distinct from orders.credit_ledger_entry_id
                  or source_entries.id is not distinct from orders.fee_ledger_entry_id
                )
            )`,
  },
  {
    category: "trade_projection",
    sql: `select
            'trade_execution_order'::text as entity_type,
            orders.id::text as entity_id,
            orders.user_id::text as user_id,
            jsonb_build_object(
              'orderStatus', orders.status,
              'tradeId', trades.id,
              'executionOrderId', orders.id,
              'amountCoinMicros', trades.amount_coin_micros::text,
              'expectedAmountCoinMicros', orders.filled_coin_micros::text,
              'feeCoinMicros', trades.fee_coin_micros::text,
              'expectedFeeCoinMicros', orders.fee_coin_micros::text,
              'priceNanos', trades.price_nanos::text,
              'expectedPriceNanos', orders.executed_price_nanos::text
            ) as detail
          from trade_execution_orders orders
          left join trades on trades.execution_order_id = orders.id
          where (
              orders.status in ('filled', 'partially_filled')
              and (
                trades.id is null
                or trades.user_id is distinct from orders.user_id
                or trades.market_external_id <> orders.market_external_id
                or trades.side <> orders.side
                or trades.trade_type <> orders.action
                or trades.status <> 'filled'
                or trades.amount_coin_micros
                     is distinct from orders.filled_coin_micros
                or trades.fee_coin_micros
                     is distinct from orders.fee_coin_micros
                or trades.price_nanos
                     is distinct from orders.executed_price_nanos
                or trades.shares is distinct from orders.executed_shares
                or trunc(trades.amount * 1000000)
                     is distinct from orders.filled_coin_micros::numeric
                or trunc(trades.price * 1000000000)
                     is distinct from orders.executed_price_nanos::numeric
                or (
                  orders.action = 'buy'
                  and trades.realized_pnl_coin_micros is not null
                )
                or (
                  orders.action = 'sell'
                  and trades.realized_pnl_coin_micros is null
                )
              )
            )
            or (
              orders.status in ('cancelled', 'failed')
              and trades.id is not null
            )`,
  },
  {
    category: "settlement_payout",
    sql: `select
            'market_settlement_payout'::text as entity_type,
            payouts.id::text as entity_id,
            payouts.user_id::text as user_id,
            jsonb_build_object(
              'kind', payouts.kind,
              'payoutCoinMicros', payouts.payout_coin_micros::text,
              'coinLedgerEntryId', payouts.coin_ledger_entry_id,
              'ledgerOperation', entries.operation_type,
              'ledgerAvailableDeltaCoinMicros',
                entries.available_delta_coin_micros::text
            ) as detail
          from market_settlement_payouts payouts
          left join coin_ledger_entries entries
            on entries.id = payouts.coin_ledger_entry_id
          where payouts.payout_coin_micros > 0
            and payouts.coin_migration_version is null
            and (
              entries.id is null
              or entries.user_id is distinct from payouts.user_id
              or entries.operation_type not in ('trade_settlement_credit', 'refund_credit')
              or entries.available_delta_coin_micros
                   is distinct from payouts.payout_coin_micros
              or entries.reserved_delta_coin_micros <> 0
            )`,
  },
  {
    category: "legacy_projection_conversion",
    sql: `select *
          from (
            select
              'trade'::text as entity_type,
              trades.id::text as entity_id,
              trades.user_id::text as user_id,
              jsonb_build_object(
                'amountCoinMicros', trades.amount_coin_micros::text,
                'expectedAmountCoinMicros',
                  trunc(trades.amount * 1000000)::bigint::text,
                'priceNanos', trades.price_nanos::text,
                'expectedPriceNanos',
                  trunc(trades.price * 1000000000)::bigint::text
              ) as detail
            from trades
            where trades.coin_migration_version is not null
              and (
                trades.amount_coin_micros
                  <> trunc(trades.amount * 1000000)::bigint
                or trades.price_nanos
                  is distinct from trunc(trades.price * 1000000000)::bigint
              )

            union all

            select
              'position'::text,
              positions.id::text,
              positions.user_id::text,
              jsonb_build_object(
                'totalCostCoinMicros', positions.total_cost_coin_micros::text,
                'expectedTotalCostCoinMicros',
                  trunc(positions.total_cost * 1000000)::bigint::text
              )
            from positions
            where positions.coin_migration_version is not null
              and positions.total_cost_coin_micros
                <> trunc(positions.total_cost * 1000000)::bigint

            union all

            select
              'market_settlement_payout'::text,
              payouts.id::text,
              payouts.user_id::text,
              jsonb_build_object(
                'payoutCoinMicros', payouts.payout_coin_micros::text,
                'expectedPayoutCoinMicros',
                  trunc(payouts.payout * 1000000)::bigint::text
              )
            from market_settlement_payouts payouts
            where payouts.coin_migration_version is not null
              and payouts.payout_coin_micros
                <> trunc(payouts.payout * 1000000)::bigint
          ) projection_drift`,
  },
  {
    category: "settlement_totals",
    sql: `select
            'market_settlement'::text as entity_type,
            settlements.id::text as entity_id,
            null::text as user_id,
            jsonb_build_object(
              'payoutTotalCoinMicros',
                coalesce(sum(payouts.payout_coin_micros), 0)::bigint::text,
              'distributablePoolCoinMicros',
                settlements.distributable_pool_coin_micros::text,
              'status', settlements.status
            ) as detail
          from market_settlements settlements
          left join market_settlement_payouts payouts
            on payouts.settlement_id = settlements.id
          group by settlements.id
          having coalesce(sum(payouts.payout_coin_micros), 0)
            <> settlements.distributable_pool_coin_micros`,
  },
  {
    category: "fee_entries",
    sql: `select
            'coin_ledger_entry'::text as entity_type,
            entries.id::text as entity_id,
            entries.user_id::text as user_id,
            jsonb_build_object(
              'operationType', entries.operation_type,
              'availableDeltaCoinMicros', entries.available_delta_coin_micros::text,
              'reservedDeltaCoinMicros', entries.reserved_delta_coin_micros::text,
              'sourceType', entries.source_type,
              'sourceId', entries.source_id
            ) as detail
          from coin_ledger_entries entries
          where entries.operation_type = 'fee_debit'
            and (
              entries.available_delta_coin_micros
                + entries.reserved_delta_coin_micros >= 0
              or entries.source_id is null
            )`,
  },
  {
    category: "migration_marker",
    sql: `select
            'coin_migration_marker'::text as entity_type,
            markers.user_id::text || ':' || markers.migration_version as entity_id,
            markers.user_id::text as user_id,
            jsonb_build_object(
              'migratedAvailableCoinMicros',
                markers.migrated_available_coin_micros::text,
              'migratedReservedCoinMicros',
                markers.migrated_reserved_coin_micros::text,
              'ledgerEntryId', markers.ledger_entry_id,
              'ledgerAvailableDeltaCoinMicros',
                entries.available_delta_coin_micros::text,
              'ledgerReservedDeltaCoinMicros',
                entries.reserved_delta_coin_micros::text
            ) as detail
          from coin_migration_markers markers
          left join coin_ledger_entries entries on entries.id = markers.ledger_entry_id
          where (
              markers.migrated_available_coin_micros <> 0
              or markers.migrated_reserved_coin_micros <> 0
            )
            and (
              entries.id is null
              or entries.operation_type <> 'migration_credit'
              or entries.available_delta_coin_micros
                   is distinct from markers.migrated_available_coin_micros
              or entries.reserved_delta_coin_micros
                   is distinct from markers.migrated_reserved_coin_micros
            )`,
  },
  {
    category: "cutover_totals",
    sql: `select
            'coin_cutover_run'::text as entity_type,
            runs.id::text as entity_id,
            null::text as user_id,
            jsonb_build_object(
              'migrationVersion', runs.migration_version,
              'recordedAfterAvailableCoinMicros',
                runs.after_available_coin_micros::text,
              'currentMigrationAvailableCoinMicros',
                coalesce(sum(markers.migrated_available_coin_micros), 0)::bigint::text,
              'recordedAfterReservedCoinMicros',
                runs.after_reserved_coin_micros::text,
              'currentMigrationReservedCoinMicros',
                coalesce(sum(markers.migrated_reserved_coin_micros), 0)::bigint::text
            ) as detail
          from coin_cutover_runs runs
          left join coin_migration_markers markers
            on markers.migration_version = runs.migration_version
          group by runs.id
          having runs.after_available_coin_micros - runs.before_available_coin_micros
                   <> coalesce(sum(markers.migrated_available_coin_micros), 0)
              or runs.after_reserved_coin_micros - runs.before_reserved_coin_micros
                   <> coalesce(sum(markers.migrated_reserved_coin_micros), 0)`,
  },
  {
    category: "outbox_delivery",
    sql: OUTBOX_DELIVERY_RECONCILIATION_SQL,
    values: [
      OUTBOX_PENDING_FAILED_STALE_AFTER_MS,
      OUTBOX_PROCESSING_STALE_AFTER_MS,
    ],
  },
];

export async function runCoinReconciliation(
  db: Queryable,
  now = new Date(),
  options: { excludedCategories?: readonly string[] } = {},
): Promise<CoinReconciliationReport> {
  const discrepancies: ReconciliationDiscrepancy[] = [];
  const categoryCounts: Record<string, number> = {};
  const excludedCategories = new Set(options.excludedCategories ?? []);

  for (const check of checks) {
    if (excludedCategories.has(check.category)) {
      continue;
    }
    const result = await db.query<ReconciliationRow>(check.sql, check.values);
    categoryCounts[check.category] = result.rows.length;
    for (const row of result.rows) {
      discrepancies.push({
        category: check.category,
        entityType: row.entity_type,
        entityId: row.entity_id,
        userId: row.user_id,
        detail: row.detail ?? {},
      });
    }
  }

  const totalsResult = await db.query<{
    account_count: string;
    available_coin_micros: string;
    reserved_coin_micros: string;
    ledger_entry_count: string;
    credited_deposit_count: string;
    open_withdrawal_count: string;
    open_trade_order_count: string;
  }>(
    `select
       (select count(*) from coin_accounts)::text as account_count,
       (select coalesce(sum(available_coin_micros), 0) from coin_accounts)::text
         as available_coin_micros,
       (select coalesce(sum(reserved_coin_micros), 0) from coin_accounts)::text
         as reserved_coin_micros,
       (select count(*) from coin_ledger_entries)::text as ledger_entry_count,
       (select count(*) from crypto_deposits where status = 'credited')::text
         as credited_deposit_count,
       (select count(*) from wallet_withdrawal_requests
          where status in ('pending_review', 'approved_for_review'))::text
         as open_withdrawal_count,
       (select count(*) from trade_execution_orders
          where status in ('reserved', 'execution_pending', 'partially_filled',
            'manual_review'))::text as open_trade_order_count`,
  );
  const totalsRow = totalsResult.rows[0];
  const report: CoinReconciliationReport = {
    dryRun: true,
    status: discrepancies.length === 0 ? "passed" : "failed",
    checkedAt: now.toISOString(),
    discrepancyCount: discrepancies.length,
    categoryCounts,
    totals: {
      accountCount: totalsRow?.account_count ?? "0",
      availableCoinMicros: totalsRow?.available_coin_micros ?? "0",
      reservedCoinMicros: totalsRow?.reserved_coin_micros ?? "0",
      ledgerEntryCount: totalsRow?.ledger_entry_count ?? "0",
      creditedDepositCount: totalsRow?.credited_deposit_count ?? "0",
      openWithdrawalCount: totalsRow?.open_withdrawal_count ?? "0",
      openTradeOrderCount: totalsRow?.open_trade_order_count ?? "0",
    },
    discrepancies,
  };
  return report;
}

export async function persistCoinReconciliationReport(
  client: PoolClient,
  report: CoinReconciliationReport,
) {
  await client.query("begin");
  try {
    const runId = await persistCoinReconciliationReportInTransaction(
      client,
      report,
    );
    await client.query("commit");
    return runId;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

export async function persistCoinReconciliationReportInTransaction(
  client: PoolClient,
  report: CoinReconciliationReport,
) {
  const run = await client.query<{ id: string }>(
    `insert into money_reconciliation_runs (
       status, dry_run, discrepancy_count, report, completed_at
     ) values ($1, true, $2, $3::jsonb, now())
     returning id`,
    [report.status, report.discrepancyCount, JSON.stringify(report)],
  );
  const runId = run.rows[0]?.id ?? null;
  await client.query(
    `insert into audit_logs (
       id, event_type, user_id, session_id, metadata, created_at, updated_at
     ) values ($1, $2, null, null, $3::jsonb, now(), now())`,
    [
      randomUUID(),
      `money.reconciliation.${report.status}`,
      JSON.stringify({
        reconciliationRunId: runId,
        discrepancyCount: report.discrepancyCount,
        dryRun: true,
      }),
    ],
  );
  return runId;
}

async function main() {
  const safety = auditPostgresTestDatabaseSafety(process.env);
  if (!safety.ok) {
    throw new Error(
      `Unsafe TEST_DATABASE_URL: ${safety.issues.map((issue) => issue.message).join("; ")}`,
    );
  }
  const testDatabaseUrl = process.env.TEST_DATABASE_URL!.trim();

  const pool = new Pool({
    connectionString: testDatabaseUrl,
    ssl: booleanFromEnv("TEST_DATABASE_SSL")
      ? { rejectUnauthorized: false }
      : false,
  });

  try {
    const report = await runCoinReconciliation(pool);
    const client = await pool.connect();
    try {
      await persistCoinReconciliationReport(client, report);
    } finally {
      client.release();
    }
    console.log(JSON.stringify(report, null, 2));
    if (report.discrepancyCount > 0) {
      process.exitCode = 2;
    }
  } finally {
    await pool.end();
  }
}

function booleanFromEnv(name: string) {
  return ["1", "true", "yes", "on"].includes(
    (process.env[name] ?? "").trim().toLowerCase(),
  );
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await main();
}
