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

-- Telegram chat used for reminders (free stand-in for SMS).
create table if not exists telegram_link (
  user_id          text primary key references "user"(id) on delete cascade,
  chat_id          bigint unique,                  -- null until the user taps Start in Telegram
  link_token       text unique,
  token_expires_at timestamptz,
  linked_at        timestamptz
);
