-- Themes and tournaments no longer belong to a calendar day. Each theme is its own row with a window for entries
-- (24 hours by default), any number can run at once, and each theme's bracket is keyed by the theme. Editing one
-- theme can no longer rename another's bracket.
--
-- Existing rows are carried over: every day's theme becomes a theme whose entries were open that day (closing early
-- if its bracket was started early), and posts, brackets, matchups and votes are re-pointed at it.

create table public.themes (
  id bigint generated always as identity primary key,
  title text not null check (char_length(title) between 1 and 80),
  description text not null default '' check (char_length(description) <= 400),
  -- The model that suggested the theme, or null when an admin wrote it.
  model text,
  -- Members can enter images while opens_at <= now() < closes_at. Themes that haven't opened yet are hidden.
  opens_at timestamptz not null default now(),
  closes_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Only used while this migration carries over day-based rows.
  legacy_day date unique,
  check (closes_at > opens_at)
);

create index themes_window_idx on public.themes (closes_at, opens_at);

-- How long a theme takes entries when nobody says otherwise.
alter table public.app_settings add column theme_hours integer not null default 24 check (theme_hours between 1 and 720);
grant update (theme_hours) on public.app_settings to authenticated;

-- Carry over each day's theme, open for that whole day in the settings' time zone.
insert into public.themes (title, description, model, opens_at, closes_at, created_at, updated_at, legacy_day)
select d.title, d.description, d.model,
  d.day::timestamp at time zone s.timezone,
  (d.day + 1)::timestamp at time zone s.timezone,
  d.created_at, d.updated_at, d.day
from public.daily_themes d cross join public.app_settings s;

-- Days that had images or a bracket but no theme row get an untitled theme so nothing is orphaned.
insert into public.themes (title, opens_at, closes_at, legacy_day)
select 'Untitled theme', missing.day::timestamp at time zone s.timezone, (missing.day + 1)::timestamp at time zone s.timezone, missing.day
from (
  select theme_day as day from public.posts where theme_day is not null
  union
  select day from public.tournaments
) missing
cross join public.app_settings s
where not exists (select 1 from public.themes t where t.legacy_day = missing.day);

-- A bracket that was started before its day ended closed that theme's entries at that moment.
update public.themes th
set closes_at = greatest(th.opens_at + interval '1 second', least(th.closes_at, t.started_at))
from public.tournaments t
where t.day = th.legacy_day;

alter table public.posts add column theme_id bigint references public.themes (id) on delete set null;
create index posts_theme_id_idx on public.posts (theme_id) where theme_id is not null;
update public.posts p set theme_id = th.id from public.themes th where th.legacy_day = p.theme_day;

alter table public.tournaments add column theme_id bigint references public.themes (id) on delete cascade;
update public.tournaments t set theme_id = th.id from public.themes th where th.legacy_day = t.day;
alter table public.matches add column theme_id bigint;
update public.matches m set theme_id = t.theme_id from public.tournaments t where t.day = m.tournament_day;

-- The day-based functions, trigger and table go; their replacements follow below.
drop trigger on_post_created on public.posts;
drop function public.set_post_theme_day();
drop function public.admin_start_tournament(date);
drop function public.admin_close_round(date);
drop function public.admin_pause_tournament(date);
drop function public.admin_resume_tournament(date);
drop function public.admin_set_round_end(date, timestamptz);
drop function public.admin_finish_tournament(date);
drop function public.admin_cancel_tournament(date);
drop function public.start_tournament(date);
drop function public.close_round(date);
drop table public.daily_themes;
drop function public.current_theme_day();

