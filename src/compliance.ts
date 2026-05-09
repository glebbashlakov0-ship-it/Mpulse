import { randomUUID } from "node:crypto";
import type { AuditService } from "./audit.js";
import type { Queryable } from "./db.js";
import { isRecord, toIsoString } from "./utils.js";

export const KYC_STATUSES = [
  "not_started",
  "pending",
  "approved",
  "rejected",
  "manual_review",
] as const;
export const AML_STATUSES = ["clear", "watchlist_review", "blocked"] as const;
export const RISK_LEVELS = ["low", "medium", "high", "blocked"] as const;
export const LEGAL_CONSENT_TYPES = ["terms", "privacy", "risk_disclosure"] as const;

export type KycStatus = (typeof KYC_STATUSES)[number];
export type AmlStatus = (typeof AML_STATUSES)[number];
export type RiskLevel = (typeof RISK_LEVELS)[number];
export type LegalConsentType = (typeof LEGAL_CONSENT_TYPES)[number];

export type ComplianceProfile = {
  userId: string;
  countryCode: string | null;
  dateOfBirth: string | null;
  kycStatus: KycStatus;
  amlStatus: AmlStatus;
  riskLevel: RiskLevel;
  verificationProvider: "self_declared";
  createdAt: string;
  updatedAt: string;
};

export type LegalConsent = {
  id: string;
  userId: string;
  consentType: LegalConsentType;
  version: string;
  acceptedAt: string;
};

export type ComplianceRepository = {
  getProfile(userId: string): Promise<ComplianceProfile | null>;
  upsertProfile(profile: ComplianceProfile): Promise<ComplianceProfile>;
  upsertLegalConsent(consent: LegalConsent): Promise<LegalConsent>;
  listLegalConsents(userId: string): Promise<LegalConsent[]>;
};

export class ComplianceError extends Error {
  constructor(
    public readonly code:
      | "INVALID_COMPLIANCE_PROFILE"
      | "INVALID_COUNTRY_CODE"
      | "INVALID_DATE_OF_BIRTH"
      | "INVALID_CONSENT_REQUEST"
      | "INVALID_CONSENT_VERSION",
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}

export class MemoryComplianceRepository implements ComplianceRepository {
  private readonly profiles = new Map<string, ComplianceProfile>();
  private readonly consents = new Map<string, LegalConsent>();

  async getProfile(userId: string) {
    return this.profiles.get(userId) ?? null;
  }

  async upsertProfile(profile: ComplianceProfile) {
    this.profiles.set(profile.userId, profile);
    return profile;
  }

  async upsertLegalConsent(consent: LegalConsent) {
    this.consents.set(getConsentKey(consent), consent);
    return consent;
  }

  async listLegalConsents(userId: string) {
    return [...this.consents.values()]
      .filter((consent) => consent.userId === userId)
      .sort((a, b) => b.acceptedAt.localeCompare(a.acceptedAt));
  }
}

type ComplianceProfileRow = {
  user_id: string;
  country_code: string | null;
  date_of_birth: Date | string | null;
  kyc_status: KycStatus;
  aml_status: AmlStatus;
  risk_level: RiskLevel;
  verification_provider: "self_declared";
  created_at: Date | string;
  updated_at: Date | string;
};

type LegalConsentRow = {
  id: string;
  user_id: string;
  consent_type: LegalConsentType;
  version: string;
  accepted_at: Date | string;
};

export class PostgresComplianceRepository implements ComplianceRepository {
  constructor(private readonly db: Queryable) {}

  async getProfile(userId: string) {
    const result = await this.db.query<ComplianceProfileRow>(
      `select user_id, country_code, date_of_birth, kyc_status, aml_status, risk_level,
              verification_provider, created_at, updated_at
       from user_compliance_profiles
       where user_id = $1
       limit 1`,
      [userId],
    );

    const row = result.rows[0];
    return row ? mapComplianceProfile(row) : null;
  }

