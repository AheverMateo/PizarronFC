-- PizarronFC — esquema inicial (Paso 1 / Fase 1)
-- Fuente única para el frontend. El frontend nunca llama a APIs externas.

create table if not exists leagues (
  id serial primary key,
  name text not null,
  country text,
  external_ids jsonb default '{}'
);

create table if not exists teams (
  id serial primary key,
  name text not null,
  external_ids jsonb default '{}'
);

-- nombres alternativos entre fuentes (Man United, Manchester United, ...)
create table if not exists team_aliases (
  alias text primary key,
  team_id int not null references teams(id)
);

create table if not exists matches (
  id bigserial primary key,
  league_id int not null references leagues(id),
  season int not null,
  kickoff timestamptz not null,
  home_team_id int not null references teams(id),
  away_team_id int not null references teams(id),
  status text not null default 'scheduled', -- scheduled | live | finished
  home_goals int,
  away_goals int,
  home_shots int, away_shots int,
  home_shots_on_target int, away_shots_on_target int,
  home_corners int, away_corners int,
  external_ids jsonb default '{}',
  unique (league_id, season, kickoff, home_team_id, away_team_id)
);

create table if not exists odds (
  id bigserial primary key,
  match_id bigint not null references matches(id),
  bookmaker text not null,
  market text not null,      -- 1x2 | totals | btts
  selection text not null,   -- home | draw | away | over | under | yes | no
  line numeric,              -- 2.5 para totals
  price numeric not null,
  fetched_at timestamptz not null default now()
);

create table if not exists predictions (
  id bigserial primary key,
  match_id bigint not null references matches(id),
  model_version text not null,
  market text not null,
  selection text not null,
  line numeric,
  probability numeric not null,       -- del modelo
  fair_market_prob numeric,           -- de las cuotas sin margen
  edge numeric,
  risk text,                          -- low | medium | high | no_bet
  factors jsonb,                      -- para el "¿Por qué?"
  created_at timestamptz not null default now(),  -- siempre antes del kickoff
  outcome boolean,                    -- se completa al liquidar
  settled_at timestamptz
);

create table if not exists api_usage (
  provider text not null,
  day date not null,
  requests int not null default 0,
  primary key (provider, day)
);
