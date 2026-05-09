create table if not exists user_compliance_profiles (
  user_id uuid primary key references users(id) on delete cascade,
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  date_of_birth date,
  kyc_status text not null default 'not_started' check (
    kyc_status in ('not_started', 'pending', 'approved', 'rejected', 'manual_review')
  ),
  aml_status text not null default 'clear' check (
    aml_status in ('clear', 'watchlist_review', 'blocked')
  ),
  risk_level text not null default 'low' check (
    risk_level in ('low', 'medium', 'high', 'blocked')
  ),
  verification_provider text not null default 'self_declared',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists user_legal_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  consent_type text not null check (
    consent_type in ('terms', 'privacy', 'risk_disclosure')
  ),
  version text not null check (version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  accepted_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, consent_type, version)
);

create index if not exists user_compliance_profiles_country_code_idx
  on user_compliance_profiles (country_code);

create index if not exists user_compliance_profiles_risk_level_idx
  on user_compliance_profiles (risk_level);

create index if not exists user_compliance_profiles_aml_status_idx
  on user_compliance_profiles (aml_status);

create index if not exists user_legal_consents_user_id_idx
  on user_legal_consents (user_id);

create index if not exists user_legal_consents_user_type_accepted_idx
  on user_legal_consents (user_id, consent_type, accepted_at desc);
