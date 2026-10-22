-- Lets admins reword any post's prompt without touching its image, score or votes.
-- Done through a function rather than a column grant: granting update (prompt) to authenticated would also let owners
-- rewrite their own prompts through the existing "Users can post their own drafts" policy.
create function public.admin_update_post_prompt(target_post uuid, new_prompt text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can edit posts.' using errcode = '42501';
  end if;
  update public.posts set prompt = btrim(new_prompt) where id = target_post;
  if not found then
    raise exception 'That post could not be found.' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.admin_update_post_prompt(uuid, text) from public, anon;
grant execute on function public.admin_update_post_prompt(uuid, text) to authenticated;
