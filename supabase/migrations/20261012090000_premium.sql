-- Premium status per house, set only by the Stripe webhook (never through the
-- regular save-changes endpoint: these columns are deliberately absent from
-- HOUSE_COLUMNS in lib/db/rows.ts, so a client can never set them itself).
alter table public.houses
  add column if not exists premium boolean not null default false,
  add column if not exists premium_email text,
  add column if not exists premium_since timestamptz,
  add column if not exists stripe_session_id text;

create unique index if not exists houses_stripe_session_id_key on public.houses (stripe_session_id) where stripe_session_id is not null;
