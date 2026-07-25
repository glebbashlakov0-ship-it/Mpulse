export const disallowedIdentityDocumentEnvKeys = [
  "REAL_MONEY_KYC_PROVIDER",
  "REAL_MONEY_IDENTITY_DOCUMENT_PROVIDER",
  "REAL_MONEY_IDENTITY_VERIFICATION_PROVIDER",
  "REAL_MONEY_PASSPORT_PROVIDER",
  "REAL_MONEY_DOCUMENT_IMAGE_PROVIDER",
  "REAL_MONEY_DOCUMENT_VERIFICATION_PROVIDER",
] as const;

export const realMoneyProviderEnvNames = [
  "REAL_MONEY_CUSTODY_PROVIDER",
  "REAL_MONEY_DEPOSIT_PROVIDER",
  "REAL_MONEY_WITHDRAWAL_PROVIDER",
  "REAL_MONEY_EXECUTION_PROVIDER",
  "REAL_MONEY_RECONCILIATION_PROVIDER",
  "REAL_MONEY_ACCOUNT_RISK_PROVIDER",
  "REAL_MONEY_SANCTIONS_PROVIDER",
] as const;

export const disallowedIdentityDocumentProviderTerms = [
  "kyc",
  "know your",
  "know your customer",
  "passport",
  "identity document",
  "identity-document",
  "identity_document",
  "identity verification",
  "document image",
  "document-image",
  "document_image",
  "document verification",
  "document upload",
] as const;

export function findDisallowedIdentityDocumentTerm(value: string | null | undefined) {
  const normalizedValue = value?.trim().toLowerCase();
  if (!normalizedValue) {
    return null;
  }

  const compactValue = compactIdentityDocumentTerm(normalizedValue);
  const exactTerm = disallowedIdentityDocumentProviderTerms.find((term) =>
    normalizedValue.includes(term.toLowerCase()),
  );
  if (exactTerm) {
    return exactTerm;
  }

  return (
    disallowedIdentityDocumentProviderTerms.find((term) => {
      const normalizedTerm = term.toLowerCase();
      return compactValue.includes(compactIdentityDocumentTerm(normalizedTerm));
    }) ?? null
  );
}

function compactIdentityDocumentTerm(value: string) {
  return value.replace(/[^a-z0-9]+/g, "");
}
