// Daily habits users commit to during onboarding (onboarding.html) and log on the
// Today page (today.html). Server-side ids and bot copy are in lib/habits.js; keep in sync.
// Loaded after skills.js (uses `ico`). Must not declare `$` (each page script does).

// proof.types: how the user can prove they did it — "photo" (downscaled JPEG),
//   "link" (URL) or "text" (pasted work). The first type is the default.
// fields: the "what did you do" details stored with each check-in.
// summary(details): one-line recap shown in the log.
const HABITS = [
  {
    id: "gym", name: "The Gym", hue: 0, skill: "fitness",
    tagline: "Show up and train, even on the days you don't feel like it.",
    verb: "go to the gym",
    example: "Every weekday, I will go to the gym at 7:00 AM.",
    defaults: { days: [1, 2, 3, 4, 5], time: "07:00" },
    icon: ico('<path d="M2 8v4M5 5.5v9M15 5.5v9M18 8v4M5 10h10"/>'),
    proof: {
      types: ["photo", "link"],
      photo: "A gym selfie, or a photo of your workout log",
      link: "Link to the workout (Strava, Hevy, Strong…)",
    },
    fields: [
      { key: "workout", label: "What did you train?", type: "select", required: true,
        options: ["Push", "Pull", "Legs", "Upper body", "Lower body", "Full body", "Cardio", "Mobility"] },
      { key: "minutes", label: "Minutes", type: "number", required: true, min: 1, max: 600 },
      { key: "highlights", label: "Top sets or exercises", type: "text",
        placeholder: "Bench 3×5 @ 185, 20 min incline walk" },
    ],
    summary: (d) => [d.workout, d.minutes && `${d.minutes} min`].filter(Boolean).join(" · "),
    reflect: "How did it feel? Any PRs, or anything that felt off?",
  },
  {
    id: "poetry", name: "Writing Poetry", hue: 25, skill: "writing",
    tagline: "One poem a session. Finished beats perfect.",
    verb: "write a poem",
    example: "Every night, I will write a poem at 9:30 PM.",
    defaults: { days: [0, 1, 2, 3, 4, 5, 6], time: "21:30" },
    icon: ico('<path d="M3.5 16.5l1-4L13 4a2 2 0 0 1 3 3l-8.5 8.5z"/><path d="M11.5 5.5l3 3"/>'),
    proof: {
      types: ["text", "photo"],
      text: "Paste your poem",
      photo: "A photo of your handwritten draft",
    },
    fields: [
      { key: "title", label: "Title", type: "text", required: true, placeholder: "Untitled is fine" },
      { key: "form", label: "Form", type: "select", required: true,
        options: ["Free verse", "Sonnet", "Haiku", "Villanelle", "Ghazal", "Prose poem", "Limerick", "Other"] },
      { key: "theme", label: "What's it about?", type: "text", placeholder: "Grief, my grandmother's kitchen" },
    ],
    summary: (d) => [d.title && `“${d.title}”`, d.form].filter(Boolean).join(" · "),
    reflect: "What were you trying to say? What would you change in the next draft?",
  },
  {
    id: "reading", name: "Reading a Book", hue: 265, skill: "reading",
    tagline: "A few pages a day adds up to a shelf a year.",
    verb: "read",
    example: "Every day, I will read 20 pages at 10:00 PM.",
    defaults: { days: [0, 1, 2, 3, 4, 5, 6], time: "22:00" },
    icon: ico('<path d="M10 5C8 3.5 5 3 2 3.5v12c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5v-12C15 3 12 3.5 10 5z"/><path d="M10 5v12"/>'),
    proof: {
      types: ["photo"],
      photo: "A photo of the page you stopped on",
    },
    fields: [
      { key: "book", label: "Book", type: "text", required: true, placeholder: "Atomic Habits" },
      { key: "author", label: "Author", type: "text", placeholder: "James Clear" },
      { key: "pages", label: "Pages read", type: "number", required: true, min: 1, max: 2000 },
    ],
    summary: (d) => [d.book && `${d.book}${d.author ? ` by ${d.author}` : ""}`, d.pages && `${d.pages} pages`]
      .filter(Boolean).join(" · "),
    reflect: "What stuck with you? A line, an idea, a question.",
  },
  {
    id: "leetcode", name: "Solving a LeetCode Problem", hue: 150,
    tagline: "One problem a session. Understand it, don't just pass it.",
    verb: "solve a LeetCode problem",
    example: "Every weekday, I will solve one LeetCode problem at 6:30 PM.",
    defaults: { days: [1, 2, 3, 4, 5], time: "18:30" },
    icon: ico('<path d="M7 6l-4 4 4 4M13 6l4 4-4 4M11.5 3.5l-3 13"/>'),
    proof: {
      types: ["link", "photo"],
      link: "Link to your accepted submission",
      photo: "A screenshot of the “Accepted” result",
    },
    fields: [
      { key: "problem", label: "Problem", type: "text", required: true, placeholder: "1. Two Sum" },
      { key: "difficulty", label: "Difficulty", type: "select", required: true, options: ["Easy", "Medium", "Hard"] },
      { key: "language", label: "Language", type: "select",
        options: ["Python", "JavaScript", "TypeScript", "Java", "C++", "C#", "Go", "Rust", "Other"] },
      { key: "topics", label: "Topics", type: "text", placeholder: "Hash map, two pointers" },
    ],
    summary: (d) => [d.problem, d.difficulty, d.language].filter(Boolean).join(" · "),
    reflect: "What was the key insight? Where did you get stuck?",
  },
];

