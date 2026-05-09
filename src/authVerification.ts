import { createHmac, randomBytes } from "node:crypto";
import type { AppConfig } from "./config.js";
import type { Queryable } from "./db.js";
import type { EmailProvider } from "./email.js";
import { toIsoString } from "./utils.js";
import { AuthError } from "./auth.js";

const EMAIL_VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export type EmailVerificationToken = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
  usedAt: string | null;
};

export type PasswordResetToken = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
  usedAt: string | null;
};

export type VerificationRepository = {
  createEmailVerificationToken(token: EmailVerificationToken): Promise<EmailVerificationToken>;
  findEmailVerificationToken(tokenHash: string): Promise<EmailVerificationToken | null>;
  markEmailVerificationTokenUsed(id: string, usedAt: string): Promise<void>;
  deleteExpiredEmailVerificationTokens(now: string): Promise<void>;
  
  createPasswordResetToken(token: PasswordResetToken): Promise<PasswordResetToken>;
  findPasswordResetToken(tokenHash: string): Promise<PasswordResetToken | null>;
  markPasswordResetTokenUsed(id: string, usedAt: string): Promise<void>;
  deleteExpiredPasswordResetTokens(now: string): Promise<void>;
};

export class MemoryVerificationRepository implements VerificationRepository {
  private readonly emailTokens = new Map<string, EmailVerificationToken>();
  private readonly emailTokensByHash = new Map<string, string>();
  private readonly resetTokens = new Map<string, PasswordResetToken>();
  private readonly resetTokensByHash = new Map<string, string>();

  async createEmailVerificationToken(token: EmailVerificationToken) {
    this.emailTokens.set(token.id, token);
    this.emailTokensByHash.set(token.tokenHash, token.id);
    return token;
  }

  async findEmailVerificationToken(tokenHash: string) {
    const id = this.emailTokensByHash.get(tokenHash);
    return id ? this.emailTokens.get(id) ?? null : null;
  }

  async markEmailVerificationTokenUsed(id: string, usedAt: string) {
    const token = this.emailTokens.get(id);
    if (token) {
      this.emailTokens.set(id, { ...token, usedAt });
    }
  }

  async deleteExpiredEmailVerificationTokens(now: string) {
    for (const token of this.emailTokens.values()) {
      if (token.expiresAt <= now) {
        this.emailTokensByHash.delete(token.tokenHash);
        this.emailTokens.delete(token.id);
      }
    }
  }

  async createPasswordResetToken(token: PasswordResetToken) {
    this.resetTokens.set(token.id, token);
    this.resetTokensByHash.set(token.tokenHash, token.id);
    return token;
  }

  async findPasswordResetToken(tokenHash: string) {
    const id = this.resetTokensByHash.get(tokenHash);
    return id ? this.resetTokens.get(id) ?? null : null;
  }

  async markPasswordResetTokenUsed(id: string, usedAt: string) {
    const token = this.resetTokens.get(id);
    if (token) {
      this.resetTokens.set(id, { ...token, usedAt });
    }
  }

  async deleteExpiredPasswordResetTokens(now: string) {
    for (const token of this.resetTokens.values()) {
      if (token.expiresAt <= now) {
        this.resetTokensByHash.delete(token.tokenHash);
        this.resetTokens.delete(token.id);
      }
    }
  }
}

export class PostgresVerificationRepository implements VerificationRepository {
  constructor(private readonly db: Queryable) {}

  async createEmailVerificationToken(token: EmailVerificationToken) {
    const result = await this.db.query<{
      id: string;
      user_id: string;
      token_hash: string;
      expires_at: Date | string;
      created_at: Date | string;
      used_at: Date | string | null;
    }>(
      `insert into email_verification_tokens (id, user_id, token_hash, expires_at, created_at, used_at)
       values ($1, $2, $3, $4, $5, $6)
       returning id, user_id, token_hash, expires_at, created_at, used_at`,
      [token.id, token.userId, token.tokenHash, token.expiresAt, token.createdAt, token.usedAt],
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error("Email verification token insert returned no row.");
    }

    return {
      id: row.id,
      userId: row.user_id,
      tokenHash: row.token_hash,
      expiresAt: toIsoString(row.expires_at),
      createdAt: toIsoString(row.created_at),
      usedAt: row.used_at ? toIsoString(row.used_at) : null,
    };
  }

  async findEmailVerificationToken(tokenHash: string) {
    const result = await this.db.query<{
      id: string;
      user_id: string;
      token_hash: string;
      expires_at: Date | string;
      created_at: Date | string;
      used_at: Date | string | null;
    }>(
      `select id, user_id, token_hash, expires_at, created_at, used_at
       from email_verification_tokens
       where token_hash = $1
       limit 1`,
      [tokenHash],
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      userId: row.user_id,
      tokenHash: row.token_hash,
      expiresAt: toIsoString(row.expires_at),
      createdAt: toIsoString(row.created_at),
      usedAt: row.used_at ? toIsoString(row.used_at) : null,
    };
  }

  async markEmailVerificationTokenUsed(id: string, usedAt: string) {
    await this.db.query(
      `update email_verification_tokens set used_at = $2 where id = $1`,
      [id, usedAt],
    );
  }

  async deleteExpiredEmailVerificationTokens(now: string) {
    await this.db.query(
      `delete from email_verification_tokens where expires_at <= $1`,
      [now],
    );
  }

