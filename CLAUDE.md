# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

The site has two parts:

- **The repo root** is the landing page. `index.html` is the "Join the 1%" pitch with real Better Auth login and 2FA. The auth server code lives here too: `api/`, `lib/`, `package.json` (ESM; deps `better-auth`, `pg`) and `vercel.json`.
- **`stream-platform/`** is the app at `/stream-platform/`. Its home is Communities (`communities.html`); `index.html` only redirects there, keeping the hash. The nav is Following / Today / Communities. The old Twitch-style "Browse" mockup is kept at `browse.html`, but nothing links to it. It's themed in a warm sepia palette with a fountain-pen logo, and its UI includes a top nav, a collapsible recommended-channels sidebar, a 3D hero carousel and stream/category card shelves.

Everything is plain HTML/CSS/vanilla JS: no framework, no build step, no tests, no linter.

## Running

The static pages can be served with `python3 -m http.server 8000` from the repo root. Login needs the auth API, though, so use `vercel dev` from the repo root:

- Put the env vars in `.env.local` (see `.env.example`): `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and `DATABASE_URL` for Postgres.
- Create or update the tables with `npm run migrate` (Better Auth's tables, then the app tables in `lib/schema.sql`).
- Phone reminders (optional): set `PHONE_PROVIDER=log` to print messages in the terminal (the verification code is `000000`), or configure a real provider (see `.env.example`). Run `npm run reminders:dev` alongside `vercel dev` to tick reminders every minute. With the log provider, fake an incoming reply with `curl -X POST localhost:3000/api/inbound -H 'x-dev-inbound: 1' -d '{"from":"+1555…","text":"status"}'`. Real providers need a public https webhook (deploy or tunnel).
- On Vercel, deploy from the repo root (leave Root Directory blank) and set the same env vars.
  - Also set `BIRD_API_KEY`, `BIRD_WHATSAPP_NUMBER`, `BIRD_TEMPLATE_SLUG` and `CRON_SECRET`. Run `npm run messaging:webhook` once with `BETTER_AUTH_URL` set to the deployed origin, then set the printed secret (`BIRD_WEBHOOK_SECRET` for Bird) and redeploy.
  - Something must `POST /api/reminders` with `Authorization: Bearer $CRON_SECRET` every 1–5 minutes. Use cron-job.org or `.github/workflows/reminders.yml` (set the repo variable `APP_URL` and the secret `CRON_SECRET`). Vercel Hobby cron only runs daily.

## Architecture

- **`index.html` + `landing.js` + `landing.css`** (repo root) is the landing page.
  - It loads `stream-platform/styles.css` for tokens/reset and `stream-platform/skills.js` for the skill chips. Links into the app are prefixed with `stream-platform/`.
  - Its login dialog is real auth via Better Auth, with 2FA required for every account. The steps are: credentials → enroll an authenticator (QR from `totpURI`, backup codes) → or, on later logins, verify the TOTP/backup code → redirect to `stream-platform/`.
  - After login it redirects to `?next=` (only `/stream-platform/...` paths), else `/stream-platform/`.
- **`stream-platform/auth-guard.js`** gates the app and is loaded first in `<head>` of every app page (add it to any new page).
  - It hides the page until `/api/auth/get-session` returns a user; otherwise it redirects to `/?next=<page>#login`, failing closed.
  - When signed in, it swaps the nav's Log In/Sign Up links for the user's name and a Log out button.
  - The gate is client-side only, which is fine while app content is static mock data. Real per-user data must be protected server-side.
  - `auth-client.js` is a small `fetch` wrapper for the REST endpoints; sessions are httpOnly cookies on path `/`.
  - QR codes come from `qrcode-generator` on cdnjs.
