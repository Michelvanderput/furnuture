-- furnuture: the morning reminder at each device's own time and time zone (like
-- Rewired), and a log of cron runs so you can see the clock is ticking.

alter table public.push_subscriptions add column if not exists tz text not null default 'Europe/Amsterdam';
-- "08:00": when this device gets the planning of the day (local time).
alter table public.push_subscriptions add column if not exists daily_time text not null default '08:00';
-- The local day it was last sent, so it is sent once a day even when the cron runs every few minutes.
alter table public.push_subscriptions add column if not exists last_daily date;

create table if not exists public.cron_runs (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  report jsonb
);
create index if not exists cron_runs_recent on public.cron_runs (ran_at desc);

alter table public.cron_runs enable row level security;
