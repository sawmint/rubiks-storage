# Account system setup

The app works fine without an account (everything in localStorage), but once you sign in your drill stats and timer solves sync to the cloud so they're available on any device you sign in on.

You'll do this ONCE. All steps are click-and-paste — no code on your side.

**Total time:** ~15 minutes (Supabase: 5 min, Google OAuth: 10 min).

---

## 1. Create the Supabase project (5 min)

1. Open https://supabase.com and click **Start your project** → sign in with your GitHub or `nitinsinghal.nyu@gmail.com`.
2. Click **New project**.
   - Name: `rubiks-storage`
   - Database password: **save this somewhere** (you won't need it for the app, but Supabase keeps it for DB admin). A password manager is ideal.
   - Region: pick whichever is closest to you (e.g. *East US (North Virginia)* for the US East Coast).
   - Click **Create new project**. Wait ~2 minutes for provisioning.

3. Once the dashboard loads, on the left sidebar click **SQL Editor** → **New query**, paste the entire block below, and click **Run**:

```sql
-- per-case drill + recognition + SRS state (mirrors rs-stats-v2 in localStorage)
create table public.case_stats (
  user_id     uuid not null references auth.users on delete cascade,
  category    text not null,
  case_id     text not null,
  drill       jsonb not null default '{}'::jsonb,
  recog       jsonb not null default '{}'::jsonb,
  srs         jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (user_id, category, case_id)
);

-- timer sessions (one row per session in rs-sessions-v1.sessions)
create table public.sessions (
  user_id     uuid not null references auth.users on delete cascade,
  id          text not null,
  name        text not null,
  created_at  bigint not null,
  is_active   boolean not null default false,
  updated_at  timestamptz not null default now(),
  primary key (user_id, id)
);

-- individual solves
create table public.solves (
  user_id             uuid not null references auth.users on delete cascade,
  id                  text not null,
  session_id          text not null,
  time_ms             int not null,
  scramble            text,
  phases              jsonb not null default '[]'::jsonb,
  penalty             text,
  inspection_penalty  text,
  comment             text,
  date                bigint not null,
  updated_at          timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, session_id) references public.sessions (user_id, id) on delete cascade
);

-- top-level prefs (phaseConfig, inspection, recog/weak settings, active session id)
create table public.user_prefs (
  user_id     uuid primary key references auth.users on delete cascade,
  prefs       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- Row-Level Security: each user can only read/write their own rows
alter table public.case_stats enable row level security;
alter table public.sessions   enable row level security;
alter table public.solves     enable row level security;
alter table public.user_prefs enable row level security;

create policy "own rows" on public.case_stats for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on public.sessions   for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on public.solves     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on public.user_prefs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

You should see "Success. No rows returned." If you get an error like "relation already exists," the SQL was already run — that's fine.

4. Now grab your project URL + anon key:
   - Left sidebar → **Project Settings** (gear icon, bottom-left) → **API**.
   - Copy the **Project URL** (e.g. `https://abcdefghij.supabase.co`).
   - Copy the **anon public** key (a long string starting with `eyJ...`).

5. Open `supabase-config.js` in this repo and paste both values:
   ```js
   export const SUPABASE_URL = "https://abcdefghij.supabase.co";
   export const SUPABASE_ANON_KEY = "eyJhbGciOiJ...";
   ```
   The anon key is a *publishable* key — it's safe to commit to a public repo. Row-level security on the database enforces that signed-in users only see their own rows.

6. Push the change (the deploy skill bumps the PWA cache version and pushes for you). Reload the site — the **Sign in** button now appears next to the gear icon.

7. **Set the redirect URL allow-list** — without this, Supabase will send you to its default `http://localhost:3000` after sign-in instead of back to your app, and the page will fail to load.
   - In the Supabase dashboard, left sidebar → **Authentication** → **URL Configuration**.
   - **Site URL**: set to your production URL, e.g. `https://sawmint.github.io/rubiks-storage/`. (This is the fallback if any other redirect is rejected.)
   - **Redirect URLs**: paste each of these on its own line. The `**` wildcard allows any path under each URL.
     ```
     https://sawmint.github.io/rubiks-storage/**
     https://*.pages.dev/**
     http://localhost:8000/**
     http://localhost:8765/**
     ```
   - Click **Save**.

**Email magic-link sign-in works at this point.** You can stop here if you don't want Google sign-in. If you want Google too, continue to step 2.

---

## 2. Google OAuth setup (10 min)

This is the irreducible part — Google requires every web app that uses Google Sign-In to register an OAuth client with them.

1. Open https://console.cloud.google.com and sign in with `nitinsinghal.nyu@gmail.com`.

2. Top-left, click the project dropdown → **New Project**. Name it `Rubik's Storage`. Click **Create**, then select it from the dropdown.

3. Left sidebar → **APIs & Services** → **OAuth consent screen**.
   - User type: **External** → Create.
   - App name: `Rubik's Storage`
   - User support email: your email
   - Developer contact email: your email
   - Skip optional fields; click **Save and continue** through Scopes and Test users (no scopes need to be added — Supabase asks for `email` and `profile` automatically).
   - On the Test users page, click **+ Add users** and add `nitinsinghal.nyu@gmail.com` so you can sign in while the app is in test mode. (Alternatively, click **Publish app** to skip the test-user restriction — fine for a personal project.)
   - Click **Back to dashboard**.

4. Left sidebar → **APIs & Services** → **Credentials** → **+ Create credentials** → **OAuth client ID**.
   - Application type: **Web application**
   - Name: `Rubik's Storage web`
   - **Authorized JavaScript origins** (add each one):
     - `https://sawmint.github.io`
     - Your Cloudflare Pages URL if you have one (e.g. `https://rubiks-storage.pages.dev`)
     - `http://localhost:8000` (for local dev with `npm start`)
   - **Authorized redirect URIs**:
     - Open another tab → Supabase dashboard → **Authentication** → **Providers** → click **Google**. Supabase shows a "Callback URL (for OAuth)" value like `https://abcdefghij.supabase.co/auth/v1/callback`. Copy it.
     - Paste that URL as the redirect URI in Google Cloud Console.
   - Click **Create**. A modal pops up with the **Client ID** and **Client secret** — copy both.

5. Back in Supabase → **Authentication** → **Providers** → **Google**:
   - Toggle **Enable Sign in with Google** ON.
   - Paste the **Client ID** and **Client secret** from Google.
   - Click **Save**.

6. Reload the app. Click **Sign in**. The **Continue with Google** button now works — clicking it sends you through Google's consent screen and lands you back signed in.

---

## What happens on first sign-in

If you already have local drill stats / timer solves on this device when you sign in for the very first time:

- **Cloud is empty (e.g. brand new account):** your local data is uploaded silently in the background. No prompt.
- **Cloud has data already AND local has data** (e.g. you signed in on a second device, used it offline, then it came online): you'll see a modal asking which side wins — *Use this device's data* (overwrites cloud), *Use the cloud data* (overwrites local), or *Cancel* (signs you out).

After that, every drill rep / timer solve / penalty change pushes up automatically. If you're offline, the writes queue in localStorage (`rs-sync-queue-v1`) and flush automatically when you come back online.

---

## Troubleshooting

**Sign in button doesn't show up:** open browser DevTools → Console. If you see "Cloud not configured", the values in `supabase-config.js` are still empty.

**Email magic link goes to spam:** Supabase's default sender is `noreply@mail.app.supabase.io`. You can configure custom SMTP later in Supabase → Auth → Email Templates → SMTP Settings if it's a problem.

**Google sign-in says "redirect_uri_mismatch":** The redirect URI in Google Cloud Console must EXACTLY match the callback URL Supabase shows. Re-check it (no trailing slash, https only).

**RLS error in console after sign in:** Re-run the SQL block from step 1; the policies may not have applied.

**Want to wipe your cloud data and start over:** in Supabase SQL Editor, run:
```sql
delete from public.case_stats where user_id = auth.uid();
delete from public.solves     where user_id = auth.uid();
delete from public.sessions   where user_id = auth.uid();
delete from public.user_prefs where user_id = auth.uid();
```
(Run this while signed into the Supabase dashboard with the account whose data you want to wipe.)