- **`lib/auth.js`** holds the Better Auth config (email+password, `twoFactor()` plugin, plus the user field `onboardedAt`, which clients can't write). `lib/db.js` holds the shared `pg` Pool and `baseURL`.
- **Onboarding + habits** (Gym, Poetry, Reading, LeetCode):
  - `auth-guard.js` sends signed-in users without `onboardedAt` to `onboarding.html`, which runs three steps: pick habits → write a commitment per habit (`parseCommitment` pre-fills days/time) → connect a phone for reminders (code via the phone provider; WhatsApp also shows a wa.me “say hi” link) (`phoneFormHTML`/`bindPhoneForm` in `habits.js`, shared with the Today page).
  - `POST /api/me/onboarding` saves the commitments and sets `onboardedAt`; revisiting the page edits them.
  - `today.html` + `today.js` let users log check-ins (proof photo/link/text, habit-specific details, reflection) and show the streak and log.
  - `stream-platform/habits.js` defines each habit's UI: proof types, detail fields, `summary`. It declares `esc`/`downscale`, so don't load it on pages that load `communities.js`.
  - `lib/habits.js` has the server-side ids and the bot copy. Keep the ids in sync with `stream-platform/habits.js`.
- **`api/me.js`** is the router for the signed-in user's data (`/api/me/*`, rewritten like auth). It requires a session with 2FA enabled. Proof photos are uploaded through `lib/storage` and served from `/api/me/proof/:id`, which checks ownership and then serves the bytes or redirects to a short-lived signed link.
- **File storage** (`lib/storage/`) is the only way the app stores files. `lib/storage/index.js` documents the provider contract (`put`, `open`, `remove`, `setup`, `health`).
  - `STORAGE_PROVIDER`: `supabase` (default when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set) or `postgres` (files inline as data URLs; the local-dev fallback). Adding R2 or S3 is a new `lib/storage/<id>.js`.
  - `habit_checkin.proof_storage` records which provider holds each photo, so old files keep working after a switch until `npm run storage:migrate` copies them over. `npm run storage:setup` creates the private Supabase bucket and runs a live round trip.
  - Supabase: the bucket is private and accessed server-side only with the secret key. Better Auth isn't Supabase Auth, so there are no storage RLS policies. New `sb_secret_` keys go in the `apikey` header only; legacy `service_role` JWTs also go in `Authorization`.
- **Messaging** (`lib/messaging/`) is the only way the app contacts people. Everything imports `phone` / `email` from `lib/messaging/index.js`, which documents the provider contract and picks providers by env var.
  - `PHONE_PROVIDER`: `bird-whatsapp` (default when `BIRD_API_KEY` is set), `log`, or `none`. `EMAIL_PROVIDER`: `log` or `none`.
  - To swap tools, add `lib/messaging/{phone,email}/<id>.js`, register it in `index.js`, and change the env var. App code doesn't change.
  - Providers own their channel's rules, verification codes, inbound parsing and signature checks, webhook registration, and admin health checks. Each send is recorded in `app_heartbeat` (`phone_send`, `email_send`, …).
  - `bird-whatsapp`: Bird Verify for codes. WhatsApp's 24-hour rule: free-form messages with quick-reply buttons inside the window, the approved template (`BIRD_TEMPLATE_SLUG`, one body variable named `reminder`) outside it. Otherwise it throws `CannotDeliver`, which counts as undeliverable on the dashboard. `capabilities.replyWindowHours` makes the UI show a "say hi" link (`chatLink()`) so the window opens.
  - The UI reads the channel's `label` and `capabilities` from `/api/me/phone`, so its wording follows the provider.
- **Reminders** (`lib/bot.js` + `lib/reminders.js`) are provider-neutral. `phone_link.last_inbound_at` (the user's last message to us) is passed to the provider for reply-window rules.
  - Button slugs: `otw:<commitmentId>`, `skip:<commitmentId>`, `done:<habit>`. Typed replies also work: SKIP, DONE, STATUS, PAUSE/STOP.
  - `lib/reminders.js` sends a nudge from `remind_before_min` before the start time until 30 min after it, and a follow-up 2 h after the start time if the habit isn't logged. It sends each at most once per local day, with idempotency keys.
  - `api/inbound.js` receives replies for any provider (`phone.inbound()` verifies and parses) and dedupes on the message id. `api/reminders.js` is the cron tick.
- **Strava** (`lib/strava.js` + `api/strava.js` at `/api/strava/*`) lets Fitness members attach their own activities to progress posts.
  - OAuth: `/api/strava/connect` → Strava consent (scope `read,activity:read_all`, `state` in an httpOnly cookie) → `/api/strava/callback` stores encrypted tokens in `strava_link` (key derived from `BETTER_AUTH_SECRET`) and redirects to the Fitness page with `#…&strava=connected|error`. Tokens refresh automatically; `DELETE /api/strava` revokes.
  - `/api/strava/webhook` handles Strava's subscription handshake (`STRAVA_VERIFY_TOKEN`) and deletes tokens when an athlete deauthorizes. Register it once with `npm run strava:webhook`, then set `STRAVA_SUBSCRIPTION_ID`.
  - Strava's API agreement limits showing a user's Strava data to other users. Posts are browser-local today; check the agreement before community posts become shared.
- **Admin dashboard** (`stream-platform/admin.html` + `admin.js` + `admin.css`, API in `api/admin.js` at `/api/admin/*`):
  - Admins are accounts whose email is in `ADMIN_EMAILS` (default `colinruark1@gmail.com`) and that have 2FA on (`lib/admin.js`). `customSession` in `lib/auth.js` adds `user.isAdmin` to sessions; the admin API re-checks it.
  - `auth-guard.js` gives admins a "View as Admin / User" switch (stored in localStorage `tbl.viewAs`). Admin view adds an Admin nav link. User view hides it and redirects `admin.html` to Today.
  - The dashboard lists users with mailto and phone links, and can message them through the active phone and email providers (verified numbers only). It also shows integration health: live checks of env vars, schema, and each provider's own `health()` checks, plus `app_heartbeat` timestamps (`lib/heartbeat.js`) written by the reminder tick, `lib/messaging` sends and the inbound webhook. `KNOWN_GAPS` in `api/admin.js` lists the stand-ins; update it as they get real backends.
  - `lib/http.js` holds the shared API helpers (`requireUser`, `json`, `handler`, …) used by `api/me.js` and `api/admin.js`.
- **`stream-platform/browse.html`** (Browse) is unlinked from the UI; its code is kept for reuse. It's a static shell. All content regions are empty containers identified by id (`#channelList`, `#heroStage`, `#liveGrid`, `#categoryGrid`, `#chatGrid`) that `app.js` fills.
- **`app.js`** holds mock data (`STREAMS`, `CATEGORIES` — marked to be replaced by a real API) and renders everything via template-literal strings assigned to `innerHTML`. Shared helpers: `$` (querySelector), `fmtViewers` (e.g. `48K`, `1.3K`) and `avatar(s)`.
  - There are no images: stream thumbnails and category art are a flat mocha brown (`--thumb-bg` on `.thumb`); avatars are colored from each item's `hue` field via `avatar`. New stream items need a `hue`.
  - Hero carousel: `layoutHero()` positions every slide absolutely using its signed, wrapped distance from `heroIndex` (translate/scale/z-index/opacity set inline); `.is-center` marks the active slide. Navigation goes through `goTo(i)`.
- **`skills.js`** (loaded by both app pages and the landing page) holds `SKILLS`, one community per skill (subtopics, `hue`, `icon` built with `ico()`, `defaultTab`, `strava` flag). It also has `skillCard(s, meta, live)`, `skillHref` (which links into `communities.html`) and `fmtCount`. Adding a `SKILLS` entry opens a new community. It must not declare `$` (each page script does).
- **`communities.html` + `communities.js`** is the Communities section. Pages are routed by hash (`#skill=<id>&tab=progress|forum&sub=<subtopic>&sort=top|new&thread=<postId>`).
  - The hub (no hash) has a searchable community grid, the top live streams, popular progress, and a "Request a community" board. Requests are upvoted, and one that reaches `REQUEST_GOAL` is ready to become a `SKILLS` entry.
  - A community page shows "Live now" streams (mock `LIVE_STREAMS`; there's no player yet, so cards show a toast) above the Progress/Discussions tabs.
  - Progress sorts by `byPopular` (likes plus comments, decayed by age), or by newest with `sort=new`. Posting switches the feed to Recent. Posts are `kind: "progress"` (feed: text, photos/videos, minutes practiced, Strava activity) or `kind: "thread"` (Discussions forum); both have likes and comments.
  - State lives in localStorage (`tbl.learn.v1`, seeded by `seedPosts()` on first load); clear that key to reset. Images are downscaled to JPEG data URLs; videos are session-only blob URLs and are stripped on save. Strava is real (see **Strava** below); seed posts still carry mock activities.
  - User text is rendered via `innerHTML`, so always wrap it in `esc()`. Likes/comments re-render only the affected post (`refreshPost`) so composer drafts survive.
- **`styles.css`** uses BEM-style class names (`block__element--modifier`, `is-*` state classes). All colors and layout sizes are CSS custom properties on `:root` (`--accent`, `--bg*`, `--text*`, `--nav-h`, `--side-w`, ...); change the theme there rather than hard-coding colors.
  - Sidebar collapse is a `side-collapsed` class toggled on `<body>`; the CSS hides labels and shrinks the sidebar/main offset from that.
  - Responsive breakpoints at 1200px, 920px, 600px, plus a `prefers-reduced-motion` block at the end of the file.