  async upsertProfile(profile: ComplianceProfile) {
    const result = await this.db.query<ComplianceProfileRow>(
      `insert into user_compliance_profiles (
         user_id, country_code, date_of_birth, kyc_status, aml_status, risk_level,
         verification_provider, created_at, updated_at
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (user_id) do update set
         country_code = excluded.country_code,
         date_of_birth = excluded.date_of_birth,
         kyc_status = excluded.kyc_status,
         aml_status = excluded.aml_status,
         risk_level = excluded.risk_level,
         verification_provider = excluded.verification_provider,
         updated_at = excluded.updated_at
       returning user_id, country_code, date_of_birth, kyc_status, aml_status, risk_level,
                 verification_provider, created_at, updated_at`,
      [
        profile.userId,
        profile.countryCode,
        profile.dateOfBirth,
        profile.kycStatus,
        profile.amlStatus,
        profile.riskLevel,
        profile.verificationProvider,
        profile.createdAt,
        profile.updatedAt,
      ],
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error("Compliance profile upsert returned no row.");
    }

    return mapComplianceProfile(row);
  }

  async upsertLegalConsent(consent: LegalConsent) {
    const result = await this.db.query<LegalConsentRow>(
      `insert into user_legal_consents (
         id, user_id, consent_type, version, accepted_at, created_at, updated_at
       )
       values ($1, $2, $3, $4, $5, $5, $5)
       on conflict (user_id, consent_type, version) do update set
         accepted_at = excluded.accepted_at,
         updated_at = excluded.updated_at
       returning id, user_id, consent_type, version, accepted_at`,
      [consent.id, consent.userId, consent.consentType, consent.version, consent.acceptedAt],
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error("Legal consent upsert returned no row.");
    }

    return mapLegalConsent(row);
  }

