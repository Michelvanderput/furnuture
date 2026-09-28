-- furnuture: notifications. Each phone or tablet that allows notifications has a
-- push subscription per house; every notification sent is also kept (the list in
-- the app, and so the daily reminder goes out only once a day).

create table if not exists public.push_subscriptions (
  house_id uuid not null references public.houses(id) on delete cascade,
  -- A random id per device (kept in the browser), so a device replaces its own subscription.
  id text not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  -- Who uses this device ("Sanne"): shown as the sender, and never notified of their own changes.
  member text,
  -- Which notifications: {"ask": true, "updates": true, "daily": true}
  prefs jsonb not null default '{"ask": true, "updates": true, "daily": true}'::jsonb,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (house_id, id)
);

create table if not exists public.notifications (
  house_id uuid not null references public.houses(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  -- "ask" (look at this), "updates" (someone changed something), "daily" (planning reminder), "test"
  kind text not null,
  title text not null,
  body text not null default '',
  -- Where tapping it goes, e.g. "/?woning=…&open=item:abc".
  url text,
  member text,
  device text,
  -- The same key is sent once (e.g. "daily:2026-10-01").
  key text,
  created_at timestamptz not null default now(),
  primary key (house_id, id)
);

create index if not exists notifications_recent on public.notifications (house_id, created_at desc);
create unique index if not exists notifications_key on public.notifications (house_id, key) where key is not null;

alter table public.push_subscriptions enable row level security;
alter table public.notifications enable row level security;
