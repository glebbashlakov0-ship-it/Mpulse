import type { FastifyReply, FastifyRequest } from "fastify";
import {
  createHmac,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import type { AppConfig } from "./config.js";
import type { TwoFactorService } from "./authTwoFactor.js";

const scrypt = promisify(scryptCallback);
const PASSWORD_KEY_LENGTH = 64;
const MAX_EMAIL_LENGTH = 254;
const MIN_PASSWORD_LENGTH = 10;

export const userRoles = [
  "user",
  "support",
  "compliance_admin",
  "finance_admin",
  "super_admin",
] as const;

export type UserRole = (typeof userRoles)[number];
export type AdminRole = Exclude<UserRole, "user">;

export type UserSettings = {
  language: "en" | "ar";
  currency: "USDT";
  country: string | null;
  emailNotifications: boolean;
  marketNotifications: boolean;
};

export type AuthUser = {
  id: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  role: UserRole;
  passwordHash: string;
  passwordSalt: string;
  settings: UserSettings;
  createdAt: string;
  updatedAt: string;
};

export type PublicUser = Omit<AuthUser, "passwordHash" | "passwordSalt">;

export type AuthSession = {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  ipAddress: string | null;
  userAgent: string | null;
};

export type UserRepository = {
  createUser(user: AuthUser): Promise<AuthUser>;
  findUserByEmail(email: string): Promise<AuthUser | null>;
  findUserById(id: string): Promise<AuthUser | null>;
  listUsers(limit?: number): Promise<AuthUser[]>;
  updateUserSettings(userId: string, settings: UserSettings): Promise<AuthUser | null>;
  markEmailVerified(userId: string): Promise<AuthUser | null>;
  updatePassword(userId: string, passwordHash: string, passwordSalt: string): Promise<AuthUser | null>;
};

export type SessionRepository = {
  createSession(session: AuthSession): Promise<AuthSession>;
  findSessionByTokenHash(tokenHash: string): Promise<AuthSession | null>;
  listSessionsByUserId(userId: string): Promise<AuthSession[]>;
  updateSessionLastSeen(sessionId: string, seenAt: string): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  deleteOtherSessions(userId: string, currentSessionId: string): Promise<void>;
  deleteExpiredSessions(now: string): Promise<void>;
};

export type AuthStore = UserRepository & SessionRepository;

export type AuthRepositories = {
  users: UserRepository;
  sessions: SessionRepository;
};

export type AuthContext = {
  user: PublicUser;
  session: AuthSession;
};

export class AuthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}

export class MemoryAuthStore implements AuthStore {
  private readonly users = new Map<string, AuthUser>();
  private readonly userIdsByEmail = new Map<string, string>();
  private readonly sessions = new Map<string, AuthSession>();
  private readonly sessionIdsByTokenHash = new Map<string, string>();

  async createUser(user: AuthUser) {
    if (this.userIdsByEmail.has(user.email)) {
      throw new AuthError("EMAIL_ALREADY_REGISTERED", "Email is already registered.", 409);
    }

    this.users.set(user.id, user);
    this.userIdsByEmail.set(user.email, user.id);
    return user;
  }

  async findUserByEmail(email: string) {
    const userId = this.userIdsByEmail.get(normalizeEmail(email));
    return userId ? this.users.get(userId) ?? null : null;
  }

  async findUserById(id: string) {
    return this.users.get(id) ?? null;
  }

