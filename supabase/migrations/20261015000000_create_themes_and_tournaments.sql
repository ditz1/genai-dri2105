-- Daily themes and image tournaments. Each day has a theme; the images posted for it that day are seeded into a
-- bracket when the day ends, and members vote on each head-to-head matchup until one image is left.
-- Everything here is added alongside the existing tables; no existing rows are changed or removed.

-- Members who can use the admin panel. Not readable through the API; the app asks public.is_admin() instead.
create table public.admins (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;

insert into public.admins (user_id)
select id from auth.users where email = 'danielitzler@gmail.com'
on conflict (user_id) do nothing;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()));
$$;

-- A single row of settings the admin can change.
create table public.app_settings (
  id boolean primary key default true check (id),
  -- Theme days start and end at midnight in this time zone.
  timezone text not null default 'America/New_York' check (timestamptz '2000-01-01 00:00Z' at time zone timezone is not null),
  -- How long members can vote in each round of a bracket.
  round_hours integer not null default 24 check (round_hours between 1 and 168),
  updated_at timestamptz not null default now()
);

insert into public.app_settings default values;

alter table public.app_settings enable row level security;

revoke all on public.app_settings from anon, authenticated;
grant select on public.app_settings to anon, authenticated;
grant update (timezone, round_hours, updated_at) on public.app_settings to authenticated;

create policy "Settings are readable by everyone"
  on public.app_settings for select
  to anon, authenticated
  using (true);

create policy "Admins can change settings"
  on public.app_settings for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Today's date in the settings' time zone.
create function public.current_theme_day()
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone (select timezone from public.app_settings))::date;
$$;

-- One theme per day. The app asks Gemini for one the first time it is needed; admins can rewrite it or schedule
-- themes for later days, which stay hidden from everyone else until their day comes.
create table public.daily_themes (
  day date primary key,
  title text not null check (char_length(title) between 1 and 80),
  description text not null default '' check (char_length(description) <= 400),
  -- The model that suggested the theme, or null when an admin wrote it.
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.daily_themes enable row level security;

revoke all on public.daily_themes from anon, authenticated;
grant select on public.daily_themes to anon, authenticated;
grant insert (day, title, description, model) on public.daily_themes to authenticated;
grant update (title, description, model, updated_at) on public.daily_themes to authenticated;
grant delete on public.daily_themes to authenticated;

create policy "Themes are readable once their day comes, and always by admins"
  on public.daily_themes for select
  to anon, authenticated
  using (day <= (select public.current_theme_day()) or (select public.is_admin()));

create policy "Admins can add themes"
  on public.daily_themes for insert
  to authenticated
  with check ((select public.is_admin()));

create policy "Admins can change themes"
  on public.daily_themes for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Admins can remove themes"
  on public.daily_themes for delete
  to authenticated
  using ((select public.is_admin()));

-- Each image belongs to the theme of the day it was generated. Images made before themes existed keep a null day
-- and never enter a bracket.
alter table public.posts add column theme_day date;

create index posts_theme_day_idx on public.posts (theme_day) where theme_day is not null;

create function public.set_post_theme_day()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.theme_day := public.current_theme_day();
  return new;
end;
$$;

revoke execute on function public.set_post_theme_day() from public, anon, authenticated;

create trigger on_post_created
  before insert on public.posts
  for each row execute function public.set_post_theme_day();

create policy "Admins can delete any post"
  on public.posts for delete
  to authenticated
  using ((select public.is_admin()));

-- Removing a file through the Storage API needs both select and delete.
create policy "Admins can read generated files"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'generations' and (select public.is_admin()));

create policy "Admins can delete generated files"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'generations' and (select public.is_admin()));

