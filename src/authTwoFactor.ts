import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import QRCode from "qrcode";
import type { AppConfig } from "./config.js";
import type { Queryable } from "./db.js";
import { toIsoString } from "./utils.js";
import { AuthError } from "./auth.js";

const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export type TwoFactorRecord = {
  userId: string;
  secret: string;
  backupCodes: string[];
  enabled: boolean;
  enabledAt: string | null;
  lastUsedAt: string | null;
};

export type TwoFactorRepository = {
  getByUserId(userId: string): Promise<TwoFactorRecord | null>;
  upsert(record: TwoFactorRecord): Promise<TwoFactorRecord>;
  markUsed(userId: string, usedAt: string): Promise<void>;
  disable(userId: string): Promise<void>;
};

export class MemoryTwoFactorRepository implements TwoFactorRepository {
  private readonly records = new Map<string, TwoFactorRecord>();

  async getByUserId(userId: string) {
    return this.records.get(userId) ?? null;
  }

  async upsert(record: TwoFactorRecord) {
    this.records.set(record.userId, record);
    return record;
  }

  async markUsed(userId: string, usedAt: string) {
    const record = this.records.get(userId);
    if (record) {
      this.records.set(userId, { ...record, lastUsedAt: usedAt });
    }
  }

  async disable(userId: string) {
    const record = this.records.get(userId);
    if (record) {
      this.records.set(userId, {
        ...record,
        enabled: false,
        enabledAt: null,
      });
    }
  }
}

type TwoFactorRow = {
  user_id: string;
  secret_encrypted: string;
  backup_codes_encrypted: string;
  enabled: boolean;
  enabled_at: Date | string | null;
  last_used_at: Date | string | null;
};

export class PostgresTwoFactorRepository implements TwoFactorRepository {
  constructor(
    private readonly db: Queryable,
    private readonly config: AppConfig,
  ) {}

  async getByUserId(userId: string) {
    const result = await this.db.query<TwoFactorRow>(
      `select user_id, secret_encrypted, backup_codes_encrypted, enabled, enabled_at, last_used_at
       from user_2fa_secrets
       where user_id = $1
       limit 1`,
      [userId],
    );
    const row = result.rows[0];
    return row ? this.mapRow(row) : null;
  }

  async upsert(record: TwoFactorRecord) {
    const now = new Date().toISOString();
    const result = await this.db.query<TwoFactorRow>(
      `insert into user_2fa_secrets (
         user_id, secret_encrypted, backup_codes_encrypted, enabled, enabled_at, last_used_at,
         created_at
       )
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (user_id) do update set
         secret_encrypted = excluded.secret_encrypted,
         backup_codes_encrypted = excluded.backup_codes_encrypted,
         enabled = excluded.enabled,
         enabled_at = excluded.enabled_at,
         last_used_at = excluded.last_used_at
       returning user_id, secret_encrypted, backup_codes_encrypted, enabled, enabled_at, last_used_at`,
      [
        record.userId,
        encryptText(this.config, record.secret),
        encryptText(this.config, JSON.stringify(record.backupCodes)),
        record.enabled,
        record.enabledAt,
        record.lastUsedAt,
        now,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("2FA upsert returned no row.");
    }
    return this.mapRow(row);
  }

  async markUsed(userId: string, usedAt: string) {
    await this.db.query(
      `update user_2fa_secrets set last_used_at = $2 where user_id = $1`,
      [userId, usedAt],
    );
  }

  async disable(userId: string) {
    await this.db.query(
      `update user_2fa_secrets set enabled = false, enabled_at = null where user_id = $1`,
      [userId],
    );
  }

  private mapRow(row: TwoFactorRow): TwoFactorRecord {
    return {
      userId: row.user_id,
      secret: decryptText(this.config, row.secret_encrypted),
      backupCodes: JSON.parse(decryptText(this.config, row.backup_codes_encrypted)) as string[],
      enabled: row.enabled,
      enabledAt: row.enabled_at ? toIsoString(row.enabled_at) : null,
      lastUsedAt: row.last_used_at ? toIsoString(row.last_used_at) : null,
    };
  }
}

export function buildTwoFactorService(repository: TwoFactorRepository, config: AppConfig) {
  async function getStatus(userId: string) {
    const record = await repository.getByUserId(userId);
    return {
      enabled: Boolean(record?.enabled),
      enabledAt: record?.enabledAt ?? null,
      lastUsedAt: record?.lastUsedAt ?? null,
    };
  }

  async function startSetup(user: { id: string; email: string }) {
    const secret = generateBase32Secret();
    const backupCodes = generateBackupCodes();
    const record = await repository.upsert({
      userId: user.id,
      secret,
      backupCodes: backupCodes.map(hashBackupCode),
      enabled: false,
      enabledAt: null,
      lastUsedAt: null,
    });

    const otpauthUrl = buildOtpAuthUrl({
      issuer: "Pulse Market",
      accountName: user.email,
      secret: record.secret,
    });

    return {
      secret,
      otpauthUrl,
      qrCodeDataUrl: await QRCode.toDataURL(otpauthUrl, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 192,
      }),
      backupCodes,
    };
  }

