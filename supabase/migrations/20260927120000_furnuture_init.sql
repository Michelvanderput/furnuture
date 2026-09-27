-- furnuture: one row per house, and its photos, rooms, items (shopping list),
-- renovation jobs and quotes. The app's server reads and writes with the service
-- role key; row level security is on without policies, so the public (anon) key
-- cannot read anything.

create extension if not exists pgcrypto;

create table if not exists public.houses (
  id uuid primary key default gen_random_uuid(),
  -- The name people type to open their house, normalised ("karbindersdreef-49").
  slug text not null unique,
  name text not null,
  funda_url text,
  title text,
  facts jsonb,
  description text,
  -- Furnishing budget and style (for the AI).
  budget numeric,
  style text,
  -- Renovation: key handover, moving day and budget.
  key_date date,
  move_date date,
  reno_budget numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.photos (
  house_id uuid not null references public.houses(id) on delete cascade,
  id text not null,
  url text not null,
  room_type text not null default 'overig',
  room_id text,
  position integer not null default 0,
  primary key (house_id, id)
);

create table if not exists public.rooms (
  house_id uuid not null references public.houses(id) on delete cascade,
  id text not null,
  name text not null,
  type text not null,
  floor text,
  area numeric,
  budget numeric,
  note text,
  position integer not null default 0,
  primary key (house_id, id)
);

create table if not exists public.items (
  house_id uuid not null references public.houses(id) on delete cascade,
  id text not null,
  room_id text,
  alternative_of text,
  title text not null,
  url text,
  shop text,
  image text,
  category text not null default 'overig',
  status text not null default 'idee',
  qty integer not null default 1,
  price numeric,
  estimate numeric,
  must boolean not null default false,
  position integer not null default 0,
  -- The rest: images, thumbnail, size, price history, note, AI reasons…
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (house_id, id)
);

create table if not exists public.tasks (
  house_id uuid not null references public.houses(id) on delete cascade,
  id text not null,
  title text not null,
  kind text not null,
  room_ids text[] not null default '{}',
  who text not null default 'vakman',
  status text not null default 'idee',
  estimate numeric,
  start date,
  days integer,
  before_move boolean not null default true,
  chosen_quote text,
  position integer not null default 0,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (house_id, id)
);

create table if not exists public.quotes (
  house_id uuid not null references public.houses(id) on delete cascade,
  id text not null,
  task_id text not null,
  company text not null,
  amount numeric not null,
  note text,
  contact text,
  added_at timestamptz not null default now(),
  primary key (house_id, id)
);

create index if not exists items_room on public.items (house_id, room_id);
create index if not exists tasks_status on public.tasks (house_id, status);
create index if not exists quotes_task on public.quotes (house_id, task_id);

alter table public.houses enable row level security;
alter table public.photos enable row level security;
alter table public.rooms enable row level security;
alter table public.items enable row level security;
alter table public.tasks enable row level security;
alter table public.quotes enable row level security;