-- One bracket per theme day, made from the images posted for that theme.
create table public.tournaments (
  day date primary key,
  status text not null default 'running' check (status in ('running', 'finished')),
  -- Entries rounded up to a power of two; the top seeds get byes into round 2 when the count falls short.
  bracket_size integer not null,
  entry_count integer not null,
  current_round integer not null default 1,
  round_ends_at timestamptz,
  champion_post_id uuid references public.posts (id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index tournaments_running_idx on public.tournaments (round_ends_at) where status = 'running';

alter table public.tournaments enable row level security;

revoke all on public.tournaments from anon, authenticated;
grant select on public.tournaments to anon, authenticated;
grant delete on public.tournaments to authenticated;

create policy "Tournaments are readable by everyone"
  on public.tournaments for select
  to anon, authenticated
  using (true);

create policy "Admins can remove tournaments"
  on public.tournaments for delete
  to authenticated
  using ((select public.is_admin()));

-- One head-to-head matchup. Slot n of a round is fed by the winners of slots 2n-1 and 2n of the round before.
-- A side is null for a bye, or when its image was deleted; the other side then wins.
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  tournament_day date not null references public.tournaments (day) on delete cascade,
  round integer not null,
  slot integer not null,
  post_a uuid references public.posts (id) on delete set null,
  post_b uuid references public.posts (id) on delete set null,
  -- Seeds come from each image's score when the bracket started (1 is the highest) and break tied votes.
  seed_a integer,
  seed_b integer,
  -- Kept current by the trigger on public.match_votes.
  votes_a integer not null default 0,
  votes_b integer not null default 0,
  winner_post_id uuid references public.posts (id) on delete set null,
  unique (tournament_day, round, slot)
);

create index matches_post_a_idx on public.matches (post_a);
create index matches_post_b_idx on public.matches (post_b);
create index matches_winner_post_id_idx on public.matches (winner_post_id);
create index tournaments_champion_post_id_idx on public.tournaments (champion_post_id);

alter table public.matches enable row level security;

revoke all on public.matches from anon, authenticated;
grant select on public.matches to anon, authenticated;

create policy "Matches are readable by everyone"
  on public.matches for select
  to anon, authenticated
  using (true);

-- Whether members can still vote on a matchup: its round is the current one and has time left, and both sides are there.
create function public.match_is_open(target_match uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.matches m
    join public.tournaments t on t.day = m.tournament_day
    where m.id = target_match
      and t.status = 'running'
      and m.round = t.current_round
      and t.round_ends_at > now()
      and m.winner_post_id is null
      and m.post_a is not null
      and m.post_b is not null
  );
$$;

-- One vote per member per matchup, for side a or b. Like post votes, only the member can see their own.
create table public.match_votes (
  match_id uuid not null references public.matches (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  side text not null check (side in ('a', 'b')),
  created_at timestamptz not null default now(),
  primary key (match_id, user_id)
);

create index match_votes_user_id_idx on public.match_votes (user_id);

alter table public.match_votes enable row level security;

revoke all on public.match_votes from anon, authenticated;
grant select, delete on public.match_votes to authenticated;
grant insert (match_id, side) on public.match_votes to authenticated;
grant update (side) on public.match_votes to authenticated;

create policy "Users can read their own match votes"
  on public.match_votes for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can vote on open matchups"
  on public.match_votes for insert
  to authenticated
  with check ((select auth.uid()) = user_id and public.match_is_open(match_id));

create policy "Users can change their vote while the matchup is open"
  on public.match_votes for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and public.match_is_open(match_id));

create policy "Users can take back their vote while the matchup is open"
  on public.match_votes for delete
  to authenticated
  using ((select auth.uid()) = user_id and public.match_is_open(match_id));

-- Keep each matchup's vote counts equal to its votes.
create function public.apply_match_vote()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' then
    update public.matches
    set votes_a = votes_a - (old.side = 'a')::int, votes_b = votes_b - (old.side = 'b')::int
    where id = old.match_id;
  end if;
  if tg_op <> 'DELETE' then
    update public.matches
    set votes_a = votes_a + (new.side = 'a')::int, votes_b = votes_b + (new.side = 'b')::int
    where id = new.match_id;
  end if;
  return null;
end;
$$;

revoke execute on function public.apply_match_vote() from public, anon, authenticated;

create trigger on_match_vote_changed
  after insert or update or delete on public.match_votes
  for each row execute function public.apply_match_vote();

-- Seeds the images posted for a theme day into a bracket and opens round 1. Does nothing if the day already has one.
create function public.start_tournament(target_day date)
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
  if exists (select 1 from public.tournaments where day = target_day) then
    return;
  end if;

  select array_agg(id order by score desc, posted_at), count(*)
  into entries, entry_total
  from public.posts
  where theme_day = target_day and posted_at is not null;

  if entry_total = 0 then
    return;
  end if;
  if entry_total = 1 then
    insert into public.tournaments (day, status, bracket_size, entry_count, champion_post_id, finished_at)
    values (target_day, 'finished', 1, 1, entries[1], now());
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
  insert into public.tournaments (day, bracket_size, entry_count, round_ends_at)
  values (target_day, size, entry_total, now() + make_interval(hours => hours));

  -- The first seed of each pair always has an image; a second seed past the entry count is a bye.
  for i in 1 .. size / 2 loop
    insert into public.matches (tournament_day, round, slot, post_a, seed_a, post_b, seed_b, winner_post_id)
    values (
      target_day, 1, i,
      entries[seeds[2 * i - 1]], seeds[2 * i - 1],
      entries[seeds[2 * i]], case when seeds[2 * i] <= entry_total then seeds[2 * i] end,
      case when seeds[2 * i] > entry_total then entries[seeds[2 * i - 1]] end
    );
  end loop;
end;
$$;

-- Decides every matchup in a bracket's current round, then opens the next round or crowns the champion.
-- More votes wins; a tie goes to the higher seed.
create function public.close_round(target_day date)
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
  select * into t from public.tournaments where day = target_day and status = 'running' for update;
  if not found then
    return;
  end if;

  for m in
    select * from public.matches where tournament_day = target_day and round = t.current_round order by slot for update
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
    where day = target_day;
    return;
  end if;

  select round_hours into hours from public.app_settings;
  update public.tournaments
  set current_round = current_round + 1, round_ends_at = now() + make_interval(hours => hours)
  where day = target_day;

  for i in 1 .. cardinality(winners) / 2 loop
    insert into public.matches (tournament_day, round, slot, post_a, seed_a, post_b, seed_b, winner_post_id)
    values (
      target_day, t.current_round + 1, i,
      winners[2 * i - 1], winner_seeds[2 * i - 1],
      winners[2 * i], winner_seeds[2 * i],
      case when winners[2 * i - 1] is null then winners[2 * i] when winners[2 * i] is null then winners[2 * i - 1] end
    );
  end loop;
end;
$$;

revoke execute on function public.start_tournament(date) from public, anon, authenticated;
revoke execute on function public.close_round(date) from public, anon, authenticated;

-- Starts brackets for theme days that have ended and closes rounds whose time is up. It only does what the clock
-- says is due, so it is safe for anyone to call; pg_cron runs it every minute and the app calls it before showing brackets.
create function public.advance_tournaments()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_day date;
begin
  perform pg_advisory_xact_lock(hashtext('public.advance_tournaments'));

  for target_day in
    select distinct p.theme_day
    from public.posts p
    where p.theme_day < public.current_theme_day()
      and p.posted_at is not null
      and not exists (select 1 from public.tournaments t where t.day = p.theme_day)
  loop
    perform public.start_tournament(target_day);
  end loop;

  for target_day in
    select day from public.tournaments where status = 'running' and round_ends_at <= now() order by day
  loop
    perform public.close_round(target_day);
  end loop;
end;
$$;

revoke execute on function public.advance_tournaments() from public;
grant execute on function public.advance_tournaments() to anon, authenticated;

-- Admin shortcuts: start a day's bracket before the day ends, or end the current round early.
create function public.admin_start_tournament(target_day date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can start a tournament.' using errcode = '42501';
  end if;
  perform public.start_tournament(target_day);
end;
$$;

create function public.admin_close_round(target_day date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can end a round.' using errcode = '42501';
  end if;
  perform public.close_round(target_day);
end;
$$;

revoke execute on function public.admin_start_tournament(date) from public, anon;
revoke execute on function public.admin_close_round(date) from public, anon;
grant execute on function public.admin_start_tournament(date) to authenticated;
grant execute on function public.admin_close_round(date) to authenticated;

-- Members with their sign-in email and activity, for the admin panel only.
create function public.admin_list_members()
returns table (id uuid, first_name text, last_name text, email text, created_at timestamptz, post_count bigint, is_admin boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can list members.' using errcode = '42501';
  end if;
  return query
  select p.id, p.first_name, p.last_name, u.email::text, p.created_at,
    (select count(*) from public.posts where posts.user_id = p.id and posts.posted_at is not null),
    exists (select 1 from public.admins a where a.user_id = p.id)
  from public.profiles p
  join auth.users u on u.id = p.id
  order by p.created_at desc;
end;
$$;

revoke execute on function public.admin_list_members() from public, anon;
grant execute on function public.admin_list_members() to authenticated;

-- Run the bracket clock every minute.
create extension if not exists pg_cron;

select cron.schedule('advance-tournaments', '* * * * *', 'select public.advance_tournaments()');
