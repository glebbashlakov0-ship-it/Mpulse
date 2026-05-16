import { AuthError, defaultUserSettings, normalizeEmail } from "./auth.js";
import type {
  AuthRepositories,
  AuthSession,
  AuthUser,
  SessionRepository,
  UserRepository,
  UserSettings,
} from "./auth.js";
import type { Queryable } from "./db.js";
import { toIsoString } from "./utils.js";

type UserRow = {
  id: string;
  email: string;
  email_verified: boolean;
  display_name: string;
  role: "user" | "support" | "compliance_admin" | "finance_admin" | "super_admin" | null;
  password_hash: string;
  password_salt: string;
  language: "en" | "ar" | null;
  currency: "USDT" | null;
  country: string | null;
  email_notifications: boolean | null;
  market_notifications: boolean | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type SessionRow = {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: Date | string;
  expires_at: Date | string;
  last_seen_at: Date | string;
  ip_address: string | null;
  user_agent: string | null;
};

export class PostgresUserRepository implements UserRepository {
  constructor(private readonly db: Queryable) {}

  async createUser(user: AuthUser) {
    try {
      const result = await this.db.query<UserRow>(
        `with inserted_user as (
           insert into users (
             id, email, email_verified, display_name, role, password_hash, password_salt,
             created_at, updated_at
           )
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           returning *
         ),
         inserted_settings as (
           insert into user_settings (
             user_id, language, currency, country, email_notifications, market_notifications,
             created_at, updated_at
           )
           values ($1, $10, $11, $12, $13, $14, $8, $9)
           returning *
         )
         select
           u.id, u.email, u.email_verified, u.display_name, u.role, u.password_hash, u.password_salt,
           s.language, s.currency, s.country, s.email_notifications, s.market_notifications,
           u.created_at, u.updated_at
         from inserted_user u
         join inserted_settings s on s.user_id = u.id`,
        [
          user.id,
          user.email,
          user.emailVerified,
          user.displayName,
          user.role,
          user.passwordHash,
          user.passwordSalt,
          user.createdAt,
          user.updatedAt,
          user.settings.language,
          user.settings.currency,
          user.settings.country,
          user.settings.emailNotifications,
          user.settings.marketNotifications,
        ],
      );

      const row = result.rows[0];
      if (!row) {
        throw new Error("User insert returned no row.");
      }

      return mapUser(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AuthError("EMAIL_ALREADY_REGISTERED", "Email is already registered.", 409);
      }
      throw error;
    }
  }

  async findUserByEmail(email: string) {
    return this.findOne(`where u.email = $1`, [normalizeEmail(email)]);
  }

  async findUserById(id: string) {
    return this.findOne(`where u.id = $1`, [id]);
  }

  async listUsers(limit = 100) {
    const result = await this.db.query<UserRow>(
      `select
         u.id, u.email, u.email_verified, u.display_name, u.role, u.password_hash, u.password_salt,
         s.language, s.currency, s.country, s.email_notifications, s.market_notifications,
         u.created_at, u.updated_at
       from users u
       left join user_settings s on s.user_id = u.id
       order by u.created_at desc
       limit $1`,
      [limit],
    );

    return result.rows.map(mapUser);
  }

  async updateUserSettings(userId: string, settings: UserSettings) {
    const now = new Date().toISOString();
    const result = await this.db.query<UserRow>(
      `with updated_settings as (
         insert into user_settings (
           user_id, language, currency, country, email_notifications, market_notifications,
           created_at, updated_at
         )
         values ($1, $2, $3, $4, $5, $6, $7, $7)
         on conflict (user_id) do update set
           language = excluded.language,
           currency = excluded.currency,
           country = excluded.country,
           email_notifications = excluded.email_notifications,
           market_notifications = excluded.market_notifications,
           updated_at = excluded.updated_at
         returning *
       ),
       updated_user as (
         update users set updated_at = $7 where id = $1 returning *
       )
       select
         u.id, u.email, u.email_verified, u.display_name, u.password_hash, u.password_salt,
         u.role,
         s.language, s.currency, s.country, s.email_notifications, s.market_notifications,
         u.created_at, u.updated_at
       from updated_user u
       join updated_settings s on s.user_id = u.id`,
      [
        userId,
        settings.language,
        settings.currency,
        settings.country,
        settings.emailNotifications,
        settings.marketNotifications,
        now,
      ],
    );

    const row = result.rows[0];
    return row ? mapUser(row) : null;
  }

  async markEmailVerified(userId: string) {
    const now = new Date().toISOString();
    const result = await this.db.query<UserRow>(
      `with updated_user as (
         update users set email_verified = true, updated_at = $2 where id = $1 returning *
       )
       select
         u.id, u.email, u.email_verified, u.display_name, u.password_hash, u.password_salt,
         u.role, u.created_at, u.updated_at,
         s.language, s.currency, s.country, s.email_notifications, s.market_notifications
       from updated_user u
       left join user_settings s on s.user_id = u.id
       where u.id = $1`,
      [userId, now],
    );

    const row = result.rows[0];
    return row ? mapUser(row) : null;
  }

  async updatePassword(userId: string, passwordHash: string, passwordSalt: string) {
    const now = new Date().toISOString();
    const result = await this.db.query<UserRow>(
      `with updated_user as (
         update users set password_hash = $2, password_salt = $3, updated_at = $4 where id = $1
         returning *
       )
       select
         u.id, u.email, u.email_verified, u.display_name, u.password_hash, u.password_salt,
         u.role, u.created_at, u.updated_at,
         s.language, s.currency, s.country, s.email_notifications, s.market_notifications
       from updated_user u
       left join user_settings s on s.user_id = u.id
       where u.id = $1`,
      [userId, passwordHash, passwordSalt, now],
    );

    const row = result.rows[0];
    return row ? mapUser(row) : null;
  }

  private async findOne(whereSql: string, values: readonly unknown[]) {
    const result = await this.db.query<UserRow>(
      `select
         u.id, u.email, u.email_verified, u.display_name, u.password_hash, u.password_salt,
         u.role,
         s.language, s.currency, s.country, s.email_notifications, s.market_notifications,
         u.created_at, u.updated_at
       from users u
       left join user_settings s on s.user_id = u.id
       ${whereSql}
       limit 1`,
      values,
    );

    const row = result.rows[0];
    return row ? mapUser(row) : null;
  }
}

export class PostgresSessionRepository implements SessionRepository {
  constructor(private readonly db: Queryable) {}

  async createSession(session: AuthSession) {
    const result = await this.db.query<SessionRow>(
      `insert into user_sessions (
         id, user_id, token_hash, created_at, expires_at, last_seen_at, ip_address, user_agent
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning
         id, user_id, token_hash, created_at, expires_at, last_seen_at, ip_address, user_agent`,
      [
        session.id,
        session.userId,
        session.tokenHash,
        session.createdAt,
        session.expiresAt,
        session.lastSeenAt,
        session.ipAddress,
        session.userAgent,
      ],
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error("Session insert returned no row.");
    }

    return mapSession(row);
  }

  async findSessionByTokenHash(tokenHash: string) {
    const result = await this.db.query<SessionRow>(
      `select id, user_id, token_hash, created_at, expires_at, last_seen_at, ip_address, user_agent
       from user_sessions
       where token_hash = $1
       limit 1`,
      [tokenHash],
    );

    const row = result.rows[0];
    return row ? mapSession(row) : null;
  }

  async listSessionsByUserId(userId: string) {
    const result = await this.db.query<SessionRow>(
      `select id, user_id, token_hash, created_at, expires_at, last_seen_at, ip_address, user_agent
       from user_sessions
       where user_id = $1
       order by last_seen_at desc`,
      [userId],
    );
    return result.rows.map(mapSession);
  }

  async updateSessionLastSeen(sessionId: string, seenAt: string) {
    await this.db.query(
      `update user_sessions set last_seen_at = $2, updated_at = $2 where id = $1`,
      [sessionId, seenAt],
    );
  }

  async deleteSession(sessionId: string) {
    await this.db.query(`delete from user_sessions where id = $1`, [sessionId]);
  }

  async deleteOtherSessions(userId: string, currentSessionId: string) {
    await this.db.query(
      `delete from user_sessions where user_id = $1 and id <> $2`,
      [userId, currentSessionId],
    );
  }

  async deleteSessionsByUserId(userId: string) {
    await this.db.query(`delete from user_sessions where user_id = $1`, [userId]);
  }

  async deleteExpiredSessions(now: string) {
    await this.db.query(`delete from user_sessions where expires_at <= $1`, [now]);
  }
}

export function buildPostgresAuthRepositories(db: Queryable): AuthRepositories {
  return {
    users: new PostgresUserRepository(db),
    sessions: new PostgresSessionRepository(db),
  };
}

function mapUser(row: UserRow): AuthUser {
  const fallbackSettings = defaultUserSettings();

  return {
    id: row.id,
    email: row.email,
    emailVerified: row.email_verified,
    displayName: row.display_name,
    role: row.role ?? "user",
    passwordHash: row.password_hash,
    passwordSalt: row.password_salt,
    settings: {
      language: row.language ?? fallbackSettings.language,
      currency: row.currency ?? fallbackSettings.currency,
      country: row.country,
      emailNotifications: row.email_notifications ?? fallbackSettings.emailNotifications,
      marketNotifications: row.market_notifications ?? fallbackSettings.marketNotifications,
    },
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapSession(row: SessionRow): AuthSession {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    createdAt: toIsoString(row.created_at),
    expiresAt: toIsoString(row.expires_at),
    lastSeenAt: toIsoString(row.last_seen_at),
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
  };
}

function isUniqueViolation(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "23505",
  );
}
