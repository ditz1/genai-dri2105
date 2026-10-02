# People — a profile board

A Next.js App Router app backed by Supabase. The home page shows member profiles as 3D cards, three at a time, each with the member's name and photo. Members sign in with Google and manage their own name and photo.

## Run locally

```sh
npm install
npm run dev
```

Open http://127.0.0.1:3000.

## Supabase

Add your project's credentials to `.env.local` (Project Settings → API Keys in the Supabase dashboard):

```sh
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Apply the files in `supabase/migrations/` in order, in the dashboard's SQL editor or with `supabase db push`. Without the variables, the board shows only sample tiles.

## The board

`app/page.js` loads members who have finished onboarding, newest first, up to 120. `app/board.js` draws them three at a time with Three.js: each profile is the front face of a box, showing the member's photo (or a blank silhouette) and name. Scrolling down brings up the next row of three (on tall screens, the next card in a column), and only the cards near the view are kept in the scene. Clicking a card brings it forward, dims the others, and opens a panel with more about that member; Escape, Close, or a click elsewhere puts it back. While fewer than 12 members have joined, sample profiles from `app/placeholders.js` fill the remaining spots.

`supabase/migrations/20261002000000_public_profiles.sql` makes profile rows readable by everyone, signed in or not, so the board can show them. Only a profile's owner can change it.

## Accounts

Visitors sign in with Google at `/login`. Google returns to `/auth/callback`, which starts the session and sends new users to `/onboarding` to enter their first and last name. `/profile` is only reachable when signed in and lets users edit their name and upload a photo.

`supabase/migrations/20261001000000_create_profiles.sql` creates the `profiles` table, a trigger that adds a row for each new user, and a public `avatars` storage bucket. Photos are stored as files in the bucket; the table holds only the file's path.

To enable sign-in, create an OAuth client in Google Cloud with `https://<project-ref>.supabase.co/auth/v1/callback` as an authorized redirect URI, then paste its client ID and secret into Authentication → Sign In / Providers → Google in the Supabase dashboard. Under Authentication → URL Configuration, add `http://127.0.0.1:3000/auth/callback` and `https://<your-domain>/auth/callback` to the redirect URLs.

## Production

```sh
npm run build
npm start
```

Vercel uses the Next.js framework setting in `vercel.json` and needs the same two environment variables. Text uses the visitor's system fonts.
