-- ilink-vote · Supabase schema
-- Paste the whole file into Supabase → SQL Editor → Run. Safe to re-run.
-- Then: insert your presenter key (bottom of this file) and copy Project URL + anon key into config.js.

create extension if not exists pgcrypto;

-- ── tables ───────────────────────────────────────────────────
create table if not exists public.sessions (
  id              text primary key,
  phase           text not null default 'lobby'
                  check (phase in ('lobby','review','voting_open','voting_closed','results','reveal','bridge')),
  reveal_step     int  not null default 0 check (reveal_step between 0 and 4),
  q3_enabled      boolean not null default true,
  manual_results  jsonb,
  reset_at        timestamptz,
  updated_at      timestamptz not null default now()
);
alter table public.sessions add column if not exists reset_at timestamptz;

create table if not exists public.votes (
  session_id  text not null references public.sessions(id) on delete cascade,
  client_id   uuid not null,
  q1          text[] not null,
  q2          text   not null,
  q3          text[],
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (session_id, client_id)
);

create table if not exists public.presenter_keys (
  session_id  text primary key references public.sessions(id) on delete cascade,
  key         text not null
);

-- ── row level security ───────────────────────────────────────
alter table public.sessions       enable row level security;
alter table public.votes          enable row level security;
alter table public.presenter_keys enable row level security;

drop policy if exists "sessions are public to read" on public.sessions;
create policy "sessions are public to read" on public.sessions for select to anon, authenticated using (true);
-- no insert/update/delete policies: anon cannot write sessions directly
-- votes / presenter_keys: no policies at all → anon has no direct access; only via the RPCs below

-- realtime on the session row (audience subscribes to it)
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'sessions') then
    alter publication supabase_realtime add table public.sessions;
  end if;
end $$;

-- ── helpers ──────────────────────────────────────────────────
create or replace function public._check_key(p_session text, p_key text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_key is null or not exists (select 1 from presenter_keys where session_id = p_session and key = p_key) then
    raise exception 'presenter key invalid';
  end if;
end $$;

create or replace function public._aggregate(p_session text) returns jsonb
language sql security definer set search_path = public as $$
  with v as (select * from votes where session_id = p_session)
  select jsonb_build_object(
    'n', (select count(*) from v),
    'q1', jsonb_build_object(
      'A', (select count(*) from v where 'A' = any(q1)),
      'B', (select count(*) from v where 'B' = any(q1)),
      'C', (select count(*) from v where 'C' = any(q1)),
      'D', (select count(*) from v where 'D' = any(q1))),
    'q2', jsonb_build_object(
      'A', (select count(*) from v where q2 = 'A'),
      'B', (select count(*) from v where q2 = 'B'),
      'C', (select count(*) from v where q2 = 'C'),
      'D', (select count(*) from v where q2 = 'D')),
    'q3', coalesce((select jsonb_object_agg(k, c) from (select k, count(*) c from v, unnest(v.q3) k group by k) t), '{}'::jsonb)
  );
$$;

-- ── RPCs (the only write paths for anon) ─────────────────────
create or replace function public.cast_vote(p_session text, p_client uuid, p_q1 text[], p_q2 text, p_q3 text[] default null)
returns void language plpgsql security definer set search_path = public as $$
declare s record;
begin
  select * into s from sessions where id = p_session;
  if s is null or s.phase <> 'voting_open' then raise exception 'voting_closed'; end if;
  if p_q1 is null or array_length(p_q1, 1) is null or not (p_q1 <@ array['A','B','C','D']) then raise exception 'bad q1'; end if;
  if p_q2 not in ('A','B','C','D') then raise exception 'bad q2'; end if;
  if p_q3 is not null and (array_length(p_q3, 1) > 3 or exists (select 1 from unnest(p_q3) x where length(x) > 40)) then raise exception 'bad q3'; end if;
  insert into votes (session_id, client_id, q1, q2, q3)
  values (p_session, p_client, (select array_agg(distinct x order by x) from unnest(p_q1) x), p_q2, p_q3)
  on conflict (session_id, client_id) do update
    set q1 = excluded.q1, q2 = excluded.q2, q3 = excluded.q3, updated_at = now();
end $$;

create or replace function public.get_results(p_session text, p_key text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s record;
begin
  select * into s from sessions where id = p_session;
  if s is null then raise exception 'no session'; end if;
  if p_key is not null then perform _check_key(p_session, p_key);
  elsif s.phase not in ('results','reveal','bridge') then raise exception 'results not published yet';
  end if;
  if s.manual_results is not null and p_key is null then return s.manual_results; end if;
  return _aggregate(p_session);
end $$;

create or replace function public.presenter_set(p_session text, p_key text, p_patch jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _check_key(p_session, p_key);
  update sessions set
    phase          = coalesce(p_patch->>'phase', phase),
    reveal_step    = coalesce((p_patch->>'reveal_step')::int, reveal_step),
    q3_enabled     = coalesce((p_patch->>'q3_enabled')::boolean, q3_enabled),
    manual_results = case when p_patch ? 'manual_results' then p_patch->'manual_results' else manual_results end,
    updated_at     = now()
  where id = p_session;
  -- jsonb null → SQL null for manual_results
  update sessions set manual_results = null where id = p_session and manual_results = 'null'::jsonb;
end $$;

create or replace function public.presenter_reset(p_session text, p_key text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _check_key(p_session, p_key);
  delete from votes where session_id = p_session;
  update sessions set phase = 'lobby', reveal_step = 0, manual_results = null, reset_at = now(), updated_at = now() where id = p_session;
end $$;

revoke all on function public._check_key(text, text) from public, anon, authenticated;
revoke all on function public._aggregate(text) from public, anon, authenticated;
grant execute on function public.cast_vote(text, uuid, text[], text, text[]) to anon, authenticated;
grant execute on function public.get_results(text, text) to anon, authenticated;
grant execute on function public.presenter_set(text, text, jsonb) to anon, authenticated;
grant execute on function public.presenter_reset(text, text) to anon, authenticated;

-- ── seed sessions + presenter keys ───────────────────────────
-- Presenter keys (already filled in). The key goes in the presenter URL: presenter.html?s=ilink-0918&key=...
insert into public.sessions (id) values ('ilink-0918'), ('rehearsal') on conflict do nothing;
insert into public.presenter_keys (session_id, key) values
  ('ilink-0918', '34369dccc62d5a159a1d2695'),
  ('rehearsal',  '7505a99bbc6eced1ea56a47d')
on conflict (session_id) do update set key = excluded.key;
