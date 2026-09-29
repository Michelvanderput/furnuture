-- furnuture: a question can go to one person instead of the whole house. Empty
-- (null) = everyone; otherwise the names of the members it is for.
alter table public.notifications add column if not exists recipients text[];
