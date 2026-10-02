-- The home page shows every member on a board, so profiles (name and photo path) become readable by everyone.
-- Writes stay limited to the profile's owner.
drop policy "Users can read their own profile" on public.profiles;

grant select on public.profiles to anon;

create policy "Profiles are readable by everyone"
  on public.profiles for select
  to anon, authenticated
  using (true);
