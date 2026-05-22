import * as React from "react";
import toast from "react-hot-toast";
import { AlertCircle, CheckCircle2, Clock3, FileCheck2, Loader2, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  acceptLegalAcknowledgements,
  loadComplianceEligibility,
  loadComplianceProfile,
  updateComplianceProfile,
} from "../lib/api";
import {
  formatAmlStatus,
  formatEligibilityReason,
  formatRiskLevel,
  formatVerificationStatus,
  hasAcceptedLegalVersions,
  isEligibleToTrade,
} from "../lib/eligibility";
import { useAuth } from "../hooks/useAuth";
import { resolveKycViewState, shouldRefreshKycCompliance } from "./KYCPage.state";
import type { LoadState } from "./KYCPage.state";
import type { ComplianceEligibilityPayload, ComplianceMePayload } from "../lib/types";

type ViteImportMeta = ImportMeta & { env?: { DEV?: boolean } };

const countryOptions = [
  { value: "", label: "Select country" },
  { value: "AE", label: "United Arab Emirates" },
  { value: "SA", label: "Saudi Arabia" },
  { value: "QA", label: "Qatar" },
  { value: "KW", label: "Kuwait" },
  { value: "BH", label: "Bahrain" },
  { value: "OM", label: "Oman" },
  { value: "JO", label: "Jordan" },
  { value: "EG", label: "Egypt" },
  { value: "MA", label: "Morocco" },
  { value: "US", label: "United States" },
  { value: "GB", label: "United Kingdom" },
];

const cardClass = "rounded-3xl border border-[#242b32] bg-[#1e2428] p-5 sm:p-6";
const mutedText = "text-[#7b8996]";
const inputClass =
  "mt-2 w-full rounded-2xl border border-[#242b32] bg-[#15191d] px-4 py-3 text-sm font-semibold text-[#dee3e7] outline-none transition focus:border-[#0093fd] focus:ring-2 focus:ring-[#0093fd]/20 disabled:opacity-50";