  async listLegalConsents(userId: string) {
    const result = await this.db.query<LegalConsentRow>(
      `select id, user_id, consent_type, version, accepted_at
       from user_legal_consents
       where user_id = $1
       order by accepted_at desc`,
      [userId],
    );

    return result.rows.map(mapLegalConsent);
  }
}

export const BLOCKED_COUNTRY_CODES = new Set(["CU", "IR", "KP", "SY"]);

export function buildComplianceService({
  repository,
  audit,
  now = () => new Date(),
}: {
  repository: ComplianceRepository;
  audit: AuditService;
  now?: () => Date;
}) {
  async function getOrCreateProfile(userId: string) {
    const existing = await repository.getProfile(userId);
    if (existing) {
      return existing;
    }

    const timestamp = now().toISOString();
    return repository.upsertProfile({
      userId,
      countryCode: null,
      dateOfBirth: null,
      kycStatus: "not_started",
      amlStatus: "clear",
      riskLevel: "low",
      verificationProvider: "self_declared",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  async function getMe(userId: string) {
    const profile = await getOrCreateProfile(userId);
    const legalConsents = await repository.listLegalConsents(userId);

    return {
      profile,
      legalConsents,
      acceptedVersions: getAcceptedVersions(legalConsents),
    };
  }

  async function updateProfile(input: {
    userId: string;
    sessionId?: string | null;
    body: unknown;
  }) {
    const body = validateProfilePatch(input.body);
    const current = await getOrCreateProfile(input.userId);
    const timestamp = now().toISOString();
    const derived = deriveComplianceStatuses(
      {
        ...current,
        ...body,
        updatedAt: timestamp,
      },
      now(),
    );
    const profile = await repository.upsertProfile({
      ...derived,
      createdAt: current.createdAt,
      updatedAt: timestamp,
    });

    await audit.record({
      eventType: "compliance.profile_update",
      userId: input.userId,
      sessionId: input.sessionId ?? null,
      metadata: {
        countryCode: profile.countryCode,
        dateOfBirthSet: profile.dateOfBirth !== null,
        kycStatus: profile.kycStatus,
        amlStatus: profile.amlStatus,
        riskLevel: profile.riskLevel,
        verificationProvider: profile.verificationProvider,
      },
    });

    return getMe(input.userId);
  }

  async function acceptTerms(input: {
    userId: string;
    sessionId?: string | null;
    body: unknown;
  }) {
    const body = validateAcceptTerms(input.body);
    const acceptedAt = now().toISOString();
    const consents = await Promise.all([
      repository.upsertLegalConsent({
        id: randomUUID(),
        userId: input.userId,
        consentType: "terms",
        version: body.termsVersion,
        acceptedAt,
      }),
      repository.upsertLegalConsent({
        id: randomUUID(),
        userId: input.userId,
        consentType: "privacy",
        version: body.privacyVersion,
        acceptedAt,
      }),
      repository.upsertLegalConsent({
        id: randomUUID(),
        userId: input.userId,
        consentType: "risk_disclosure",
        version: body.riskDisclosureVersion,
        acceptedAt,
      }),
    ]);

    await audit.record({
      eventType: "compliance.legal_consents_accept",
      userId: input.userId,
      sessionId: input.sessionId ?? null,
      metadata: {
        termsVersion: body.termsVersion,
        privacyVersion: body.privacyVersion,
        riskDisclosureVersion: body.riskDisclosureVersion,
        verificationProvider: "self_declared",
      },
    });

    return {
      legalConsents: consents,
      acceptedVersions: getAcceptedVersions(await repository.listLegalConsents(input.userId)),
    };
  }

  async function getEligibility(input: { userId: string; sessionId?: string | null }) {
    const { profile, legalConsents, acceptedVersions } = await getMe(input.userId);
    const age = profile.dateOfBirth ? calculateAge(profile.dateOfBirth, now()) : null;
    const isUnderAge = age !== null && age < 18;
    const isBlockedCountry =
      profile.countryCode !== null && BLOCKED_COUNTRY_CODES.has(profile.countryCode);
    const isRiskBlocked = profile.riskLevel === "blocked" || profile.amlStatus === "blocked";
    const hasDateOfBirth = profile.dateOfBirth !== null;
    const hasCountryCode = profile.countryCode !== null;
    const hasLegalConsents = hasAllLegalConsents(legalConsents);
    const canTradeMock =
      hasDateOfBirth &&
      hasCountryCode &&
      hasLegalConsents &&
      !isUnderAge &&
      !isBlockedCountry &&
      !isRiskBlocked;
    const reasons: string[] = [];

    if (profile.dateOfBirth === null) {
      reasons.push("DATE_OF_BIRTH_REQUIRED_FOR_COMPLIANCE");
    } else if (isUnderAge) {
      reasons.push("AGE_UNDER_18");
    }

    if (profile.countryCode === null) {
      reasons.push("COUNTRY_REQUIRED_FOR_COMPLIANCE");
    } else if (isBlockedCountry) {
      reasons.push("BLOCKED_COUNTRY");
    }

    if (!hasLegalConsents) {
      reasons.push("LEGAL_CONSENTS_REQUIRED");
    }

    if (isRiskBlocked) {
      reasons.push("COMPLIANCE_RISK_BLOCKED");
    }

    reasons.push("TRANSFERS_UNAVAILABLE");

    await audit.record({
      eventType: "compliance.eligibility_check",
      userId: input.userId,
      sessionId: input.sessionId ?? null,
      metadata: {
        canTradeMock,
        canTradeLocal: canTradeMock,
        canUseRealMoney: false,
        reasons,
        verificationProvider: profile.verificationProvider,
      },
    });

    return {
      profile,
      acceptedVersions,
      canTradeMock,
      canTradeLocal: canTradeMock,
      canUseRealMoney: false,
      reasons: [...new Set(reasons)],
      age,
      complianceMode: "trading_restricted",
      verificationProvider: profile.verificationProvider,
    };
  }

  return {
    repository,
    getMe,
    updateProfile,
    acceptTerms,
    getEligibility,
  };
}

export type ComplianceService = ReturnType<typeof buildComplianceService>;

function deriveComplianceStatuses(profile: ComplianceProfile, asOf = new Date()): ComplianceProfile {
  const isBlockedCountry =
    profile.countryCode !== null && BLOCKED_COUNTRY_CODES.has(profile.countryCode);
  const isUnderAge =
    profile.dateOfBirth !== null && calculateAge(profile.dateOfBirth, asOf) < 18;
  const blocked = isBlockedCountry || isUnderAge;

  return {
    ...profile,
    kycStatus: blocked ? "rejected" : "not_started",
    amlStatus: isBlockedCountry ? "blocked" : "clear",
    riskLevel: blocked ? "blocked" : "low",
    verificationProvider: "self_declared",
  };
}

function validateProfilePatch(value: unknown): {
  countryCode?: string | null;
  dateOfBirth?: string | null;
} {
  if (!isRecord(value)) {
    throw new ComplianceError(
      "INVALID_COMPLIANCE_PROFILE",
      "Compliance profile update must be an object.",
    );
  }

  assertAllowedKeys(value, ["countryCode", "dateOfBirth"], "INVALID_COMPLIANCE_PROFILE");

  const output: {
    countryCode?: string | null;
    dateOfBirth?: string | null;
  } = {};

  if ("countryCode" in value) {
    output.countryCode = validateCountryCode(value.countryCode);
  }

  if ("dateOfBirth" in value) {
    output.dateOfBirth = validateDateOfBirth(value.dateOfBirth);
  }

  return output;
}

function validateAcceptTerms(value: unknown) {
  if (!isRecord(value)) {
    throw new ComplianceError(
      "INVALID_CONSENT_REQUEST",
      "Legal consent request must be an object.",
    );
  }

  assertAllowedKeys(
    value,
    ["termsVersion", "privacyVersion", "riskDisclosureVersion"],
    "INVALID_CONSENT_REQUEST",
  );

  return {
    termsVersion: validateConsentVersion(value.termsVersion),
    privacyVersion: validateConsentVersion(value.privacyVersion),
    riskDisclosureVersion: validateConsentVersion(value.riskDisclosureVersion),
  };
}

function validateCountryCode(value: unknown) {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new ComplianceError("INVALID_COUNTRY_CODE", "countryCode must be an ISO alpha-2 code.");
  }

  const countryCode = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    throw new ComplianceError("INVALID_COUNTRY_CODE", "countryCode must be an ISO alpha-2 code.");
  }

  return countryCode;
}

function validateDateOfBirth(value: unknown) {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ComplianceError("INVALID_DATE_OF_BIRTH", "dateOfBirth must use YYYY-MM-DD.");
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  const [year, month, day] = value.split("-").map(Number);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date > new Date()
  ) {
    throw new ComplianceError("INVALID_DATE_OF_BIRTH", "dateOfBirth must be a valid past date.");
  }

  return value;
}

function validateConsentVersion(value: unknown) {
  if (typeof value !== "string") {
    throw new ComplianceError("INVALID_CONSENT_VERSION", "Consent version is required.");
  }

  const version = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(version)) {
    throw new ComplianceError(
      "INVALID_CONSENT_VERSION",
      "Consent version must be a short version identifier.",
    );
  }