-- Re-key brackets and matchups by theme.
alter table public.matches drop constraint matches_tournament_day_fkey;
alter table public.matches drop constraint matches_tournament_day_round_slot_key;
alter table public.tournaments drop constraint tournaments_pkey;
alter table public.tournaments alter column theme_id set not null;
alter table public.tournaments add primary key (theme_id);
alter table public.matches alter column theme_id set not null;
alter table public.matches add constraint matches_theme_id_fkey foreign key (theme_id) references public.tournaments (theme_id) on delete cascade;
alter table public.matches add constraint matches_theme_id_round_slot_key unique (theme_id, round, slot);
alter table public.tournaments drop column day;
alter table public.matches drop column tournament_day;
alter table public.posts drop column theme_day;
alter table public.themes drop column legacy_day;

alter table public.themes enable row level security;

revoke all on public.themes from anon, authenticated;
grant select on public.themes to anon, authenticated;
grant insert (title, description, model, opens_at, closes_at) on public.themes to authenticated;
grant update (title, description, model, opens_at, closes_at, updated_at) on public.themes to authenticated;
grant delete on public.themes to authenticated;

create policy "Themes are readable once they open, and always by admins"
  on public.themes for select
  to anon, authenticated
  using (opens_at <= now() or (select public.is_admin()));

create policy "Admins can add themes"
  on public.themes for insert
  to authenticated
  with check ((select public.is_admin()));

create policy "Admins can change themes"
  on public.themes for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Admins can remove themes"
  on public.themes for delete
  to authenticated
  using ((select public.is_admin()));

-- Whether a theme is taking entries right now.
create function public.theme_is_open(target_theme bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.themes where id = target_theme and opens_at <= now() and closes_at > now());
$$;

-- Members pick which open theme an image is for when they generate it.
grant insert (theme_id) on public.posts to authenticated;

alter policy "Users can create their own posts from their own images"
  on public.posts
  with check (
    (select auth.uid()) = user_id
    and (storage.foldername(image_path))[1] = (select auth.uid())::text
    and (theme_id is null or public.theme_is_open(theme_id))
  );

-- Opens a theme from Gemini's suggestion when none is taking entries. Only the server (with the secret key) calls it;
-- the lock makes sure two first visitors can't both open one.
create function public.ensure_open_theme(new_title text, new_description text, new_model text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('public.ensure_open_theme'));
  if exists (select 1 from public.themes where opens_at <= now() and closes_at > now()) then
    return;
  end if;
  insert into public.themes (title, description, model, closes_at)
  select new_title, new_description, new_model, now() + make_interval(hours => theme_hours) from public.app_settings;
end;
$$;

revoke execute on function public.ensure_open_theme(text, text, text) from public, anon, authenticated;
grant execute on function public.ensure_open_theme(text, text, text) to service_role;

create or replace function public.match_is_open(target_match uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.matches m
    join public.tournaments t on t.theme_id = m.theme_id
    where m.id = target_match
      and t.status = 'running'
      and m.round = t.current_round
      and t.round_ends_at > now()
      and m.winner_post_id is null
      and m.post_a is not null
      and m.post_b is not null
  );
$$;