  async listUsers(limit = 100) {
    return [...this.users.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }

  async updateUserSettings(userId: string, settings: UserSettings) {
    const user = this.users.get(userId);
    if (!user) {
      return null;
    }

    const nextUser = {
      ...user,
      settings,
      updatedAt: new Date().toISOString(),
    };
    this.users.set(userId, nextUser);
    return nextUser;
  }

  async createSession(session: AuthSession) {
    this.sessions.set(session.id, session);
    this.sessionIdsByTokenHash.set(session.tokenHash, session.id);
    return session;
  }

  async findSessionByTokenHash(tokenHash: string) {
    const sessionId = this.sessionIdsByTokenHash.get(tokenHash);
    return sessionId ? this.sessions.get(sessionId) ?? null : null;
  }

  async listSessionsByUserId(userId: string) {
    return [...this.sessions.values()]
      .filter((session) => session.userId === userId)
      .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt));
  }

  async updateSessionLastSeen(sessionId: string, seenAt: string) {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.set(sessionId, {
        ...session,
        lastSeenAt: seenAt,
      });
    }
  }

  async deleteSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessionIdsByTokenHash.delete(session.tokenHash);
      this.sessions.delete(sessionId);
    }
  }

  async deleteOtherSessions(userId: string, currentSessionId: string) {
    for (const session of this.sessions.values()) {
      if (session.userId === userId && session.id !== currentSessionId) {
        await this.deleteSession(session.id);
      }
    }
  }

  async deleteExpiredSessions(now: string) {
    for (const session of this.sessions.values()) {
      if (session.expiresAt <= now) {
        await this.deleteSession(session.id);
      }
    }
  }

  async markEmailVerified(userId: string) {
    const user = this.users.get(userId);
    if (!user) {
      return null;
    }

    const nextUser = {
      ...user,
      emailVerified: true,
      updatedAt: new Date().toISOString(),
    };
    this.users.set(userId, nextUser);
    return nextUser;
  }

  async updatePassword(userId: string, passwordHash: string, passwordSalt: string) {
    const user = this.users.get(userId);
    if (!user) {
      return null;
    }

    const nextUser = {
      ...user,
      passwordHash,
      passwordSalt,
      updatedAt: new Date().toISOString(),
    };
    this.users.set(userId, nextUser);
    return nextUser;
  }
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && (userRoles as readonly string[]).includes(value);
}

export function isAdminRole(role: UserRole): role is AdminRole {
  return role !== "user";
}

export function toPublicUser(user: AuthUser): PublicUser {
  const { passwordHash: _passwordHash, passwordSalt: _passwordSalt, ...publicUser } = user;
  return publicUser;
}

export function defaultUserSettings(): UserSettings {
  return {
    language: "en",
    currency: "USDT",
    country: null,
    emailNotifications: true,
    marketNotifications: true,
  };
}