  return version;
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowedKeys: string[],
  code: "INVALID_COMPLIANCE_PROFILE" | "INVALID_CONSENT_REQUEST",
) {
  const allowed = new Set(allowedKeys);
  const unknownKey = Object.keys(value).find((key) => !allowed.has(key));

  if (unknownKey) {
    throw new ComplianceError(code, `Unsupported field: ${unknownKey}.`);
  }
}

export function calculateAge(dateOfBirth: string, asOf = new Date()) {
  const [year, month, day] = dateOfBirth.split("-").map(Number);
  let age = asOf.getUTCFullYear() - year;
  const currentMonth = asOf.getUTCMonth() + 1;
  const currentDay = asOf.getUTCDate();

  if (currentMonth < month || (currentMonth === month && currentDay < day)) {
    age -= 1;
  }

  return age;
}

function getAcceptedVersions(consents: LegalConsent[]) {
  return consents.reduce(
    (versions, consent) => ({
      ...versions,
      [consent.consentType]: versions[consent.consentType] ?? consent.version,
    }),
    {
      terms: null,
      privacy: null,
      risk_disclosure: null,
    } as Record<LegalConsentType, string | null>,
  );
}

function hasAllLegalConsents(consents: LegalConsent[]) {
  const types = new Set(consents.map((consent) => consent.consentType));
  return LEGAL_CONSENT_TYPES.every((type) => types.has(type));
}

function getConsentKey(consent: Pick<LegalConsent, "userId" | "consentType" | "version">) {
  return `${consent.userId}:${consent.consentType}:${consent.version}`;
}

function mapComplianceProfile(row: ComplianceProfileRow): ComplianceProfile {
  return {
    userId: row.user_id,
    countryCode: row.country_code,
    dateOfBirth: row.date_of_birth ? formatDateOfBirth(row.date_of_birth) : null,
    kycStatus: row.kyc_status,
    amlStatus: row.aml_status,
    riskLevel: row.risk_level,
    verificationProvider: row.verification_provider,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapLegalConsent(row: LegalConsentRow): LegalConsent {
  return {
    id: row.id,
    userId: row.user_id,
    consentType: row.consent_type,
    version: row.version,
    acceptedAt: toIsoString(row.accepted_at),
  };
}

function formatDateOfBirth(value: Date | string): string {
  if (typeof value === "string") {
    return value.slice(0, 10);
  }

  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