const habitById = (id) => HABITS.find((h) => h.id === id);

const PROOF_LABELS = { photo: "Photo", link: "Link", text: "Paste it" };

/* ---------- Formatting ---------- */

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// "07:30" → "7:30 AM"
function fmtTime(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

// "07:30", 30 → "07:00" (wraps past midnight)
function minusMinutes(hhmm, min) {
  const [h, m] = hhmm.split(":").map(Number);
  const t = (((h * 60 + m - min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

function fmtDays(days) {
  const s = [...days].sort().join("");
  if (s === "0123456") return "every day";
  if (s === "12345") return "weekdays";
  if (s === "06") return "weekends";
  return [...days].sort().map((d) => DAY_SHORT[d]).join(", ");
}

// Local calendar date as "YYYY-MM-DD".
function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ---------- Commitment parsing ---------- */

// Pulls the schedule out of a statement like "Every weekday, I will go to the gym at
// 7:00 AM." Returns { days?, time? } with whatever it could find; the onboarding form
// shows the result as editable controls, so a miss just means the user picks by hand.
function parseCommitment(text) {
  const t = ` ${text.toLowerCase()} `;
  const out = {};

  if (/\b(every\s*day|everyday|daily|each day|every (morning|afternoon|evening|night))\b/.test(t)) out.days = [0, 1, 2, 3, 4, 5, 6];
  else if (/\b(weekdays?|mon(day)?\s*(-|–|to|through|thru)\s*fri(day)?)\b/.test(t)) out.days = [1, 2, 3, 4, 5];
  else if (/\bweekends?\b/.test(t)) out.days = [0, 6];
  else {
    const names = [/\bsundays?\b/, /\b(mondays?|mon)\b/, /\b(tuesdays?|tues?)\b/, /\b(wednesdays?|wed)\b/,
      /\b(thursdays?|thu|thurs?)\b/, /\b(fridays?|fri)\b/, /\bsaturdays?\b/];
    const days = names.flatMap((re, i) => (re.test(t) ? [i] : []));
    if (days.length) out.days = days;
  }

  let m;
  if (/\bnoon\b/.test(t)) out.time = "12:00";
  else if (/\bmidnight\b/.test(t)) out.time = "00:00";
  else if ((m = t.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?=[\s,.;!)]|$)/))) {
    let h = Number(m[1]) % 12;
    if (m[3][0] === "p") h += 12;
    const min = Number(m[2] || 0);
    if (Number(m[1]) <= 12 && min < 60) out.time = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  } else if ((m = t.match(/\bat\s+(\d{1,2})[:.](\d{2})\b/))) {
    const h = Number(m[1]), min = Number(m[2]);
    if (h < 24 && min < 60) out.time = `${String(h).padStart(2, "0")}:${m[2]}`;
  }
  return out;
}

/* ---------- API ---------- */

// Calls /api/me/<path>. Rejects with the server's message on errors.
async function meApi(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(`/api/me/${path}`, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("Can't reach the server. Check your connection and try again.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message || `Request failed (${res.status})`);
  return data;
}


/* ---------- Phone reminders: phone + code form ---------- */

// "+15551234567" → "(555) 123-4567"; other countries are shown as stored.
const fmtPhone = (p) => (/^\+1\d{10}$/.test(p || "") ? `(${p.slice(2, 5)}) ${p.slice(5, 8)}-${p.slice(8)}` : p || "");

const okIcon = `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// Markup for the reminders box, from GET /api/me/phone (configured, channel, phone, verified,
// pending, windowOpen, hasMessagedUs, chatLink; see api/me.js). Wording follows the active
// channel (s.channel.label, e.g. "WhatsApp"), which is set server-side in lib/messaging.
// `changing`: the user asked to enter a different number.
function phoneFormHTML(s, changing = false) {
  if (!s.configured) {
    return `<div class="notice">Phone reminders aren't switched on for this server yet. Your commitments are saved.</div>`;
  }
  const via = s.channel?.label || "text";
  if (s.verified && !changing) {
    // Some channels (WhatsApp) only let us message people freely within N hours of their last
    // message to us, so new users are asked to say hi once (later replies keep it open).
    const sayHi = s.channel?.replyWindowHours && !s.hasMessagedUs && s.chatLink ? `
      <div class="say-hi">
        <p><b>One last step:</b> send us a quick “Hi” on ${esc(via)} so your reminders can reach you.</p>
        <a class="btn btn--wa" href="${esc(s.chatLink)}" target="_blank" rel="noopener">Say hi on ${esc(via)}</a>
      </div>` : "";
    return `<div class="notice notice--ok">${okIcon}<span><b>Reminders go to ${esc(fmtPhone(s.phone))} on ${esc(via)}.</b>
        Reply STATUS any time to see what's left today.</span></div>${sayHi}
      <div class="phone-actions">
        <button type="button" class="link-btn" data-phone="change">Use a different number</button>
        <button type="button" class="link-btn" data-phone="off">Turn off reminders</button>
      </div>`;
  }
  if (s.pending && !changing) {
    return `<form class="phone-form" data-phone-form="verify" novalidate>
        <label class="commit__field">
          <span class="ob-label">We sent a code to ${esc(fmtPhone(s.phone))} on ${esc(via)}</span>
          <input class="field phone-input" name="code" inputmode="numeric" autocomplete="one-time-code"
            maxlength="8" placeholder="Code" required />
        </label>
        <button type="submit" class="btn btn--primary">Confirm</button>
      </form>
      <div class="phone-actions">
        <button type="button" class="link-btn" data-phone="resend">Send a new code</button>
        <button type="button" class="link-btn" data-phone="change">Change number</button>
      </div>
      <p class="ob__err" data-phone-err role="alert"></p>`;
  }
  return `<form class="phone-form" data-phone-form="send" novalidate>
      <label class="commit__field">
        <span class="ob-label">${esc(via === "WhatsApp" ? "WhatsApp number" : "Mobile number")}</span>
        <input class="field phone-input" name="phone" type="tel" autocomplete="tel" inputmode="tel"
          placeholder="(555) 123-4567" value="${esc(changing ? "" : fmtPhone(s.phone))}" required />
      </label>
      <button type="submit" class="btn btn--primary">Send me a code</button>
    </form>
    <p class="muted phone-fine">We'll send a code on ${esc(via)} to confirm it's you. Reply PAUSE any time to stop reminders.</p>
    <p class="ob__err" data-phone-err role="alert"></p>`;
}

// Wires the box rendered by phoneFormHTML inside `root`. Calls onChange(status) after
// each successful request; the caller re-renders from it.
function bindPhoneForm(root, getStatus, onChange) {
  let changing = false;
  const render = () => { root.innerHTML = phoneFormHTML(getStatus(), changing); };
  const run = async (btn, fn) => {
    const err = root.querySelector("[data-phone-err]");
    if (err) err.textContent = "";
    if (btn) btn.disabled = true;
    try {
      const s = await fn();
      changing = false;
      onChange(s);
      render();
      root.querySelector('[name="code"]')?.focus();
    } catch (e) {
      if (err) err.textContent = e.message;
      if (btn) btn.disabled = false;
    }
  };
  root.addEventListener("submit", (e) => {
    const form = e.target.closest("[data-phone-form]");
    if (!form) return;
    e.preventDefault();
    const btn = form.querySelector("[type=submit]");
    if (form.dataset.phoneForm === "send") {
      run(btn, () => meApi("phone", { method: "POST", body: { phone: form.phone.value } }));
    } else {
      run(btn, () => meApi("phone/verify", { method: "POST", body: { code: form.code.value } }));
    }
  });
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-phone]");
    if (!b) return;
    const a = b.dataset.phone;
    if (a === "change") { changing = true; render(); root.querySelector('[name="phone"]')?.focus(); }
    if (a === "resend") run(b, () => meApi("phone", { method: "POST", body: { phone: getStatus().phone } }));
    if (a === "off") run(b, () => meApi("phone", { method: "DELETE" }));
  });
  render();
}
