-- Migration 010: Auth verification tokens for email verification, password reset, and 2FA
-- This migration adds tables for email verification tokens, password reset tokens, and 2FA secrets

-- Email verification tokens
create table if not exists email_verification_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  constraint email_verification_tokens_token_hash_unique unique (token_hash)
);

create index if not exists email_verification_tokens_user_id_idx on email_verification_tokens(user_id);
create index if not exists email_verification_tokens_expires_at_idx on email_verification_tokens(expires_at);

-- Password reset tokens
create table if not exists password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  constraint password_reset_tokens_token_hash_unique unique (token_hash)
);

create index if not exists password_reset_tokens_user_id_idx on password_reset_tokens(user_id);
create index if not exists password_reset_tokens_expires_at_idx on password_reset_tokens(expires_at);

-- 2FA secrets
create table if not exists user_2fa_secrets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  secret_encrypted text not null,
  backup_codes_encrypted text not null,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  enabled_at timestamptz,
  last_used_at timestamptz,
  constraint user_2fa_secrets_user_id_unique unique (user_id)
);

create index if not exists user_2fa_secrets_user_id_idx on user_2fa_secrets(user_id);
