# Hello world — ASCII in 3D

A Next.js App Router page with extruded Three.js text and a GPU ASCII postprocessing shader. Each line is drawn with the system font into a texture and stacked in layers to give it depth, so any script renders, Japanese included. The scene is rendered to a low-resolution texture, then each sampled brightness value selects a character from a generated glyph atlas.

## Run locally

```sh
npm install
npm run dev
```

Open http://localhost:3000. The page shows only the ASCII 3D text on a plain dark background. Move your pointer to tilt the text. Reduced-motion preferences are respected.

## Supabase

The page reads translations of "hello world" from a Supabase `strings` table and draws each one as a line of the ASCII scene. Without data, the scene falls back to "hello world". Add your project's credentials to `.env.local` (Project Settings → API Keys in the Supabase dashboard):

```sh
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Create and seed the table by running `supabase/migrations/20260927000000_create_strings.sql` in the dashboard's SQL editor, or with `supabase db push`. Without the variables, the page renders the scene alone.

## Production

```sh
npm run build
npm start
```

Vercel uses the Next.js framework setting in `vercel.json`. Text uses the visitor's system fonts; the page makes no third-party asset requests.
