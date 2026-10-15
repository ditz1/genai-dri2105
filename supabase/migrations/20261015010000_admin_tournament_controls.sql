-- More admin control over brackets: pause and resume, change how long the current round has left, decide or reopen
-- a matchup by hand, finish a bracket at once, or cancel it. All of these check public.is_admin().

-- A paused bracket keeps its place but takes no votes and its clock stops; a cancelled one is hidden and never restarts.
alter table public.tournaments drop constraint tournaments_status_check;
alter table public.tournaments add constraint tournaments_status_check check (status in ('running', 'paused', 'finished', 'cancelled'));
alter table public.tournaments add column paused_at timestamptz;

create function public.require_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can manage tournaments.' using errcode = '42501';
  end if;
end;
$$;

revoke execute on function public.require_admin() from public, anon, authenticated;

-- Ending a round early also works on a paused bracket, which then carries on running.
create or replace function public.admin_close_round(target_day date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  update public.tournaments set status = 'running', paused_at = null where day = target_day and status = 'paused';
  perform public.close_round(target_day);
end;
$$;

create function public.admin_pause_tournament(target_day date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  update public.tournaments set status = 'paused', paused_at = now() where day = target_day and status = 'running';
end;
$$;

-- The round gets back the time it had left when it was paused.
create function public.admin_resume_tournament(target_day date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  update public.tournaments
  set status = 'running', round_ends_at = greatest(round_ends_at, paused_at) + (now() - paused_at), paused_at = null
  where day = target_day and status = 'paused';
end;
$$;

-- Sets when the current round closes; a time in the past closes it within a minute.
create function public.admin_set_round_end(target_day date, ends_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  update public.tournaments set round_ends_at = ends_at where day = target_day and status in ('running', 'paused');
end;
$$;

-- Decides a matchup in the current round for side 'a' or 'b' right away, or reopens it to voting with null.
create function public.admin_set_match_winner(target_match uuid, side text)
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
  join public.tournaments t on t.day = m2.tournament_day
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

-- Plays out every remaining round at once: matchups go to the side with more votes, ties and new matchups to the higher seed.
create function public.admin_finish_tournament(target_day date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  update public.tournaments set status = 'running', paused_at = null where day = target_day and status = 'paused';
  -- A bracket has at most a few dozen rounds; the limit only guards against looping forever.
  for i in 1 .. 64 loop
    exit when not exists (select 1 from public.tournaments where day = target_day and status = 'running');
    perform public.close_round(target_day);
  end loop;
end;
$$;

create function public.admin_cancel_tournament(target_day date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  update public.tournaments
  set status = 'cancelled', round_ends_at = null, paused_at = null, finished_at = now()
  where day = target_day and status in ('running', 'paused');
end;
$$;

revoke execute on function public.admin_pause_tournament(date) from public, anon;
revoke execute on function public.admin_resume_tournament(date) from public, anon;
revoke execute on function public.admin_set_round_end(date, timestamptz) from public, anon;
revoke execute on function public.admin_set_match_winner(uuid, text) from public, anon;
revoke execute on function public.admin_finish_tournament(date) from public, anon;
revoke execute on function public.admin_cancel_tournament(date) from public, anon;
grant execute on function public.admin_pause_tournament(date) to authenticated;
grant execute on function public.admin_resume_tournament(date) to authenticated;
grant execute on function public.admin_set_round_end(date, timestamptz) to authenticated;
grant execute on function public.admin_set_match_winner(uuid, text) to authenticated;
grant execute on function public.admin_finish_tournament(date) to authenticated;
grant execute on function public.admin_cancel_tournament(date) to authenticated;
