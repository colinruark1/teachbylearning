// Server-side habit definitions: ids, names and the bot's message copy.
// The UI side (proof types, detail fields) lives in stream-platform/habits.js;
// keep the ids in sync.

export const HABITS = {
  gym: {
    name: "the gym",
    reminder: (at) => `Almost ready for the gym? You're on for ${at}. Shoes, water, headphones.`,
    followup: "Did you make it to the gym today? Log your workout so it counts.",
  },
  poetry: {
    name: "poetry",
    reminder: (at) => `Poetry at ${at}. Got a pen (or a blank note) ready?`,
    followup: "Did you write today's poem? Even a rough draft counts. Log it.",
  },
  reading: {
    name: "reading",
    reminder: (at) => `Reading time at ${at}. Which book is on deck?`,
    followup: "Did you get your reading in today? Log the pages you read.",
  },
  leetcode: {
    name: "LeetCode",
    reminder: (at) => `LeetCode at ${at}. Pick your problem now so you can start on time.`,
    followup: "Did you solve today's LeetCode problem? Log it with your submission.",
  },
};

export const isHabit = (id) => Object.hasOwn(HABITS, id);

/* ---------- Time helpers ---------- */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function isTimeZone(tz) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

// The current local date ("YYYY-MM-DD"), weekday (0 = Sun) and minutes since midnight in `tz`.
export function localNow(tz, now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now).map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    dow: WEEKDAYS.indexOf(p.weekday),
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}

// "08:00" or "08:00:00" → 480
export const toMinutes = (t) => { const [h, m] = String(t).split(":").map(Number); return h * 60 + m; };

// 480 → "8:00 AM"
export function fmtClock(min) {
  const h = Math.floor(min / 60) % 24, m = min % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export function fmtDays(days) {
  const s = [...days].sort().join("");
  if (s === "0123456") return "every day";
  if (s === "12345") return "weekdays";
  if (s === "06") return "weekends";
  return [...days].sort().map((d) => WEEKDAYS[d]).join(", ");
}
