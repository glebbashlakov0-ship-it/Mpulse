alter table comments
  add column if not exists market_external_id text,
  add column if not exists user_display_name text,
  add column if not exists position_label text;

create index if not exists comments_market_external_id_created_at_idx
  on comments (market_external_id, created_at desc);
