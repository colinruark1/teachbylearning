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

-- Phone number that reminders are texted to (via Linq). Reminders go out only while
-- verified_at is set; PAUSE/STOP clear it.
create table if not exists phone_link (
  user_id       text primary key references "user"(id) on delete cascade,
  phone         text not null,                     -- E.164, e.g. +15551234567
  verified_at   timestamptz,
  code_hash     text,                              -- sha256 of the pending 6-digit code
  code_sent_at  timestamptz,
  code_attempts smallint not null default 0
);
-- One account per verified number (inbound texts are matched by number).
create unique index if not exists phone_link_verified_phone on phone_link (phone) where verified_at is not null;

-- Linq delivers webhooks at least once; remember event ids so a retry isn't handled twice.
create table if not exists webhook_event (
  id          text primary key,
  received_at timestamptz not null default now()
);

-- Replaced by phone_link (reminders moved from Telegram to Linq).
drop table if exists telegram_link;

-- Last time each background piece ran (see lib/heartbeat.js), shown on the admin dashboard:
-- reminders_tick, linq_webhook, linq_send, linq_send_error.
create table if not exists app_heartbeat (
  key    text primary key,
  at     timestamptz not null,
  detail jsonb not null default '{}'
);
