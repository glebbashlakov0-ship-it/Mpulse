import { randomUUID } from "node:crypto";
import type { Queryable } from "./db.js";
import { toIsoString } from "./utils.js";

export type AuditEventType =
  | "auth.register"
  | "auth.login"
  | "auth.logout"
  | "auth.email_verified"
  | "auth.email_verification_requested"
  | "auth.password_reset_requested"
  | "auth.password_reset"
  | "auth.session_revoked"
  | "auth.sessions_revoked"
  | "auth.sessions_revoked_all"
  | "auth.two_factor_setup_started"
  | "auth.two_factor_enabled"
  | "auth.two_factor_disabled"
  | "auth.two_factor_backup_codes_regenerated"
  | "user.settings_update"
  | "trading.quote"
  | "trading.buy_local"
  | "trading.sell_local"
  | "trading.buy_real"
  | "trading.sell_real"
  | "trading.rejected"
  | "market.comment_created"
  | "market.settled"
  | "market.cancelled"
  | "ledger.ledger_credit"
  | "ledger.rejected"
  | "compliance.profile_update"
  | "compliance.legal_consents_accept"
  | "compliance.eligibility_check"
  | "wallet.created"
  | "wallet.deposit_intent_created"
  | "wallet.deposit_detected"
  | "wallet.deposit_confirmed"
  | "wallet.deposit_credited"
  | "wallet.deposit_rejected"
  | "wallet.withdrawal_request_created"
  | "wallet.withdrawal_broadcasted"
  | "wallet.webhook_local_received"
  | "wallet.rejected"
  | "admin.user_view"
  | "admin.audit_view"
  | "admin.login"
  | "admin.logout"
  | "admin.deposit_request_view"
  | "admin.deposit_request_approved"
  | "admin.deposit_request_rejected"
  | "admin.withdrawal_review"
  | "admin.market_hide"
  | "admin.market_unhide"
  | "admin.market_seed_odds"
  | "admin.market_odds_override"
  | "admin.ledger_seed_activity"
  | "admin.event_activity_seed"
  | "admin.event_activity_history_repair"
  | "admin.rejected";

export type AuditEvent = {
  id: string;
  eventType: AuditEventType;
  userId: string | null;
  sessionId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type AuditLogRepository = {
  record(event: AuditEvent): Promise<void>;
  listRecent(limit?: number): Promise<AuditEvent[]>;
};

export class MemoryAuditLogRepository implements AuditLogRepository {
  private readonly events: AuditEvent[] = [];

  async record(event: AuditEvent) {
    this.events.unshift(event);
    this.events.splice(500);
  }

  async listRecent(limit = 100) {
    return this.events.slice(0, limit);
  }
}

type AuditLogRow = {
  id: string;
  event_type: AuditEventType;
  user_id: string | null;
  session_id: string | null;
  metadata: Record<string, unknown>;
  created_at: Date | string;
};

export class PostgresAuditLogRepository implements AuditLogRepository {
  constructor(private readonly db: Queryable) {}

  async record(event: AuditEvent) {
    await this.db.query(
      `insert into audit_logs (id, event_type, user_id, session_id, metadata, created_at)
       values ($1, $2, $3, $4, $5::jsonb, $6)`,
      [
        event.id,
        event.eventType,
        event.userId,
        event.sessionId,
        JSON.stringify(event.metadata),
        event.createdAt,
      ],
    );
  }

  async listRecent(limit = 100) {
    const result = await this.db.query<AuditLogRow>(
      `select id, event_type, user_id, session_id, metadata, created_at
       from audit_logs
       order by created_at desc
       limit $1`,
      [limit],
    );

    return result.rows.map((row) => ({
      id: row.id,
      eventType: row.event_type,
      userId: row.user_id,
      sessionId: row.session_id,
      metadata: row.metadata ?? {},
      createdAt: toIsoString(row.created_at),
    }));
  }
}

export function buildAuditService(repository: AuditLogRepository) {
  async function record(input: {
    eventType: AuditEventType;
    userId?: string | null;
    sessionId?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    await repository.record({
      id: randomUUID(),
      eventType: input.eventType,
      userId: input.userId ?? null,
      sessionId: input.sessionId ?? null,
      metadata: input.metadata ?? {},
      createdAt: new Date().toISOString(),
    });
  }

  return {
    record,
    repository,
  };
}

export type AuditService = ReturnType<typeof buildAuditService>;