  async function confirm(userId: string, code: string) {
    const record = await repository.getByUserId(userId);
    if (!record) {
      throw new AuthError("TWO_FACTOR_NOT_CONFIGURED", "Start 2FA setup first.", 400);
    }

    if (!verifyTotp(record.secret, code)) {
      throw new AuthError("INVALID_TWO_FACTOR_CODE", "Two-factor code is invalid.", 400);
    }

    const now = new Date().toISOString();
    await repository.upsert({
      ...record,
      enabled: true,
      enabledAt: record.enabledAt ?? now,
      lastUsedAt: now,
    });
    return getStatus(userId);
  }

  async function disable(userId: string, code: string) {
    const record = await repository.getByUserId(userId);
    if (!record?.enabled) {
      return getStatus(userId);
    }

    if (!(await verifyCode(userId, code))) {
      throw new AuthError("INVALID_TWO_FACTOR_CODE", "Two-factor code is invalid.", 400);
    }

    await repository.disable(userId);
    return getStatus(userId);
  }

  async function regenerateBackupCodes(userId: string, code: string) {
    const record = await repository.getByUserId(userId);
    if (!record?.enabled) {
      throw new AuthError("TWO_FACTOR_NOT_ENABLED", "Two-factor authentication is not enabled.", 400);
    }

    if (!(await verifyCode(userId, code))) {
      throw new AuthError("INVALID_TWO_FACTOR_CODE", "Two-factor code is invalid.", 400);
    }

    const latest = await repository.getByUserId(userId);
    const backupCodes = generateBackupCodes();
    const now = new Date().toISOString();
    await repository.upsert({
      ...(latest ?? record),
      backupCodes: backupCodes.map(hashBackupCode),
      lastUsedAt: now,
    });

    return {
      backupCodes,
      status: await getStatus(userId),
    };
  }

  async function verifyCode(userId: string, code: string) {
    const record = await repository.getByUserId(userId);
    if (!record?.enabled) {
      return true;
    }

    const normalized = code.trim().replace(/\s+/g, "");
    const isTotp = verifyTotp(record.secret, normalized);
    const backupHash = hashBackupCode(normalized);
    const backupIndex = record.backupCodes.findIndex((item) => item === backupHash);

    if (!isTotp && backupIndex === -1) {
      return false;
    }

    const now = new Date().toISOString();
    if (backupIndex >= 0) {
      await repository.upsert({
        ...record,
        backupCodes: record.backupCodes.filter((_, index) => index !== backupIndex),
        lastUsedAt: now,
      });
    } else {
      await repository.markUsed(userId, now);
    }

    return true;
  }

  return {
    repository,
    getStatus,
    startSetup,
    confirm,
    disable,
    regenerateBackupCodes,
    verifyCode,
  };
}

export type TwoFactorService = ReturnType<typeof buildTwoFactorService>;

function generateBase32Secret() {
  const bytes = randomBytes(20);
  let bits = "";
  let output = "";
  for (const byte of bytes) {
    bits += byte.toString(2).padStart(8, "0");
  }
  for (let index = 0; index + 5 <= bits.length; index += 5) {
    output += BASE32_ALPHABET[parseInt(bits.slice(index, index + 5), 2)];
  }
  return output;
}

function buildOtpAuthUrl({
  issuer,
  accountName,
  secret,
}: {
  issuer: string;
  accountName: string;
  secret: string;
}) {
  const label = `${issuer}:${accountName}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

function verifyTotp(secret: string, code: string) {
  if (!/^\d{6}$/.test(code.trim())) {
    return false;
  }

  const nowStep = Math.floor(Date.now() / 1000 / TOTP_PERIOD_SECONDS);
  return [-1, 0, 1].some((offset) => generateTotp(secret, nowStep + offset) === code.trim());
}

function generateTotp(secret: string, counter: number) {
  const key = decodeBase32(secret);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

function decodeBase32(value: string) {
  const clean = value.replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const character of clean) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index >= 0) {
      bits += index.toString(2).padStart(5, "0");
    }
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function randomBackupCode() {
  return `${randomBytes(3).toString("hex")}-${randomBytes(3).toString("hex")}`;
}

function generateBackupCodes() {
  return Array.from({ length: 8 }, () => randomBackupCode());
}

function hashBackupCode(code: string) {
  return createHash("sha256").update(code.trim().toLowerCase()).digest("hex");
}

function getEncryptionKey(config: AppConfig) {
  return createHash("sha256").update(config.sessionSecret).digest();
}

function encryptText(config: AppConfig, text: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(config), iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decryptText(config: AppConfig, value: string) {
  const [ivText, tagText, encryptedText] = value.split(".");
  if (!ivText || !tagText || !encryptedText) {
    throw new Error("Invalid encrypted payload.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(config),
    Buffer.from(ivText, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
