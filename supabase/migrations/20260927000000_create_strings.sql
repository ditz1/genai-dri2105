create table public.strings (
  id bigint generated always as identity primary key,
  language text not null,
  locale text not null,
  text text not null,
  created_at timestamptz not null default now()
);

alter table public.strings enable row level security;

grant select on public.strings to anon, authenticated;

create policy "Strings are readable by everyone"
  on public.strings for select
  to anon, authenticated
  using (true);

insert into public.strings (language, locale, text) values
  ('Spanish', 'es', 'Hola, mundo'),
  ('French', 'fr', 'Bonjour, le monde'),
  ('German', 'de', 'Hallo, Welt'),
  ('Italian', 'it', 'Ciao, mondo'),
  ('Japanese', 'ja', 'こんにちは、世界');