export function buildAuthService({
  config,
  repositories,
  store = new MemoryAuthStore(),
  twoFactor,
}: {
  config: AppConfig;
  repositories?: AuthRepositories;
  store?: AuthStore;
  twoFactor?: TwoFactorService;
}) {
  const repos = repositories ?? {
    users: store,
    sessions: store,
  };

  function hashSessionToken(token: string) {
    return createHmac("sha256", config.sessionSecret).update(token).digest("hex");
  }

  async function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
    const derivedKey = (await scrypt(password, salt, PASSWORD_KEY_LENGTH)) as Buffer;
    return {
      passwordHash: derivedKey.toString("hex"),
      passwordSalt: salt,
    };
  }

  async function verifyPassword(password: string, user: AuthUser) {
    const { passwordHash } = await hashPassword(password, user.passwordSalt);
    const expected = Buffer.from(user.passwordHash, "hex");
    const actual = Buffer.from(passwordHash, "hex");

    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  async function createSession(
    userId: string,
    metadata: { ipAddress?: string | null; userAgent?: string | null } = {},
  ) {
    const now = new Date();
    const token = randomBytes(32).toString("base64url");
    const session: AuthSession = {
      id: randomUUID(),
      userId,
      tokenHash: hashSessionToken(token),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + config.sessionTtlMs).toISOString(),
      lastSeenAt: now.toISOString(),
      ipAddress: metadata.ipAddress ?? null,
      userAgent: metadata.userAgent ?? null,
    };

    await repos.sessions.deleteExpiredSessions(now.toISOString());
    await repos.sessions.createSession(session);
    return { token, session };
  }

  function getConfiguredRole(email: string): UserRole {
    return config.adminEmails.includes(normalizeEmail(email)) ? "super_admin" : "user";
  }

  function applyConfiguredRole(user: AuthUser): AuthUser {
    const configuredRole = getConfiguredRole(user.email);
    if (configuredRole === "user" || user.role === configuredRole) {
      return user;
    }

    return {
      ...user,
      role: configuredRole,
    };
  }

  async function register(input: {
    email?: unknown;
    password?: unknown;
    displayName?: unknown;
    ipAddress?: string | null;
    userAgent?: string | null;
  }) {
    const email = validateEmail(input.email);
    const password = validatePassword(input.password);
    const displayName = validateDisplayName(input.displayName, email);

    if (await repos.users.findUserByEmail(email)) {
      throw new AuthError("EMAIL_ALREADY_REGISTERED", "Email is already registered.", 409);
    }

    const now = new Date().toISOString();
    const passwordParts = await hashPassword(password);
    const user = await repos.users.createUser({
      id: randomUUID(),
      email,
      emailVerified: false,
      displayName,
      role: getConfiguredRole(email),
      ...passwordParts,
      settings: defaultUserSettings(),
      createdAt: now,
      updatedAt: now,
    });
    const session = await createSession(user.id, {
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return {
      user: toPublicUser(applyConfiguredRole(user)),
      session,
    };
  }

  async function login(input: {
    email?: unknown;
    password?: unknown;
    twoFactorCode?: unknown;
    ipAddress?: string | null;
    userAgent?: string | null;
  }) {
    const email = validateEmail(input.email);
    const password = typeof input.password === "string" ? input.password : "";
    const user = await repos.users.findUserByEmail(email);

    if (!user || !(await verifyPassword(password, user))) {
      throw new AuthError("INVALID_CREDENTIALS", "Invalid email or password.", 401);
    }

    const twoFactorStatus = twoFactor ? await twoFactor.getStatus(user.id) : { enabled: false };
    if (twoFactorStatus.enabled) {
      const code = typeof input.twoFactorCode === "string" ? input.twoFactorCode : "";
      if (!code) {
        throw new AuthError("TWO_FACTOR_REQUIRED", "Two-factor authentication code is required.", 401);
      }
      if (!(await twoFactor!.verifyCode(user.id, code))) {
        throw new AuthError("INVALID_TWO_FACTOR_CODE", "Two-factor code is invalid.", 401);
      }
    }

    const session = await createSession(user.id, {
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
    return {
      user: toPublicUser(applyConfiguredRole(user)),
      session,
    };
  }

  async function authenticateToken(token: string | null): Promise<AuthContext | null> {
    if (!token) {
      return null;
    }

    const now = new Date().toISOString();
    await repos.sessions.deleteExpiredSessions(now);
    const session = await repos.sessions.findSessionByTokenHash(hashSessionToken(token));
    if (!session || session.expiresAt <= now) {
      return null;
    }

    const user = await repos.users.findUserById(session.userId);
    if (!user) {
      await repos.sessions.deleteSession(session.id);
      return null;
    }

    await repos.sessions.updateSessionLastSeen(session.id, now);
    return {
      user: toPublicUser(applyConfiguredRole(user)),
      session: {
        ...session,
        lastSeenAt: now,
      },
    };
  }

  async function updateSettings(userId: string, input: unknown) {
    const current = await repos.users.findUserById(userId);
    if (!current) {
      throw new AuthError("USER_NOT_FOUND", "User was not found.", 404);
    }

    const settings = validateSettings(input, current.settings);
    const user = await repos.users.updateUserSettings(userId, settings);
    if (!user) {
      throw new AuthError("USER_NOT_FOUND", "User was not found.", 404);
    }

    return toPublicUser(applyConfiguredRole(user));
  }

  async function listUsers(limit = 100) {
    const users = await repos.users.listUsers(limit);
    return users.map((user) => toPublicUser(applyConfiguredRole(user)));
  }

  return {
    repositories: repos,
    store,
    register,
    login,
    authenticateToken,
    updateSettings,
    listUsers,
    hashPassword,
    updatePassword: async (userId: string, password: string) => {
      const passwordParts = await hashPassword(validatePassword(password));
      const user = await repos.users.updatePassword(userId, passwordParts.passwordHash, passwordParts.passwordSalt);
      if (!user) {
        throw new AuthError("USER_NOT_FOUND", "User was not found.", 404);
      }
      await repos.sessions.deleteOtherSessions(userId, "");
      return toPublicUser(applyConfiguredRole(user));
    },
    listSessions: (userId: string) => repos.sessions.listSessionsByUserId(userId),
    deleteSession: (sessionId: string) => repos.sessions.deleteSession(sessionId),
    deleteOtherSessions: (userId: string, currentSessionId: string) =>
      repos.sessions.deleteOtherSessions(userId, currentSessionId),
  };
}

export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
  authService: AuthService,
  config: AppConfig,
): Promise<void> {
  await requireAuth(request, reply, authService, config);
  if (reply.sent) {
    return;
  }

  const context = getAuthContext(request);
  if (!context || !isAdminRole(context.user.role)) {
    reply.status(403).send({
      data: null,
      error: {
        code: "ADMIN_FORBIDDEN",
        message: "Admin access is required.",
      },
    });
  }
}

export function requireAdminRole(roles: AdminRole[]) {
  const allowed = new Set<UserRole>(roles);

  return async (
    request: FastifyRequest,
    reply: FastifyReply,
    authService: AuthService,
    config: AppConfig,
  ): Promise<void> => {
    await requireAdmin(request, reply, authService, config);
    if (reply.sent) {
      return;
    }

    const context = getAuthContext(request);
    if (!context || !allowed.has(context.user.role)) {
      reply.status(403).send({
        data: null,
        error: {
          code: "ADMIN_ROLE_FORBIDDEN",
          message: "This admin role is not allowed for this action.",
        },
      });
    }
  };
}

export type AuthService = ReturnType<typeof buildAuthService>;

export function getSessionTokenFromRequest(
  request: FastifyRequest,
  cookieName: string,
): string | null {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) {
    return null;
  }

  for (const cookiePart of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = cookiePart.trim().split("=");
    if (rawName === cookieName) {
      try {
        return decodeURIComponent(rawValue.join("="));
      } catch {
        return null;
      }
    }
  }

  return null;
}

export function setSessionCookie(reply: FastifyReply, config: AppConfig, token: string) {
  const maxAgeSeconds = Math.floor(config.sessionTtlMs / 1000);
  const secure = config.sessionCookieSecure ? "; Secure" : "";
  reply.header(
    "Set-Cookie",
    `${config.sessionCookieName}=${encodeURIComponent(token)}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; SameSite=Lax${secure}`,
  );
}

export function clearSessionCookie(reply: FastifyReply, config: AppConfig) {
  const secure = config.sessionCookieSecure ? "; Secure" : "";
  reply.header(
    "Set-Cookie",
    `${config.sessionCookieName}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure}`,
  );
}

export function getAuthContext(request: FastifyRequest) {
  return (request as FastifyRequest & { auth?: AuthContext }).auth ?? null;
}

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  authService: AuthService,
  config: AppConfig,
): Promise<void> {
  const auth = await authService.authenticateToken(
    getSessionTokenFromRequest(request, config.sessionCookieName),
  );

  if (!auth) {
    reply.status(401).send({
      data: null,
      error: {
        code: "UNAUTHENTICATED",
        message: "Authentication is required.",
      },
    });
    return;
  }

  (request as FastifyRequest & { auth: AuthContext }).auth = auth;
}

