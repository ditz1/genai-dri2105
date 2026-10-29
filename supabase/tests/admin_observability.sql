-- Run after the 20261029 migrations. Every fixture and configuration change is rolled back.
begin;
select set_config('test.admin_id',(select user_id::text from public.admins limit 1),true);
select set_config('test.member_id',(select p.id::text from public.profiles p join auth.users u on u.id=p.id
  where coalesce(u.email,'')<>'' and not exists(select 1 from public.admins a where a.user_id=p.id) limit 1),true);
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.admin_id'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare v_provider uuid; v_model uuid; v_example uuid; v_domain uuid; v_email uuid; begin
  assert public.is_admin(), 'Expected an admin test session.';
  insert into public.llm_providers(name,adapter) values('Rollback test provider','catalogue') returning id into v_provider;
  update public.llm_providers set name='Updated rollback provider' where id=v_provider;
  insert into public.llm_models(provider_id,name,model_key,capability,output_format)
    values(v_provider,'Rollback model','@cf/test/rollback','theme','json') returning id into v_model;
  update public.llm_models set name='Updated model' where id=v_model;
  insert into public.ai_generation_examples(title,prompt) values('Rollback example','An imagined garden') returning id into v_example;
  update public.ai_generation_examples set notes='Updated example' where id=v_example;
  insert into public.allowed_signup_domains(domain) values('rollback-test.example') returning id into v_domain;
  update public.allowed_signup_domains set domain='updated-rollback.example' where id=v_domain;
  insert into public.whitelisted_emails(email) values('rollback@example.test') returning id into v_email;
  update public.whitelisted_emails set email='updated-rollback@example.test' where id=v_email;
  assert exists(select 1 from public.llm_models where id=v_model and name='Updated model');
  assert exists(select 1 from public.ai_generation_examples where id=v_example and notes='Updated example');
  assert exists(select 1 from public.allowed_signup_domains where id=v_domain and domain='updated-rollback.example');
  assert exists(select 1 from public.whitelisted_emails where id=v_email and email='updated-rollback@example.test');
  delete from public.ai_generation_examples where id=v_example;
  delete from public.llm_models where id=v_model;
  delete from public.llm_providers where id=v_provider;
  delete from public.allowed_signup_domains where id=v_domain;
  delete from public.whitelisted_emails where id=v_email;
  begin
    delete from public.llm_models where id=(select image_model_id from public.app_settings);
    raise exception 'Active models must not be deletable.';
  exception when foreign_key_violation then null; end;
  begin
    update public.llm_models set enabled=false where id=(select image_model_id from public.app_settings);
    raise exception 'Active models must not be disabled.';
  exception when raise_exception then
    if sqlerrm not like 'Select a different active model%' then raise; end if;
  end;
  assert (select count(*) from public.admin_simulation_users()) >= 2, 'Demo users should be visible to admins.';
end $$;

reset role;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.member_id'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  assert not public.is_admin();
  assert not exists(select 1 from public.llm_responses), 'Responses leaked to a non-admin.';
  assert not exists(select 1 from public.generation_requests where user_id<>auth.uid() or user_id is null), 'Other members requests leaked.';
  assert not exists(select 1 from public.allowed_signup_domains), 'Signup domains leaked.';
  assert not exists(select 1 from public.whitelisted_emails), 'Whitelisted emails leaked.';
  assert not exists(select 1 from public.simulation_runs), 'Demo controls leaked.';
  begin
    insert into public.llm_providers(name) values('Unauthorized provider');
    raise exception 'Non-admin provider writes must fail.';
  exception when insufficient_privilege then null; end;
  begin
    perform public.admin_simulation_users();
    raise exception 'Non-admin simulations must fail.';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$ begin
  begin
    perform 1 from public.generation_requests;
    raise exception 'Anonymous generation history must fail.';
  exception when insufficient_privilege then null; end;
  begin
    perform public.admin_simulate_round(gen_random_uuid());
    raise exception 'Anonymous simulation execution must fail.';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
-- Signup checks are trigger-level checks, so they also cover direct Auth API registrations.
update public.app_settings set restrict_signups=true;
insert into public.allowed_signup_domains(domain) values('rollback-signup.example');
insert into public.whitelisted_emails(email) values('explicit@rollback-other.example');
insert into auth.users(id,email) values(gen_random_uuid(),'member@rollback-signup.example'),(gen_random_uuid(),'explicit@rollback-other.example');
do $$ begin
  begin
    insert into auth.users(id,email) values(gen_random_uuid(),'blocked@rollback-other.example');
    raise exception 'Unapproved signup must fail.';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
select 'Admin CRUD, model guards, private history, simulation permissions and signup checks passed.' as result;
