-- Run after 20261120000000_design_sheets.sql. Every row it creates is rolled back.
begin;
select set_config('test.member_id',(select p.id::text from public.profiles p
  where not exists(select 1 from public.admins a where a.user_id=p.id) order by p.created_at,p.id limit 1),true);
select set_config('test.other_id',(select p.id::text from public.profiles p
  where not exists(select 1 from public.admins a where a.user_id=p.id) and p.id::text<>current_setting('test.member_id') order by p.created_at,p.id limit 1),true);
select set_config('test.admin_id',(select user_id::text from public.admins limit 1),true);
select set_config('test.champion',(select theme_id||':'||champion_post_id from public.tournaments
  where status='finished' and champion_post_id is not null limit 1),true);

-- A member starts sheets from scratch or from a winner, edits them, and can do nothing on anyone else's behalf.
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.member_id'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare v_sheet uuid; v_loser uuid; v_count integer;
  v_theme bigint := split_part(current_setting('test.champion'),':',1)::bigint;
  v_winner uuid := split_part(current_setting('test.champion'),':',2)::uuid;
begin
  insert into public.design_sheets(title,data) values('Rollback blank sheet','{}') returning id into v_sheet;
  assert (select user_id from public.design_sheets where id=v_sheet)=auth.uid(), 'A sheet belongs to whoever created it.';
  insert into public.design_sheets(title,data,theme_id,source_post_id) values('Rollback winner sheet','{}',v_theme,v_winner);
  update public.design_sheets set title='Renamed',data='{"title":"Renamed"}',summary='{"renders":0}',updated_at=now() where id=v_sheet;
  assert exists(select 1 from public.design_sheets where id=v_sheet and title='Renamed' and data->>'title'='Renamed');

  select p.id into v_loser from public.posts p where p.posted_at is not null
    and not exists(select 1 from public.tournaments t where t.champion_post_id=p.id) limit 1;
  if v_loser is not null then
    begin
      insert into public.design_sheets(title,data,theme_id,source_post_id) values('Not a winner','{}',v_theme,v_loser);
      raise exception 'Sheets must not start from a post that did not win its tournament.';
    exception when insufficient_privilege then null; end;
  end if;
  begin
    insert into public.design_sheets(title,data,source_post_id) values('Winner without its theme','{}',v_winner);
    raise exception 'A winner must be named together with its tournament.';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.design_sheets(user_id,title,data) values(current_setting('test.other_id')::uuid,'For someone else','{}');
    raise exception 'Members must not create sheets for other members.';
  exception when insufficient_privilege then null; end;
  begin
    update public.design_sheets set user_id=current_setting('test.other_id')::uuid where id=v_sheet;
    raise exception 'Members must not give a sheet to another member.';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.design_sheets(title,data) values('Not an object','[]');
    raise exception 'Sheet data must be a JSON object.';
  exception when check_violation then null; end;

  -- The chain's text steps are accepted in the member's own generation history.
  insert into public.generation_requests(kind,prompt,model,provider,input)
    values('text','Rollback chain step','@cf/test/model','Test provider','{"source":"studio"}');
  assert exists(select 1 from public.generation_requests where kind='text' and input->>'source'='studio' and user_id=auth.uid());

  select count(*) into v_count from public.design_sheets where user_id=auth.uid();
  for i in v_count+1..30 loop insert into public.design_sheets(title,data) values('Rollback filler','{}'); end loop;
  begin
    insert into public.design_sheets(title,data) values('One too many','{}');
    raise exception 'A member must not keep more than 30 sheets.';
  exception when check_violation then null; end;
  perform set_config('test.sheet',v_sheet::text,true);
end $$;

-- Another member sees and changes nothing of it.
reset role;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.other_id'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare v_rows integer; begin
  assert not exists(select 1 from public.design_sheets where user_id<>auth.uid()), 'Design sheets leaked to another member.';
  update public.design_sheets set title='Taken over' where id=current_setting('test.sheet')::uuid;
  get diagnostics v_rows = row_count;
  assert v_rows=0, 'Another member edited a sheet.';
  delete from public.design_sheets where id=current_setting('test.sheet')::uuid;
  get diagnostics v_rows = row_count;
  assert v_rows=0, 'Another member deleted a sheet.';
end $$;

-- Signed-out visitors have no access at all.
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$ begin
  begin
    perform 1 from public.design_sheets;
    raise exception 'Signed-out visitors must not read design sheets.';
  exception when insufficient_privilege then null; end;
end $$;

-- Admins can read every sheet (for support and moderation) but not change one.
reset role;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.admin_id'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare v_rows integer; begin
  assert public.is_admin(), 'Expected an admin test session.';
  assert exists(select 1 from public.design_sheets where id=current_setting('test.sheet')::uuid), 'Admins should be able to read sheets.';
  update public.design_sheets set title='Edited by an admin' where id=current_setting('test.sheet')::uuid;
  get diagnostics v_rows = row_count;
  assert v_rows=0, 'An admin edited a member''s sheet.';
end $$;
reset role;
rollback;
