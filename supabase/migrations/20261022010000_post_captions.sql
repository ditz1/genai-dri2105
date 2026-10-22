-- An optional caption the owner writes when posting an image. Pages show it in place of the prompt; without one they
-- show the prompt. The prompt itself always stays as the record of what generated the image.
alter table public.posts add column caption text check (char_length(caption) between 1 and 300);

grant update (caption) on public.posts to authenticated;

-- Owners set the caption, and posted_at, only while the image is still a draft; once posted, only admins change it.
alter policy "Users can post their own drafts"
  on public.posts
  using ((select auth.uid()) = user_id and posted_at is null);

-- Admins reword the caption instead of the prompt. An empty caption goes back to showing the prompt.
drop function public.admin_update_post_prompt(uuid, text);

create function public.admin_update_post_caption(target_post uuid, new_caption text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can edit posts.' using errcode = '42501';
  end if;
  update public.posts set caption = nullif(btrim(new_caption), '') where id = target_post;
  if not found then
    raise exception 'That post could not be found.' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.admin_update_post_caption(uuid, text) from public, anon;
grant execute on function public.admin_update_post_caption(uuid, text) to authenticated;
