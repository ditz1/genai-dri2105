begin;
insert into auth.users(id,aud,role,raw_app_meta_data,raw_user_meta_data,is_anonymous,created_at,updated_at)
select md5('hw1-demo-user-'||n)::uuid,'authenticated','authenticated',
  '{"provider":"demo","providers":[]}'::jsonb,jsonb_build_object('is_demo',true,'demo_seed','hw1-tournament-simulation'),true,now(),now()
from generate_series(1,8) n on conflict(id) do nothing;
do $$ begin
  if (select count(*) from auth.users where raw_user_meta_data->>'demo_seed'='hw1-tournament-simulation' and coalesce(btrim(email),'')='')<>8 then
    raise exception 'Unexpected demo user state; no profiles were changed.';
  end if;
end $$;
update public.profiles p set first_name=d.first_name,last_name=d.last_name
from (values (1,'Avery','Pixel'),(2,'Milo','Canvas'),(3,'Nova','Ink'),(4,'Sage','Frame'),(5,'Luna','Prism'),(6,'Theo','Brush'),(7,'Iris','Bloom'),(8,'Kai','Mosaic')) d(n,first_name,last_name)
where p.id=md5('hw1-demo-user-'||d.n)::uuid and exists(select 1 from auth.users u where u.id=p.id and u.raw_user_meta_data->>'demo_seed'='hw1-tournament-simulation' and coalesce(btrim(u.email),'')='');
commit;
select count(*) as demo_accounts_created from auth.users where raw_user_meta_data->>'demo_seed'='hw1-tournament-simulation' and coalesce(btrim(email),'')='';
