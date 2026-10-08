-- AI-generated images. A row is created as soon as an image is generated, with the prompt and model that made it;
-- it stays a draft only its owner can see until posted_at is set.
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  prompt text not null check (char_length(prompt) between 1 and 500),
  model text not null,
  -- Path of the image inside the "generations" storage bucket.
  image_path text not null unique,
  -- Sum of the post's votes, kept current by the trigger on public.votes.
  score integer not null default 0,
  posted_at timestamptz,
  created_at timestamptz not null default now()
);

create index posts_user_id_idx on public.posts (user_id);
create index posts_posted_at_idx on public.posts (posted_at desc) where posted_at is not null;

alter table public.posts enable row level security;

-- Supabase grants every privilege on new tables to the API roles, so start from nothing.
-- Clients choose the prompt, model and image when creating a post and can afterwards only change whether it is posted.
-- The score is never writable from the API.
revoke all on public.posts from anon, authenticated;
grant select on public.posts to anon, authenticated;
grant insert (prompt, model, image_path) on public.posts to authenticated;
grant update (posted_at) on public.posts to authenticated;
grant delete on public.posts to authenticated;

create policy "Posted images are readable by everyone, drafts by their owner"
  on public.posts for select
  to anon, authenticated
  using (posted_at is not null or (select auth.uid()) = user_id);

create policy "Users can create their own posts from their own images"
  on public.posts for insert
  to authenticated
  with check ((select auth.uid()) = user_id and (storage.foldername(image_path))[1] = (select auth.uid())::text);

create policy "Users can post their own drafts"
  on public.posts for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own posts"
  on public.posts for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- One vote per member per post: 1 is an upvote, -1 a downvote.
create table public.votes (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index votes_user_id_idx on public.votes (user_id);

alter table public.votes enable row level security;

-- Signed-out visitors get nothing. Members see only their own votes; everyone else's are visible only as a post's score.
revoke all on public.votes from anon, authenticated;
grant select, delete on public.votes to authenticated;
grant insert (post_id, value) on public.votes to authenticated;
grant update (value) on public.votes to authenticated;

create policy "Users can read their own votes"
  on public.votes for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can vote on posted images"
  on public.votes for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.posts where posts.id = post_id and posts.posted_at is not null)
  );

create policy "Users can change their own votes"
  on public.votes for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can remove their own votes"
  on public.votes for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- Keep posts.score equal to the sum of the post's votes.
create function public.apply_vote_to_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' then
    update public.posts set score = score - old.value where id = old.post_id;
  end if;
  if tg_op <> 'DELETE' then
    update public.posts set score = score + new.value where id = new.post_id;
  end if;
  return null;
end;
$$;

revoke execute on function public.apply_vote_to_score() from public, anon, authenticated;

create trigger on_vote_changed
  after insert or update or delete on public.votes
  for each row execute function public.apply_vote_to_score();

-- Generated images are stored as files in a public bucket, under a folder named after the user's id.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('generations', 'generations', true, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "Users can read their own generated files"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'generations' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users can upload their own generated files"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'generations' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users can delete their own generated files"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'generations' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- The app no longer reads the strings table, so nothing outside the database needs access to it.
drop policy "Strings are readable by everyone" on public.strings;
revoke all on public.strings from anon, authenticated;

-- Profiles keep only the privileges the app uses: everyone reads, members create and edit their own row.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to anon, authenticated;
grant insert, update on public.profiles to authenticated;
