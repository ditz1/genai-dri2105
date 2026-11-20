-- Design sheets: a member's concept-art project, usually grown from a tournament's winning image. The studio
-- (app/studio) runs a prompt chain over it: text steps that read the winner and write the art direction and each
-- portion's design, and image steps that render every portion.
create table public.design_sheets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  -- The champion the sheet started from, and its theme. Both are null for a sheet started from scratch, and become
  -- null if the post or theme is later removed; the sheet keeps its own copy of what it needs in `data`.
  source_post_id uuid references public.posts (id) on delete set null,
  theme_id bigint references public.themes (id) on delete set null,
  title text not null default '' check (char_length(title) <= 120),
  -- The whole sheet: art direction, portions, chain steps and their outputs. Rendered images are files in the
  -- "generations" bucket under <user id>/studio/<sheet id>/ and are referenced here by path.
  data jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 400000),
  -- What the list of sheets shows without loading `data`: a cover image and how many portions are rendered.
  summary jsonb not null default '{}' check (jsonb_typeof(summary) = 'object' and octet_length(summary::text) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index design_sheets_user_id_idx on public.design_sheets (user_id, updated_at desc);
create index design_sheets_source_post_id_idx on public.design_sheets (source_post_id);
create index design_sheets_theme_id_idx on public.design_sheets (theme_id);

alter table public.design_sheets enable row level security;

-- Sheets are private to their owner. Clients choose a sheet's contents and where it started; the owner and the
-- timestamps of creation are set by the database.
revoke all on public.design_sheets from anon, authenticated;
grant select, delete on public.design_sheets to authenticated;
grant insert (source_post_id, theme_id, title, data, summary) on public.design_sheets to authenticated;
grant update (title, data, summary, updated_at) on public.design_sheets to authenticated;

create policy "Members read their own design sheets and admins read all"
  on public.design_sheets for select
  to authenticated
  using ((select auth.uid()) = user_id or (select public.is_admin()));

-- A sheet either starts from scratch or from the winning image of a finished tournament, never from any other post.
create policy "Members start design sheets from scratch or from a tournament winner"
  on public.design_sheets for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and (
      (source_post_id is null and theme_id is null)
      or exists (
        select 1 from public.tournaments
        where tournaments.theme_id = design_sheets.theme_id
          and tournaments.status = 'finished'
          and tournaments.champion_post_id = design_sheets.source_post_id
      )
    )
  );

create policy "Members edit their own design sheets"
  on public.design_sheets for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Members delete their own design sheets"
  on public.design_sheets for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- Each member can keep a limited number of sheets (LIMITS.sheets in lib/studio/sheet.js).
create function public.limit_design_sheets()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.design_sheets where user_id = new.user_id) >= 30 then
    raise exception 'You can keep up to 30 design sheets. Delete one to start another.' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function public.limit_design_sheets() from public, anon, authenticated;

create trigger limit_design_sheets
  before insert on public.design_sheets
  for each row execute function public.limit_design_sheets();

-- The chain's text steps are recorded in the generation history next to image and theme requests. Studio requests
-- carry {"source": "studio", "sheet": <id>, "step": <name>} in `input`, which is also how a member's daily studio
-- allowance is counted.
alter table public.generation_requests drop constraint generation_requests_kind_check;
alter table public.generation_requests add constraint generation_requests_kind_check check (kind in ('image', 'theme', 'text'));
