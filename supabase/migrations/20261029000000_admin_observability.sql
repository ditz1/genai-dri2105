-- Model configuration, private generation history, signup lists and isolated demo tournaments.
create table public.llm_providers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(btrim(name)) between 1 and 80),
  adapter text not null default 'catalogue' check (adapter in ('cloudflare', 'catalogue')),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.llm_models (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.llm_providers(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  model_key text not null check (char_length(model_key) between 1 and 200 and model_key ~ '^[@a-zA-Z0-9/_.-]+$'),
  capability text not null check (capability in ('image', 'theme')),
  output_format text not null check (output_format in ('image-base64', 'image-binary', 'json')),
  parameters jsonb not null default '{}' check (jsonb_typeof(parameters) = 'object' and octet_length(parameters::text) <= 2000),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique(provider_id, model_key),
  check ((capability = 'theme' and output_format = 'json') or (capability = 'image' and output_format <> 'json'))
);

insert into public.llm_providers(name, adapter) values ('Cloudflare Workers AI', 'cloudflare');
insert into public.llm_models(provider_id, name, model_key, capability, output_format, parameters)
select id, 'FLUX.1 Schnell', '@cf/black-forest-labs/flux-1-schnell', 'image', 'image-base64', '{"steps":4}' from public.llm_providers;
insert into public.llm_models(provider_id, name, model_key, capability, output_format, parameters)
select id, 'Stable Diffusion XL', '@cf/stabilityai/stable-diffusion-xl-base-1.0', 'image', 'image-binary', '{"num_steps":20}' from public.llm_providers;
insert into public.llm_models(provider_id, name, model_key, capability, output_format, parameters)
select id, 'Llama 3.3 70B', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', 'theme', 'json', '{"max_tokens":256}' from public.llm_providers;

alter table public.app_settings
  add column image_model_id uuid references public.llm_models(id) on delete restrict,
  add column theme_model_id uuid references public.llm_models(id) on delete restrict,
  add column image_prompt_prefix text not null default '' check (char_length(image_prompt_prefix) <= 500),
  add column theme_instructions text not null default '' check (char_length(theme_instructions) <= 1000),
  add column restrict_signups boolean not null default false;
update public.app_settings set
  image_model_id = (select id from public.llm_models where model_key = '@cf/black-forest-labs/flux-1-schnell'),
  theme_model_id = (select id from public.llm_models where model_key = '@cf/meta/llama-3.3-70b-instruct-fp8-fast');
alter table public.app_settings alter column image_model_id set not null, alter column theme_model_id set not null;
grant update(image_model_id, theme_model_id, image_prompt_prefix, theme_instructions, restrict_signups) on public.app_settings to authenticated;

create function public.validate_active_models() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'app_settings' then
    if not exists (select 1 from public.llm_models m join public.llm_providers p on p.id=m.provider_id
      where m.id=new.image_model_id and m.capability='image' and m.enabled and p.enabled and p.adapter='cloudflare')
    or not exists (select 1 from public.llm_models m join public.llm_providers p on p.id=m.provider_id
      where m.id=new.theme_model_id and m.capability='theme' and m.enabled and p.enabled and p.adapter='cloudflare') then
      raise exception 'Choose enabled Cloudflare models for image and theme generation.';
    end if;
  elsif tg_table_name = 'llm_models' then
    if exists (select 1 from public.app_settings s where
      (s.image_model_id=new.id and (not new.enabled or new.capability <> 'image')) or
      (s.theme_model_id=new.id and (not new.enabled or new.capability <> 'theme'))) then
      raise exception 'Select a different active model before disabling this model or changing its capability.';
    end if;
    if exists(select 1 from public.app_settings s where new.id in (s.image_model_id,s.theme_model_id))
      and not exists(select 1 from public.llm_providers p where p.id=new.provider_id and p.enabled and p.adapter='cloudflare') then
      raise exception 'An active model needs an enabled Cloudflare provider.';
    end if;
  elsif tg_table_name = 'llm_providers' then
    if (not new.enabled or new.adapter <> 'cloudflare') and exists (
      select 1 from public.llm_models m cross join public.app_settings s where m.provider_id=new.id and m.id in(s.image_model_id,s.theme_model_id)) then
      raise exception 'Select models from another provider before disabling this provider.';
    end if;
  end if;
  return new;
end; $$;
revoke all on function public.validate_active_models() from public, anon, authenticated;
create trigger validate_settings_models before update on public.app_settings for each row execute function public.validate_active_models();
create trigger validate_model_changes before update on public.llm_models for each row execute function public.validate_active_models();
create trigger validate_provider_changes before update on public.llm_providers for each row execute function public.validate_active_models();

create table public.generation_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid default auth.uid() references public.profiles(id) on delete set null,
  theme_id bigint references public.themes(id) on delete set null,
  post_id uuid references public.posts(id) on delete set null,
  kind text not null check (kind in ('image', 'theme')),
  prompt text not null,
  model text not null,
  provider text not null,
  input jsonb not null default '{}',
  status text not null default 'pending' check(status in ('pending','succeeded','failed')),
  error_message text,
  duration_ms integer,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index generation_requests_created_idx on public.generation_requests(created_at desc);
create index generation_requests_user_idx on public.generation_requests(user_id,created_at desc);
create table public.llm_responses (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.generation_requests(id) on delete cascade,
  output jsonb not null,
  created_at timestamptz not null default now()
);

create table public.ai_generation_examples (
  id uuid primary key default gen_random_uuid(),
  title text not null check(char_length(btrim(title)) between 1 and 80),
  prompt text not null check(char_length(btrim(prompt)) between 1 and 500),
  notes text not null default '' check(char_length(notes) <= 1000),
  post_id uuid references public.posts(id) on delete set null,
  created_at timestamptz not null default now()
);
create table public.allowed_signup_domains (
  id uuid primary key default gen_random_uuid(),
  domain text not null unique check(domain=lower(btrim(domain)) and char_length(domain)<=253 and domain ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$' and domain not like '%..%'),
  created_at timestamptz not null default now()
);
create table public.whitelisted_emails (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check(email=lower(btrim(email)) and char_length(email)<=254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  created_at timestamptz not null default now()
);

-- No keys, tokens or endpoints are stored in the provider catalogue.
do $$ declare tab text; begin
  foreach tab in array array['llm_providers','llm_models','ai_generation_examples','allowed_signup_domains','whitelisted_emails'] loop
    execute format('alter table public.%I enable row level security',tab);
    execute format('revoke all on public.%I from anon, authenticated',tab);
    execute format('grant select,insert,update,delete on public.%I to authenticated',tab);
    execute format('create policy "Admins manage records" on public.%I for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))',tab);
  end loop;
end $$;
grant select on public.llm_models,public.llm_providers to anon;
create policy "Model configuration is readable" on public.llm_models for select to anon,authenticated using(true);
create policy "Provider configuration is readable" on public.llm_providers for select to anon,authenticated using(true);

alter table public.generation_requests enable row level security;
alter table public.llm_responses enable row level security;
revoke all on public.generation_requests,public.llm_responses from anon,authenticated;
grant select on public.generation_requests,public.llm_responses to authenticated;
grant insert(user_id,theme_id,kind,prompt,model,provider,input) on public.generation_requests to authenticated;
grant update(post_id) on public.generation_requests to authenticated;
create policy "Members read their requests and admins read all" on public.generation_requests for select to authenticated using(user_id=(select auth.uid()) or (select public.is_admin()));
create policy "Members record their requests" on public.generation_requests for insert to authenticated with check(user_id=(select auth.uid()) or (select public.is_admin()));
create policy "Members attach their generated posts" on public.generation_requests for update to authenticated
  using(user_id=(select auth.uid()) or (select public.is_admin()))
  with check((user_id=(select auth.uid()) or (select public.is_admin())) and exists(select 1 from public.posts p where p.id=post_id and p.user_id=generation_requests.user_id));
create policy "Admins read responses" on public.llm_responses for select to authenticated using((select public.is_admin()));

create function public.complete_generation_request(target_request uuid, succeeded boolean, response_output jsonb, elapsed_ms integer, failure text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.generation_requests set status=case when succeeded then 'succeeded' else 'failed' end,
    error_message=left(failure,2000),duration_ms=greatest(0,elapsed_ms),completed_at=now()
  where id=target_request and status='pending' and (user_id=(select auth.uid()) or public.is_admin() or auth.role()='service_role');
  if not found then raise exception 'Generation request is unavailable.' using errcode='42501'; end if;
  insert into public.llm_responses(request_id,output) values(target_request,response_output);
end; $$;
revoke all on function public.complete_generation_request(uuid,boolean,jsonb,integer,text) from public,anon;
grant execute on function public.complete_generation_request(uuid,boolean,jsonb,integer,text) to authenticated,service_role;

-- Applies only to new accounts. Existing members can continue signing in.
create function public.check_signup_allowlist() returns trigger language plpgsql security definer set search_path = '' as $$
declare address text := lower(btrim(coalesce(new.email,'')));
begin
  if (select restrict_signups from public.app_settings) and not exists(select 1 from public.whitelisted_emails where email=address)
    and not exists(select 1 from public.allowed_signup_domains where domain=split_part(address,'@',2)) then
    raise exception 'Registration is limited to approved email addresses or domains.' using errcode='42501';
  end if;
  return new;
end; $$;
revoke all on function public.check_signup_allowlist() from public,anon,authenticated;
create trigger check_signup_allowlist before insert on auth.users for each row execute function public.check_signup_allowlist();

create policy "Admins read every post including drafts" on public.posts for select to authenticated using((select public.is_admin()));
create policy "Admins remove generated media" on storage.objects for delete to authenticated using(bucket_id='generations' and (select public.is_admin()));
create policy "Admins read generated media" on storage.objects for select to authenticated using(bucket_id='generations' and (select public.is_admin()));

create table public.simulation_runs (
  id uuid primary key default gen_random_uuid(),
  theme_id bigint not null unique references public.themes(id) on delete cascade,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  participants uuid[] not null check(cardinality(participants) between 2 and 8),
  created_at timestamptz not null default now()
);
alter table public.simulation_runs enable row level security;
revoke all on public.simulation_runs from anon,authenticated;
grant select,insert on public.simulation_runs to authenticated;
create policy "Admins manage simulations" on public.simulation_runs for all to authenticated using((select public.is_admin())) with check((select public.is_admin()));

create function public.guard_simulation_data() returns trigger language plpgsql security definer set search_path = '' as $$
declare participants uuid[];
begin
  if tg_table_name='simulation_runs' then
    if exists(select 1 from unnest(new.participants) p(id) left join auth.users u on u.id=p.id
      where u.id is null or coalesce(btrim(u.email),'')<>'' or exists(select 1 from public.admins a where a.user_id=p.id))
      or (select count(distinct id) from unnest(new.participants) p(id)) <> cardinality(new.participants) then
      raise exception 'Simulations require distinct test users without email addresses.';
    end if;
  else
    select s.participants into participants from public.simulation_runs s where s.theme_id=new.theme_id;
    if found then
      if not(new.user_id=any(participants)) or exists(select 1 from auth.users u where u.id=new.user_id and coalesce(btrim(u.email),'')<>'')
        or exists(select 1 from public.admins a where a.user_id=new.user_id) then
        raise exception 'This theme accepts only its designated demo accounts.';
      end if;
      perform pg_advisory_xact_lock(hashtextextended(new.theme_id::text || new.user_id::text,0));
      if exists(select 1 from public.posts p where p.theme_id=new.theme_id and p.user_id=new.user_id and p.id<>new.id) then
        raise exception 'This demo account already has a submission.';
      end if;
    end if;
  end if;
  return new;
end; $$;
revoke all on function public.guard_simulation_data() from public,anon,authenticated;
create trigger guard_simulation_users before insert on public.simulation_runs for each row execute function public.guard_simulation_data();
create trigger guard_demo_submissions before insert or update of theme_id,user_id on public.posts for each row execute function public.guard_simulation_data();

create function public.admin_demo_user(target_user text) returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_admin() and exists(select 1 from auth.users u where u.id::text=target_user and coalesce(btrim(u.email),'')=''
    and not exists(select 1 from public.admins a where a.user_id=u.id));
$$;
revoke all on function public.admin_demo_user(text) from public,anon;
grant execute on function public.admin_demo_user(text) to authenticated;
create function public.admin_simulation_users() returns table(id uuid,first_name text,last_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Only admins can simulate tournaments.' using errcode='42501'; end if;
  return query select p.id,p.first_name,p.last_name from public.profiles p where public.admin_demo_user(p.id::text) order by p.created_at,p.id;
end; $$;
revoke all on function public.admin_simulation_users() from public,anon;
grant execute on function public.admin_simulation_users() to authenticated;
grant insert(user_id,posted_at,caption) on public.posts to authenticated;
create policy "Admins submit demo entries" on public.posts for insert to authenticated with check(
  public.admin_demo_user(user_id::text) and (storage.foldername(image_path))[1]=user_id::text and public.theme_is_open(theme_id)
  and exists(select 1 from public.simulation_runs s where s.theme_id=posts.theme_id and posts.user_id=any(s.participants)));
create policy "Admins upload demo art" on storage.objects for insert to authenticated
  with check(bucket_id='generations' and public.admin_demo_user((storage.foldername(name))[1]));

-- Cast actual fake-user votes, then explicitly close just this demo's current round.
create function public.admin_simulate_round(target_run uuid) returns void language plpgsql security definer set search_path = '' as $$
declare run public.simulation_runs; bracket public.tournaments; voter uuid; matchup record; position integer;
begin
  if not public.is_admin() then raise exception 'Only admins can simulate tournaments.' using errcode='42501'; end if;
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
  perform public.admin_close_round(run.theme_id);
end; $$;
revoke all on function public.admin_simulate_round(uuid) from public,anon;
grant execute on function public.admin_simulate_round(uuid) to authenticated;