export function KYCPage() {
  const { t } = useTranslation();
  const { user, status: authStatus } = useAuth();
  const [profilePayload, setProfilePayload] = React.useState<ComplianceMePayload | null>(null);
  const [eligibility, setEligibility] = React.useState<ComplianceEligibilityPayload | null>(null);
  const [loadState, setLoadState] = React.useState<LoadState>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [country, setCountry] = React.useState("");
  const [dateOfBirth, setDateOfBirth] = React.useState("");
  const [profileSaving, setProfileSaving] = React.useState(false);
  const [legalSaving, setLegalSaving] = React.useState(false);
  const [legalChecked, setLegalChecked] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!(import.meta as ViteImportMeta).env?.DEV) {
      return;
    }

    console.debug("[kyc-state]", {
      authStatus,
      hasUser: Boolean(user),
      loadState,
    });
  }, [authStatus, loadState, user]);

  const refreshCompliance = React.useCallback(
    async (signal?: AbortSignal) => {
      if (!user) {
        return;
      }

      setLoadState("loading");
      setError(null);

      try {
        const [nextProfile, nextEligibility] = await Promise.all([
          loadComplianceProfile(signal),
          loadComplianceEligibility(signal),
        ]);

        setProfilePayload(nextProfile);
        setEligibility(nextEligibility);
        setCountry(nextProfile.profile.countryCode ?? "");
        setDateOfBirth(nextProfile.profile.dateOfBirth ?? "");
        setLegalChecked(hasAcceptedLegalVersions(nextProfile.acceptedVersions));
        setLoadState("ready");
      } catch (nextError) {
        if (nextError instanceof DOMException && nextError.name === "AbortError") {
          return;
        }

        const message =
          nextError instanceof Error ? nextError.message : t("kyc.errors.loadFailed");
        setError(message);
        setLoadState("error");
      }
    },
    [t, user],
  );

  React.useEffect(() => {
    if (authStatus === "loading" || user) {
      return;
    }

    setLoadState("idle");
    setProfilePayload(null);
    setEligibility(null);
  }, [authStatus, user]);

  React.useEffect(() => {
    if (!shouldRefreshKycCompliance({ authStatus, user, loadState })) {
      return;
    }

    void refreshCompliance();
  }, [authStatus, loadState, refreshCompliance, user]);

  React.useEffect(() => {
    if (authStatus !== "authenticated" || loadState !== "loading") {
      return;
    }

    const timeout = window.setTimeout(() => {
      setError(t("kyc.errors.loadFailed"));
      setLoadState("error");
    }, 8000);

    return () => window.clearTimeout(timeout);
  }, [authStatus, loadState, t]);

  const profile = profilePayload?.profile ?? null;
  const acceptedVersions = profilePayload?.acceptedVersions;
  const legalAccepted = hasAcceptedLegalVersions(acceptedVersions);
  const canTrade = isEligibleToTrade(eligibility);
  const blockerReasons =
    eligibility?.reasons.filter((reason) => reason !== "TRANSFERS_UNAVAILABLE") ?? [];
  const transferNotice = eligibility?.reasons.includes("TRANSFERS_UNAVAILABLE") ?? false;
  const maxBirthDate = new Date().toISOString().slice(0, 10);

  function validateForm() {
    if (country && !/^[A-Z]{2}$/.test(country)) {
      return t("kyc.errors.country");
    }

    if (!dateOfBirth) {
      return t("kyc.errors.dateRequired");
    }

    const selectedDate = new Date(`${dateOfBirth}T00:00:00.000Z`);
    if (Number.isNaN(selectedDate.getTime()) || selectedDate > new Date()) {
      return t("kyc.errors.dateInvalid");
    }

    return null;
  }

  async function handleUpdateProfile(event: React.FormEvent) {
    event.preventDefault();
    setSuccessMessage(null);
    const nextFormError = validateForm();

    if (nextFormError) {
      setFormError(nextFormError);
      return;
    }

    setFormError(null);
    setProfileSaving(true);

    try {
      const nextProfile = await updateComplianceProfile({
        countryCode: country || null,
        dateOfBirth: dateOfBirth || null,
      });
      const nextEligibility = await loadComplianceEligibility();
      setProfilePayload(nextProfile);
      setEligibility(nextEligibility);
      setSuccessMessage(t("kyc.profileSaved"));
      toast.success(t("kyc.profileSaved"));
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : t("errors.generic");
      setFormError(message);
      toast.error(message);
    } finally {
      setProfileSaving(false);
    }
  }

  async function handleAcceptLegal() {
    setSuccessMessage(null);
    setLegalSaving(true);

    try {
      await acceptLegalAcknowledgements();
      const [nextProfile, nextEligibility] = await Promise.all([
        loadComplianceProfile(),
        loadComplianceEligibility(),
      ]);
      setProfilePayload(nextProfile);
      setEligibility(nextEligibility);
      setLegalChecked(true);
      setSuccessMessage(t("kyc.acknowledgementsSaved"));
      toast.success(t("kyc.acknowledgementsSaved"));
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : t("errors.generic");
      toast.error(message);
    } finally {
      setLegalSaving(false);
    }
  }

  const viewState = resolveKycViewState({ authStatus, user, loadState });

  if (viewState === "loading") {
    return (
      <VerificationShell>
        <StateCard
          icon={<Loader2 className="animate-spin" size={22} />}
          title={t("kyc.loadingTitle")}
          text={t("kyc.loadingText")}
        />
      </VerificationShell>
    );
  }

  if (viewState === "sign-in") {
    return (
      <VerificationShell>
        <StateCard
          icon={<ShieldCheck size={22} />}
          title={t("kyc.signInTitle")}
          text={t("kyc.signInText")}
          action={<a className={primaryButtonClass} href="/auth?mode=login&redirect=%2Fkyc">{t("kyc.signInAction")}</a>}
        />
      </VerificationShell>
    );
  }

  if (viewState === "error") {
    return (
      <VerificationShell>
        <StateCard
          icon={<AlertCircle size={22} />}
          title={t("kyc.errorTitle")}
          text={error ?? t("errors.generic")}
          action={
            <button className={primaryButtonClass} onClick={() => void refreshCompliance()} type="button">
              {t("kyc.retry")}
            </button>
          }
        />
      </VerificationShell>
    );
  }

  return (
    <VerificationShell>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid gap-5">
          <section className={cardClass}>
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#0093fd]">
                  {t("kyc.overline")}
                </p>
                <h1 className="mt-3 text-3xl font-semibold tracking-normal text-[#dee3e7] sm:text-4xl">
                  {t("kyc.title")}
                </h1>
                <p className={`mt-3 max-w-2xl text-sm leading-6 ${mutedText}`}>
                  {t("kyc.subtitle")}
                </p>
              </div>
              <StatusPill
                tone={canTrade ? "success" : "warning"}
                label={canTrade ? t("kyc.canTrade") : t("kyc.cannotTrade")}
              />
            </div>

            {successMessage ? (
              <div className="mt-5 flex items-start gap-2 rounded-2xl border border-[#3db468]/25 bg-[#3db468]/10 px-4 py-3 text-sm font-semibold text-[#a6d2b6]">
                <CheckCircle2 className="mt-0.5 shrink-0" size={17} />
                {successMessage}
              </div>
            ) : null}
          </section>

          <section className={cardClass}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-[#dee3e7]">{t("kyc.profileTitle")}</h2>
                <p className={`mt-1 text-sm ${mutedText}`}>{t("kyc.profileText")}</p>
              </div>
              <FileCheck2 className="shrink-0 text-[#0093fd]" size={24} />
            </div>

            <form className="mt-6 grid gap-5 md:grid-cols-2" onSubmit={handleUpdateProfile}>
              <label className="block text-sm font-semibold text-[#dee3e7]">
                {t("kyc.country")}
                <select
                  className={inputClass}
                  value={country}
                  onChange={(event) => setCountry(event.target.value)}
                >
                  {countryOptions.map((option) => (
                    <option key={option.value || "empty"} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm font-semibold text-[#dee3e7]">
                {t("kyc.dateOfBirth")}
                <input
                  className={inputClass}
                  max={maxBirthDate}
                  type="date"
                  value={dateOfBirth}
                  onChange={(event) => setDateOfBirth(event.target.value)}
                />
              </label>

              <div className="md:col-span-2">
                {formError ? (
                  <p className="mb-3 rounded-2xl border border-[#cb3131]/25 bg-[#cb3131]/10 px-4 py-3 text-sm font-semibold text-[#daa]">
                    {formError}
                  </p>
                ) : null}
                <button className={primaryButtonClass} disabled={profileSaving} type="submit">
                  {profileSaving ? t("kyc.saving") : t("kyc.save")}
                </button>
              </div>
            </form>
          </section>

          <section className={cardClass}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-[#dee3e7]">{t("kyc.legalTitle")}</h2>
                <p className={`mt-1 text-sm ${mutedText}`}>{t("kyc.legalText")}</p>
              </div>
              <Clock3 className="shrink-0 text-[#7b8996]" size={24} />
            </div>

            <div className="mt-5 grid gap-3">
              <LegalRow
                label={t("kyc.terms")}
                accepted={Boolean(acceptedVersions?.terms)}
                version={acceptedVersions?.terms}
                acceptedLabel={t("kyc.accepted")}
                requiredLabel={t("kyc.required")}
              />
              <LegalRow
                label={t("kyc.privacy")}
                accepted={Boolean(acceptedVersions?.privacy)}
                version={acceptedVersions?.privacy}
                acceptedLabel={t("kyc.accepted")}
                requiredLabel={t("kyc.required")}
              />
              <LegalRow
                label={t("kyc.riskDisclosure")}
                accepted={Boolean(acceptedVersions?.risk_disclosure)}
                version={acceptedVersions?.risk_disclosure}
                acceptedLabel={t("kyc.accepted")}
                requiredLabel={t("kyc.required")}
              />
            </div>

            <label className="mt-5 flex items-start gap-3 rounded-2xl border border-[#242b32] bg-[#15191d] p-4 text-sm font-medium leading-6 text-[#dee3e7]">
              <input
                checked={legalChecked}
                className="mt-1 h-4 w-4 accent-[#0093fd]"
                disabled={legalAccepted || legalSaving}
                onChange={(event) => setLegalChecked(event.target.checked)}
                type="checkbox"
              />
              <span>{t("kyc.legalConfirm")}</span>
            </label>

            <button
              className={`${primaryButtonClass} mt-4`}
              disabled={!legalChecked || legalAccepted || legalSaving}
              onClick={() => void handleAcceptLegal()}
              type="button"
            >
              {legalAccepted ? t("kyc.acknowledged") : legalSaving ? t("kyc.saving") : t("kyc.acceptTerms")}
            </button>
          </section>
        </div>

        <aside className="grid h-fit gap-5 xl:sticky xl:top-32">
          <section className={cardClass}>
            <h2 className="text-xl font-semibold text-[#dee3e7]">{t("kyc.statusTitle")}</h2>
            <div className="mt-5 grid gap-3">
              <StatusMetric label={t("kyc.kycStatus")} value={formatVerificationStatus(profile?.kycStatus)} />
              <StatusMetric label={t("kyc.amlStatus")} value={formatAmlStatus(profile?.amlStatus)} />
              <StatusMetric label={t("kyc.riskLevel")} value={formatRiskLevel(profile?.riskLevel)} />
              <StatusMetric label={t("kyc.age")} value={eligibility?.age ? String(eligibility.age) : t("kyc.notProvided")} />
            </div>
          </section>

          <section className={cardClass}>
            <h2 className="text-xl font-semibold text-[#dee3e7]">{t("kyc.eligibility")}</h2>
            <p className={`mt-2 text-sm leading-6 ${mutedText}`}>
              {canTrade ? t("kyc.eligibleText") : t("kyc.ineligibleText")}
            </p>

            {blockerReasons.length > 0 ? (
              <div className="mt-5 grid gap-2">
                {blockerReasons.map((reason) => (
                  <div
                    className="rounded-2xl border border-[#f7d022]/25 bg-[#f7d022]/10 px-4 py-3 text-sm font-semibold text-[#f8da52]"
                    key={reason}
                  >
                    {formatEligibilityReason(reason)}
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-5 rounded-2xl border border-[#3db468]/25 bg-[#3db468]/10 px-4 py-3 text-sm font-semibold text-[#a6d2b6]">
                {t("kyc.noBlockers")}
              </div>
            )}

            {transferNotice ? (
              <p className={`mt-4 text-sm leading-6 ${mutedText}`}>{formatEligibilityReason("TRANSFERS_UNAVAILABLE")}</p>
            ) : null}
          </section>
        </aside>
      </div>
    </VerificationShell>
  );
}

const primaryButtonClass =
  "inline-flex items-center justify-center rounded-2xl bg-[#0093fd] px-5 py-3 text-sm font-semibold text-white shadow-[0_4px_0_rgba(0,0,0,0.28)] transition hover:bg-[#26a3fd] disabled:cursor-not-allowed disabled:opacity-50";

function VerificationShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#15191d]">
      <div className="mx-auto w-full max-w-[1500px] px-4 py-6 md:px-6 md:py-8 xl:px-8">
        {children}
      </div>
    </div>
  );
}

function StateCard({
  icon,
  title,
  text,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <section className={`${cardClass} mx-auto max-w-2xl text-center`}>
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-[#242b32] bg-[#15191d] text-[#0093fd]">
        {icon}
      </div>
      <h1 className="mt-5 text-2xl font-semibold text-[#dee3e7]">{title}</h1>
      <p className={`mx-auto mt-2 max-w-md text-sm leading-6 ${mutedText}`}>{text}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </section>
  );
}

function StatusPill({ label, tone }: { label: string; tone: "success" | "warning" }) {
  return (
    <span
      className={`inline-flex w-fit items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ${
        tone === "success"
          ? "bg-[#3db468]/15 text-[#a6d2b6]"
          : "bg-[#f7d022]/15 text-[#f8da52]"
      }`}
    >
      {tone === "success" ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
      {label}
    </span>
  );
}

function StatusMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#242b32] bg-[#15191d] p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#7b8996]">{label}</p>
      <p className="mt-2 text-base font-semibold text-[#dee3e7]">{value}</p>
    </div>
  );
}

function LegalRow({
  accepted,
  acceptedLabel,
  label,
  requiredLabel,
  version,
}: {
  accepted: boolean;
  acceptedLabel: string;
  label: string;
  requiredLabel: string;
  version: string | null | undefined;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#242b32] bg-[#15191d] px-4 py-3">
      <span className="text-sm font-semibold text-[#dee3e7]">{label}</span>
      <span
        className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
          accepted ? "bg-[#3db468]/15 text-[#a6d2b6]" : "bg-[#2e3841] text-[#7b8996]"
        }`}
      >
        {accepted ? `${acceptedLabel} ${version}` : requiredLabel}
      </span>
    </div>
  );
}
