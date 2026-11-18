# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

The site has two parts:

- **The repo root** is the landing page. `index.html` is the "Join the 1%" pitch with real Better Auth login and 2FA. The auth server code lives here too: `api/`, `lib/`, `package.json` (ESM; deps `better-auth`, `pg`) and `vercel.json`.
- **`stream-platform/`** is the app at `/stream-platform/`. It has a Twitch-style "Browse" page mockup (`index.html`) and a "Learn a New Skill" community section (`learn.html`). It's themed in a warm sepia palette with a fountain-pen logo, and its UI includes a top nav, a collapsible recommended-channels sidebar, a 3D hero carousel and stream/category card shelves.

Everything is plain HTML/CSS/vanilla JS: no framework, no build step, no tests, no linter.

## Running

The static pages can be served with `python3 -m http.server 8000` from the repo root. Login needs the auth API, though, so use `vercel dev` from the repo root:

- Put the env vars in `.env.local` (see `.env.example`): `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and `DATABASE_URL` for Postgres.
- Create or update the tables with `npm run migrate`.
- On Vercel, deploy from the repo root (leave Root Directory blank) and set the same env vars.

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
- **`lib/auth.js`** holds the Better Auth config (email+password, `twoFactor()` plugin, `pg` Pool).
- **`api/auth.js`** is a single Vercel function: `vercel.json` rewrites `/api/auth/<path>` to `/api/auth?__path=<path>`, and the function rebuilds the original URL before calling `auth.handler`.
- **`stream-platform/index.html`** (Browse) is a static shell. All content regions are empty containers identified by id (`#channelList`, `#heroStage`, `#liveGrid`, `#categoryGrid`, `#chatGrid`) that `app.js` fills.
- **`app.js`** holds mock data (`STREAMS`, `CATEGORIES` — marked to be replaced by a real API) and renders everything via template-literal strings assigned to `innerHTML`. Shared helpers: `$` (querySelector), `fmtViewers` (e.g. `48K`, `1.3K`) and `avatar(s)`.
  - There are no images: stream thumbnails and category art are a flat mocha brown (`--thumb-bg` on `.thumb`); avatars are colored from each item's `hue` field via `avatar`. New stream items need a `hue`.
  - Hero carousel: `layoutHero()` positions every slide absolutely using its signed, wrapped distance from `heroIndex` (translate/scale/z-index/opacity set inline); `.is-center` marks the active slide. Navigation goes through `goTo(i)`.
- **`skills.js`** (loaded by both app pages and the landing page) holds `SKILLS` — the 10 "Learn a New Skill" topics (subtopics, `hue`, `icon` built with `ico()`, `defaultTab`, `strava` flag) — plus `skillCard`, `skillHref` and `fmtCount`. It must not declare `$` (each page script does).
- **`learn.html` + `learn.js`** is the Learn section: a hub (no hash) and per-skill pages routed by hash (`#skill=<id>&tab=progress|forum&sub=<subtopic>&thread=<postId>`). Posts are `kind: "progress"` (feed: text, photos/videos, minutes practiced, Strava activity) or `kind: "thread"` (Discussions forum); both have likes and comments.
  - State lives in localStorage (`tbl.learn.v1`, seeded by `seedPosts()` on first load); clear that key to reset. Images are downscaled to JPEG data URLs; videos are session-only blob URLs and are stripped on save. Strava is mocked (`STRAVA_ACTIVITIES`, fake connect) — real use needs OAuth plus a server.
  - User text is rendered via `innerHTML`, so always wrap it in `esc()`. Likes/comments re-render only the affected post (`refreshPost`) so composer drafts survive.
- **`styles.css`** uses BEM-style class names (`block__element--modifier`, `is-*` state classes). All colors and layout sizes are CSS custom properties on `:root` (`--accent`, `--bg*`, `--text*`, `--nav-h`, `--side-w`, ...); change the theme there rather than hard-coding colors.
  - Sidebar collapse is a `side-collapsed` class toggled on `<body>`; the CSS hides labels and shrinks the sidebar/main offset from that.
  - Responsive breakpoints at 1200px, 920px, 600px, plus a `prefers-reduced-motion` block at the end of the file.
