-- App tables (Better Auth owns "user", "session", etc.). Applied by `npm run migrate`
-- (scripts/migrate.js). Every statement must be safe to re-run.

-- One commitment per habit per user, e.g. "Every day, I will go to the gym at 8:00 AM."
create table if not exists habit_commitment (
  id                bigserial primary key,
  user_id           text not null references "user"(id) on delete cascade,
  habit             text not null,                 -- gym | poetry | reading | leetcode
  statement         text not null,                 -- the user's own words
  days              smallint[] not null,           -- 0 = Sunday … 6 = Saturday
  time_local        time not null,                 -- when they committed to start
  timezone          text not null,                 -- IANA zone, e.g. America/New_York
  remind_before_min smallint not null default 30,
  active            boolean not null default true,
  last_reminded_on  date,                          -- local date of the last reminder sent
  last_followup_on  date,                          -- local date of the last follow-up sent
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, habit)
);

-- A logged session: proof, the details of what they did, and their thoughts.
create table if not exists habit_checkin (
  id          bigserial primary key,
  user_id     text not null references "user"(id) on delete cascade,
  habit       text not null,
  day         date not null,                       -- the user's local date
  proof_type  text not null,                       -- photo | link | text
  proof       text not null,                       -- JPEG data URL, URL, or text
  details     jsonb not null default '{}',         -- habit-specific: book title, problem, …
  reflection  text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists habit_checkin_user_day on habit_checkin (user_id, day desc);
-- Where a photo proof's file lives (a lib/storage provider id, e.g. "supabase"); `proof` then
-- holds that provider's ref. Null on old rows = stored inline in `proof` as a data URL.
alter table habit_checkin add column if not exists proof_storage text;
-- Community (a SKILLS id in stream-platform/skills.js) the user shares check-ins to.
-- 'none' = keep private; null = never chosen, so the habit's default community applies.
alter table habit_commitment add column if not exists community text;

-- Community posts everyone signed in can see. `skill` is a community id (SKILLS in
-- stream-platform/skills.js, mirrored in lib/communities.js). Posts shared from a check-in
-- keep checkin_id (one post per check-in) and show its proof photo; deleting the check-in
-- deletes the post.
create table if not exists community_post (
  id          bigserial primary key,
  user_id     text not null references "user"(id) on delete cascade,
  skill       text not null,
  sub         text not null,                       -- subtopic, e.g. Creative Writing
  kind        text not null default 'progress',    -- progress (threads stay browser-local for now)
  body        text not null default '',
  minutes     smallint,
  checkin_id  bigint unique references habit_checkin(id) on delete cascade,
  created_at  timestamptz not null default now()
);
create index if not exists community_post_skill_created on community_post (skill, created_at desc);
create index if not exists community_post_created on community_post (created_at desc);

create table if not exists community_like (
  post_id     bigint not null references community_post(id) on delete cascade,
  user_id     text not null references "user"(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists community_comment (
  id          bigserial primary key,
  post_id     bigint not null references community_post(id) on delete cascade,
  user_id     text not null references "user"(id) on delete cascade,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists community_comment_post on community_comment (post_id, created_at);

-- WhatsApp number that reminders go to (via Bird). Reminders go out only while verified_at
-- is set; PAUSE/STOP clear it. Codes are sent and checked by Bird Verify.
create table if not exists phone_link (
  user_id         text primary key references "user"(id) on delete cascade,
  phone           text not null,                   -- E.164, e.g. +15551234567
  verified_at     timestamptz,
  code_sent_at    timestamptz,
  verify_pending  boolean not null default false,  -- a code was sent and not yet confirmed
  last_inbound_at timestamptz                      -- their last message to us; opens WhatsApp's 24 h window
);
-- Columns from the earlier SMS version (codes were checked here, not by Bird Verify).
alter table phone_link add column if not exists verify_pending boolean not null default false;
alter table phone_link add column if not exists last_inbound_at timestamptz;
alter table phone_link drop column if exists code_hash;
alter table phone_link drop column if exists code_attempts;
-- One account per verified number (inbound messages are matched by number).
create unique index if not exists phone_link_verified_phone on phone_link (phone) where verified_at is not null;

-- Webhooks are delivered at least once; remember ids so a retry isn't handled twice.
create table if not exists webhook_event (
  id          text primary key,
  received_at timestamptz not null default now()
);

-- Replaced by phone_link (reminders moved off Telegram).
drop table if exists telegram_link;

-- Last time each background piece ran (see lib/heartbeat.js), shown on the admin dashboard:
-- reminders_tick, whatsapp_webhook, whatsapp_send, whatsapp_send_error, ….
create table if not exists app_heartbeat (
  key    text primary key,
  at     timestamptz not null,
  detail jsonb not null default '{}'
);

-- Strava connection (lib/strava.js). Tokens are AES-GCM encrypted with a key derived from
-- BETTER_AUTH_SECRET. One app account per Strava athlete (webhooks arrive by athlete id).
create table if not exists strava_link (
  user_id       text primary key references "user"(id) on delete cascade,
  athlete_id    bigint not null unique,
  athlete_name  text,
  scope         text,                              -- what the athlete granted, e.g. read,activity:read_all
  access_token  text not null,
  refresh_token text not null,
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