function validateEmail(value: unknown) {
  if (typeof value !== "string") {
    throw new AuthError("INVALID_EMAIL", "Enter a valid email address.");
  }

  const email = normalizeEmail(value);
  const isValid =
    email.length > 3 &&
    email.length <= MAX_EMAIL_LENGTH &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  if (!isValid) {
    throw new AuthError("INVALID_EMAIL", "Enter a valid email address.");
  }

  return email;
}

function validatePassword(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length < MIN_PASSWORD_LENGTH ||
    value.length > 200 ||
    !/[A-Za-z]/.test(value) ||
    !/[0-9]/.test(value)
  ) {
    throw new AuthError(
      "INVALID_PASSWORD",
      "Password must be 10-200 characters and include letters and numbers.",
    );
  }

  return value;
}

function validateDisplayName(value: unknown, email: string) {
  if (value === undefined || value === null || value === "") {
    return email.split("@")[0] ?? "Trader";
  }

  if (typeof value !== "string") {
    throw new AuthError("INVALID_DISPLAY_NAME", "Display name must be text.");
  }

  const displayName = value.trim();
  if (displayName.length < 2 || displayName.length > 80) {
    throw new AuthError(
      "INVALID_DISPLAY_NAME",
      "Display name must be between 2 and 80 characters.",
    );
  }

  return displayName;
}

function validateSettings(value: unknown, current: UserSettings) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AuthError("INVALID_SETTINGS", "Settings payload is invalid.");
  }

  const input = value as Partial<Record<keyof UserSettings, unknown>>;
  const next: UserSettings = { ...current };

  if (input.language !== undefined) {
    if (input.language !== "en" && input.language !== "ar") {
      throw new AuthError("INVALID_SETTINGS", "Language must be en or ar.");
    }
    next.language = input.language;
  }

  if (input.country !== undefined) {
    if (input.country !== null && typeof input.country !== "string") {
      throw new AuthError("INVALID_SETTINGS", "Country must be text or null.");
    }
    next.country = input.country ? input.country.trim().slice(0, 80) : null;
  }

  if (input.emailNotifications !== undefined) {
    if (typeof input.emailNotifications !== "boolean") {
      throw new AuthError("INVALID_SETTINGS", "Email notifications must be boolean.");
    }
    next.emailNotifications = input.emailNotifications;
  }

  if (input.marketNotifications !== undefined) {
    if (typeof input.marketNotifications !== "boolean") {
      throw new AuthError("INVALID_SETTINGS", "Market notifications must be boolean.");
    }
    next.marketNotifications = input.marketNotifications;
  }

  return next;
}