  async createPasswordResetToken(token: PasswordResetToken) {
    const result = await this.db.query<{
      id: string;
      user_id: string;
      token_hash: string;
      expires_at: Date | string;
      created_at: Date | string;
      used_at: Date | string | null;
    }>(
      `insert into password_reset_tokens (id, user_id, token_hash, expires_at, created_at, used_at)
       values ($1, $2, $3, $4, $5, $6)
       returning id, user_id, token_hash, expires_at, created_at, used_at`,
      [token.id, token.userId, token.tokenHash, token.expiresAt, token.createdAt, token.usedAt],
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error("Password reset token insert returned no row.");
    }

    return {
      id: row.id,
      userId: row.user_id,
      tokenHash: row.token_hash,
      expiresAt: toIsoString(row.expires_at),
      createdAt: toIsoString(row.created_at),
      usedAt: row.used_at ? toIsoString(row.used_at) : null,
    };
  }

  async findPasswordResetToken(tokenHash: string) {
    const result = await this.db.query<{
      id: string;
      user_id: string;
      token_hash: string;
      expires_at: Date | string;
      created_at: Date | string;
      used_at: Date | string | null;
    }>(
      `select id, user_id, token_hash, expires_at, created_at, used_at
       from password_reset_tokens
       where token_hash = $1
       limit 1`,
      [tokenHash],
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      userId: row.user_id,
      tokenHash: row.token_hash,
      expiresAt: toIsoString(row.expires_at),
      createdAt: toIsoString(row.created_at),
      usedAt: row.used_at ? toIsoString(row.used_at) : null,
    };
  }

  async markPasswordResetTokenUsed(id: string, usedAt: string) {
    await this.db.query(
      `update password_reset_tokens set used_at = $2 where id = $1`,
      [id, usedAt],
    );
  }

  async deleteExpiredPasswordResetTokens(now: string) {
    await this.db.query(
      `delete from password_reset_tokens where expires_at <= $1`,
      [now],
    );
  }
}

export function buildVerificationService({
  config,
  repository,
  emailProvider,
}: {
  config: AppConfig;
  repository: VerificationRepository;
  emailProvider: EmailProvider;
}) {
  function hashToken(token: string) {
    return createHmac("sha256", config.sessionSecret).update(token).digest("hex");
  }

  async function sendVerificationEmail(userId: string, email: string, displayName: string) {
    const now = new Date();
    const rawToken = randomBytes(32).toString("base64url");
    const token: EmailVerificationToken = {
      id: crypto.randomUUID(),
      userId,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(now.getTime() + EMAIL_VERIFICATION_TOKEN_TTL_MS).toISOString(),
      createdAt: now.toISOString(),
      usedAt: null,
    };

    await repository.deleteExpiredEmailVerificationTokens(now.toISOString());
    await repository.createEmailVerificationToken(token);
    await emailProvider.sendVerificationEmail(email, rawToken, displayName);

    return { success: true };
  }

  async function verifyEmail(rawToken: string) {
    const now = new Date().toISOString();
    const tokenHash = hashToken(rawToken);

    await repository.deleteExpiredEmailVerificationTokens(now);
    const token = await repository.findEmailVerificationToken(tokenHash);

    if (!token) {
      throw new AuthError("INVALID_TOKEN", "Verification link is invalid or expired.", 400);
    }

    if (token.expiresAt <= now) {
      throw new AuthError("TOKEN_EXPIRED", "Verification link has expired.", 400);
    }

    if (token.usedAt) {
      throw new AuthError("TOKEN_ALREADY_USED", "This verification link has already been used.", 400);
    }

    await repository.markEmailVerificationTokenUsed(token.id, now);
    return { userId: token.userId };
  }

  async function sendPasswordResetEmail(userId: string, email: string, displayName: string) {
    const now = new Date();
    const rawToken = randomBytes(32).toString("base64url");
    const token: PasswordResetToken = {
      id: crypto.randomUUID(),
      userId,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(now.getTime() + PASSWORD_RESET_TOKEN_TTL_MS).toISOString(),
      createdAt: now.toISOString(),
      usedAt: null,
    };

    await repository.deleteExpiredPasswordResetTokens(now.toISOString());
    await repository.createPasswordResetToken(token);
    await emailProvider.sendPasswordResetEmail(email, rawToken, displayName);

    return { success: true };
  }

  async function verifyPasswordResetToken(rawToken: string) {
    const now = new Date().toISOString();
    const tokenHash = hashToken(rawToken);

    await repository.deleteExpiredPasswordResetTokens(now);
    const token = await repository.findPasswordResetToken(tokenHash);

    if (!token) {
      throw new AuthError("INVALID_TOKEN", "Reset link is invalid or expired.", 400);
    }

    if (token.expiresAt <= now) {
      throw new AuthError("TOKEN_EXPIRED", "Reset link has expired.", 400);
    }

    if (token.usedAt) {
      throw new AuthError("TOKEN_ALREADY_USED", "This reset link has already been used.", 400);
    }

    await repository.markPasswordResetTokenUsed(token.id, now);
    return { userId: token.userId };
  }

  return {
    sendVerificationEmail,
    verifyEmail,
    sendPasswordResetEmail,
    verifyPasswordResetToken,
  };
}

export type VerificationService = ReturnType<typeof buildVerificationService>;
