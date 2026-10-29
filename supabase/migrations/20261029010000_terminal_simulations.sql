-- The terminal simulator uses the project's existing service role, never a member's session.
create or replace function public.admin_demo_user(target_user text) returns boolean language sql stable security definer set search_path = '' as $$
  select (public.is_admin() or auth.role()='service_role') and exists(select 1 from auth.users u where u.id::text=target_user and coalesce(btrim(u.email),'')=''
    and not exists(select 1 from public.admins a where a.user_id=u.id));
$$;
create or replace function public.admin_simulation_users() returns table(id uuid,first_name text,last_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not(public.is_admin() or auth.role()='service_role') then raise exception 'Only admins can simulate tournaments.' using errcode='42501'; end if;
  return query select p.id,p.first_name,p.last_name from public.profiles p where public.admin_demo_user(p.id::text) order by p.created_at,p.id;
end; $$;

create function public.admin_start_simulation(target_run uuid) returns void language plpgsql security definer set search_path = '' as $$
declare run public.simulation_runs;
begin
  if not(public.is_admin() or auth.role()='service_role') then raise exception 'Only admins can simulate tournaments.' using errcode='42501'; end if;
  select * into strict run from public.simulation_runs where id=target_run for update;
  if exists(select 1 from unnest(run.participants) u(id) where not public.admin_demo_user(u.id::text))
    or (select count(distinct user_id) from public.posts where theme_id=run.theme_id and posted_at is not null) <> cardinality(run.participants) then
    raise exception 'Every designated demo account must submit before the bracket starts.';
  end if;
  perform public.start_tournament(run.theme_id);
end; $$;

create or replace function public.admin_simulate_round(target_run uuid) returns void language plpgsql security definer set search_path = '' as $$
declare run public.simulation_runs; bracket public.tournaments; voter uuid; matchup record; position integer;
begin
  if not(public.is_admin() or auth.role()='service_role') then raise exception 'Only admins can simulate tournaments.' using errcode='42501'; end if;
  select * into strict run from public.simulation_runs where id=target_run for update;
  select * into strict bracket from public.tournaments where theme_id=run.theme_id for update;
  if bracket.status <> 'running' or bracket.round_ends_at <= now() then raise exception 'This demo round is not open.'; end if;
  if (select count(distinct user_id) from public.posts where theme_id=run.theme_id and posted_at is not null) <> cardinality(run.participants) then
    raise exception 'Wait until every demo participant has submitted before ending rounds.';
  end if;
  if exists(select 1 from unnest(run.participants) u(id) where not public.admin_demo_user(u.id::text)) then
    raise exception 'A demo participant now has an email or is an admin. No votes were changed.';
  end if;
  for matchup in select * from public.matches where theme_id=run.theme_id and round=bracket.current_round
    and post_a is not null and post_b is not null and winner_post_id is null order by slot loop
    position := 0;
    foreach voter in array run.participants loop
      position := position+1;
      insert into public.match_votes(match_id,user_id,side)
      values(matchup.id,voter,case when ((position+matchup.slot+bracket.current_round)%3=0) <> ((matchup.slot+bracket.current_round)%2=0) then 'b' else 'a' end)
      on conflict(match_id,user_id) do update set side=excluded.side;
    end loop;
  end loop;
  perform public.close_round(run.theme_id);
end; $$;
revoke all on function public.admin_start_simulation(uuid) from public,anon;
grant execute on function public.admin_start_simulation(uuid) to authenticated,service_role;
grant execute on function public.admin_demo_user(text), public.admin_simulation_users(),public.admin_simulate_round(uuid) to service_role;
