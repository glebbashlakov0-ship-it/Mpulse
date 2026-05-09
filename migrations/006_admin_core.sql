alter table users
  add column if not exists role text not null default 'user';

alter table users
  drop constraint if exists users_role_check,
  add constraint users_role_check check (
    role in ('user', 'support', 'compliance_admin', 'finance_admin', 'super_admin')
  );

alter table wallet_withdrawal_requests
  drop constraint if exists wallet_withdrawal_requests_status_check,
  add constraint wallet_withdrawal_requests_status_check check (
    status in (
      'draft',
      'pending_review',
      'approved_for_review',
      'approved',
      'rejected',
      'cancelled',
      'broadcast_pending',
      'broadcasted',
      'failed'
    )
  );

create table if not exists admin_market_visibility_rules (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'polymarket',
  market_external_id text not null,
  action text not null default 'hide' check (action in ('hide')),
  reason text not null check (
    reason in ('legal_risk', 'compliance', 'sensitive_topic', 'manual_review')
  ),
  active boolean not null default true,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, market_external_id)
);

create index if not exists users_role_idx on users (role);
create index if not exists admin_market_visibility_rules_active_idx
  on admin_market_visibility_rules (active, updated_at desc);