-- Seeds a theme's posted images into a bracket and opens round 1, closing the theme's entries if they were still
-- open. Does nothing if the theme already has a bracket.
create function public.start_tournament(target_theme bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  entries uuid[];
  entry_total integer;
  size integer := 1;
  -- Seed positions in bracket order, so that 1 meets the lowest seed and 1 and 2 can only meet in the final.
  seeds integer[] := array[1];
  next_seeds integer[];
  seed integer;
  hours integer;
begin
  if exists (select 1 from public.tournaments where theme_id = target_theme) then
    return;
  end if;
  update public.themes
  set closes_at = greatest(opens_at + interval '1 second', least(closes_at, now()))
  where id = target_theme;

  select array_agg(id order by score desc, posted_at), count(*)
  into entries, entry_total
  from public.posts
  where theme_id = target_theme and posted_at is not null;

  if entry_total = 0 then
    return;
  end if;
  if entry_total = 1 then
    insert into public.tournaments (theme_id, status, bracket_size, entry_count, champion_post_id, finished_at)
    values (target_theme, 'finished', 1, 1, entries[1], now());
    return;
  end if;

  while size < entry_total loop
    next_seeds := '{}';
    foreach seed in array seeds loop
      next_seeds := next_seeds || seed || (size * 2 + 1 - seed);
    end loop;
    seeds := next_seeds;
    size := size * 2;
  end loop;

  select round_hours into hours from public.app_settings;
  insert into public.tournaments (theme_id, bracket_size, entry_count, round_ends_at)
  values (target_theme, size, entry_total, now() + make_interval(hours => hours));

  -- The first seed of each pair always has an image; a second seed past the entry count is a bye.
  for i in 1 .. size / 2 loop
    insert into public.matches (theme_id, round, slot, post_a, seed_a, post_b, seed_b, winner_post_id)
    values (
      target_theme, 1, i,
      entries[seeds[2 * i - 1]], seeds[2 * i - 1],
      entries[seeds[2 * i]], case when seeds[2 * i] <= entry_total then seeds[2 * i] end,
      case when seeds[2 * i] > entry_total then entries[seeds[2 * i - 1]] end
    );
  end loop;
end;
$$;

-- Decides every matchup in a bracket's current round, then opens the next round or crowns the champion.
-- More votes wins; a tie goes to the higher seed.
create function public.close_round(target_theme bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tournaments;
  m public.matches;
  winner uuid;
  winners uuid[] := '{}';
  winner_seeds integer[] := '{}';
  hours integer;
begin
  select * into t from public.tournaments where theme_id = target_theme and status = 'running' for update;
  if not found then
    return;
  end if;

  for m in
    select * from public.matches where theme_id = target_theme and round = t.current_round order by slot for update
  loop
    winner := coalesce(m.winner_post_id, case
      when m.post_a is null then m.post_b
      when m.post_b is null then m.post_a
      when m.votes_a > m.votes_b then m.post_a
      when m.votes_b > m.votes_a then m.post_b
      when m.seed_a <= m.seed_b then m.post_a
      else m.post_b
    end);
    if m.winner_post_id is null then
      update public.matches set winner_post_id = winner where id = m.id;
    end if;
    winners := array_append(winners, winner);
    winner_seeds := array_append(winner_seeds, case when winner = m.post_a then m.seed_a when winner = m.post_b then m.seed_b end);
  end loop;

  if cardinality(winners) <= 1 then
    update public.tournaments
    set status = 'finished', champion_post_id = winners[1], round_ends_at = null, finished_at = now()
    where theme_id = target_theme;
    return;
  end if;

  select round_hours into hours from public.app_settings;
  update public.tournaments
  set current_round = current_round + 1, round_ends_at = now() + make_interval(hours => hours)
  where theme_id = target_theme;

  for i in 1 .. cardinality(winners) / 2 loop
    insert into public.matches (theme_id, round, slot, post_a, seed_a, post_b, seed_b, winner_post_id)
    values (
      target_theme, t.current_round + 1, i,
      winners[2 * i - 1], winner_seeds[2 * i - 1],
      winners[2 * i], winner_seeds[2 * i],
      case when winners[2 * i - 1] is null then winners[2 * i] when winners[2 * i] is null then winners[2 * i - 1] end
    );
  end loop;
end;
$$;

revoke execute on function public.start_tournament(bigint) from public, anon, authenticated;
revoke execute on function public.close_round(bigint) from public, anon, authenticated;

-- Starts brackets for themes whose entries have closed and closes rounds whose time is up. It only does what the clock
-- says is due, so it is safe for anyone to call; pg_cron runs it every minute and the app calls it before showing brackets.
create or replace function public.advance_tournaments()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target bigint;
begin
  perform pg_advisory_xact_lock(hashtext('public.advance_tournaments'));

  for target in
    select th.id
    from public.themes th
    where th.closes_at <= now()
      and not exists (select 1 from public.tournaments t where t.theme_id = th.id)
      and exists (select 1 from public.posts p where p.theme_id = th.id and p.posted_at is not null)
    order by th.closes_at
  loop
    perform public.start_tournament(target);
  end loop;

  for target in
    select theme_id from public.tournaments where status = 'running' and round_ends_at <= now() order by theme_id
  loop
    perform public.close_round(target);
  end loop;
end;
$$;

-- Admin controls, by theme. All of them check public.is_admin() first.
create function public.admin_start_tournament(target_theme bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  perform public.start_tournament(target_theme);
end;
$$;

-- Ending a round early also works on a paused bracket, which then carries on running.
create function public.admin_close_round(target_theme bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  update public.tournaments set status = 'running', paused_at = null where theme_id = target_theme and status = 'paused';
  perform public.close_round(target_theme);
end;
$$;

create function public.admin_pause_tournament(target_theme bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  update public.tournaments set status = 'paused', paused_at = now() where theme_id = target_theme and status = 'running';
end;
$$;

-- The round gets back the time it had left when it was paused.
create function public.admin_resume_tournament(target_theme bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  update public.tournaments
  set status = 'running', round_ends_at = greatest(round_ends_at, paused_at) + (now() - paused_at), paused_at = null
  where theme_id = target_theme and status = 'paused';
end;
$$;

-- Sets when the current round closes; a time in the past closes it within a minute.
create function public.admin_set_round_end(target_theme bigint, ends_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  update public.tournaments set round_ends_at = ends_at where theme_id = target_theme and status in ('running', 'paused');
end;
$$;

-- Plays out every remaining round at once: matchups go to the side with more votes, ties and new matchups to the higher seed.
create function public.admin_finish_tournament(target_theme bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  update public.tournaments set status = 'running', paused_at = null where theme_id = target_theme and status = 'paused';
  -- A bracket has at most a few dozen rounds; the limit only guards against looping forever.
  for i in 1 .. 64 loop
    exit when not exists (select 1 from public.tournaments where theme_id = target_theme and status = 'running');
    perform public.close_round(target_theme);
  end loop;
end;
$$;

create function public.admin_cancel_tournament(target_theme bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  update public.tournaments
  set status = 'cancelled', round_ends_at = null, paused_at = null, finished_at = now()
  where theme_id = target_theme and status in ('running', 'paused');
end;
$$;

-- Decides a matchup in the current round for side 'a' or 'b' right away, or reopens it to voting with null.
create or replace function public.admin_set_match_winner(target_match uuid, side text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches;
begin
  perform public.require_admin();
  select m2.* into m
  from public.matches m2
  join public.tournaments t on t.theme_id = m2.theme_id
  where m2.id = target_match and t.status in ('running', 'paused') and m2.round = t.current_round
  for update of m2;
  if not found then
    raise exception 'Only matchups in a bracket''s current round can be changed.';
  end if;
  if side is null and (m.post_a is null or m.post_b is null) then
    raise exception 'A matchup with only one image cannot be reopened.';
  end if;
  update public.matches
  set winner_post_id = case side when 'a' then m.post_a when 'b' then m.post_b end
  where id = target_match;
end;
$$;

revoke execute on function public.admin_start_tournament(bigint) from public, anon;
revoke execute on function public.admin_close_round(bigint) from public, anon;
revoke execute on function public.admin_pause_tournament(bigint) from public, anon;
revoke execute on function public.admin_resume_tournament(bigint) from public, anon;
revoke execute on function public.admin_set_round_end(bigint, timestamptz) from public, anon;
revoke execute on function public.admin_finish_tournament(bigint) from public, anon;
revoke execute on function public.admin_cancel_tournament(bigint) from public, anon;
grant execute on function public.admin_start_tournament(bigint) to authenticated;
grant execute on function public.admin_close_round(bigint) to authenticated;
grant execute on function public.admin_pause_tournament(bigint) to authenticated;
grant execute on function public.admin_resume_tournament(bigint) to authenticated;
grant execute on function public.admin_set_round_end(bigint, timestamptz) to authenticated;
grant execute on function public.admin_finish_tournament(bigint) to authenticated;
grant execute on function public.admin_cancel_tournament(bigint) to authenticated;
