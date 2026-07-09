-- BALUARTE — player accounts, cloud saves and leaderboard.
-- Apply with: node scripts/db-apply.mjs   (reads DATABASE_URL from .env)
-- Idempotent: safe to re-run.

create extension if not exists pgcrypto;

create table if not exists players (
  id           uuid primary key default gen_random_uuid(),
  google_sub   text unique not null,
  email        text,
  handle       text unique not null,      -- normalized: [a-z0-9._-]{1,24}
  display_name text not null,             -- as typed, 3-16 chars
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists saves (
  player_id     uuid primary key references players(id) on delete cascade,

  -- cloud save (client-authoritative, merged monotonically)
  coins         bigint  not null default 0,
  meta          jsonb   not null default '{}',
  best_wave     int     not null default 0,
  best_score    bigint  not null default 0,
  best_time     real    not null default 0,
  best_coins    int     not null default 0,
  runs          int     not null default 0,
  total_kills   bigint  not null default 0,
  total_time    double precision not null default 0,
  tutorial_done boolean not null default true,
  settings      jsonb,
  updated_at    timestamptz not null default now(),

  -- leaderboard records: only ever written by validated run submissions,
  -- never by save merges (a hand-edited localStorage cannot rank)
  lb_wave       int     not null default 0,
  lb_wave_at    timestamptz,
  lb_coins      int     not null default 0,
  lb_coins_at   timestamptz,
  lb_time       real    not null default 0,
  lb_time_at    timestamptz,
  lb_score      bigint  not null default 0
);

create index if not exists saves_lb_wave_idx  on saves (lb_wave  desc, lb_wave_at  asc);
create index if not exists saves_lb_coins_idx on saves (lb_coins desc, lb_coins_at asc);
create index if not exists saves_lb_time_idx  on saves (lb_time  desc, lb_time_at  asc);

-- Append-only audit trail of accepted runs (idempotent via client_run_id).
create table if not exists runs (
  id            bigserial primary key,
  player_id     uuid not null references players(id) on delete cascade,
  client_run_id uuid not null,
  wave          int not null,
  score         bigint not null,
  kills         int not null,
  time          real not null,
  coins         int not null,
  created_at    timestamptz not null default now(),
  unique (player_id, client_run_id)
);

create index if not exists runs_player_idx on runs (player_id, created_at desc);

-- Co-op (server-authoritative runs). mode='coop' never feeds the solo lb_*
-- boards; a future co-op leaderboard can rank these rows directly.
alter table runs add column if not exists mode text not null default 'solo';
alter table runs add column if not exists party_size int not null default 1;

-- Campaign progress: highest level unlocked (1-based), synced like the rest
-- of the cloud save.
alter table saves add column if not exists campaign_level int not null default 1;

-- Real-money coin purchases (Mercado Pago Pix). One row per checkout
-- attempt; coins are credited exactly once, when the webhook confirms
-- payment (credited_at guards re-delivery — see api/shop/webhook.ts).
create table if not exists purchases (
  id             uuid primary key default gen_random_uuid(),
  player_id      uuid not null references players(id) on delete cascade,
  pack_id        text not null,
  coins          int not null,
  amount_cents   int not null,
  mp_payment_id  text unique,
  status         text not null default 'pending', -- pending | approved | rejected | expired
  qr_code        text,
  qr_code_base64 text,
  expires_at     timestamptz,
  created_at     timestamptz not null default now(),
  credited_at    timestamptz
);

create index if not exists purchases_player_idx on purchases (player_id, created_at desc);

-- Estrelas por fase da campanha e skins (equipada + possuídas) — sincronizado
-- como o resto do save na nuvem.
alter table saves add column if not exists campaign_stars jsonb not null default '{}';
alter table saves add column if not exists skin text not null default 'aegis';
alter table saves add column if not exists owned_skins jsonb not null default '[]';
