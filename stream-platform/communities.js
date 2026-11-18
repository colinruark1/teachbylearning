// Communities — one per skill (SKILLS in skills.js). Each has members streaming themselves
// learning (LIVE_STREAMS), a progress feed sorted by popularity, and a discussion forum.
// The hub lets members request new communities and upvote requests (REQUESTS); a request
// that reaches REQUEST_GOAL is ready to open as a new SKILLS entry.
// Mock data persisted to localStorage. Replace `load`/`persist` with a real API and
// `LIVE_STREAMS` with the streaming backend. Strava is real: /api/strava (api/strava.js)
// handles OAuth and lists the signed-in user's own activities.

const $ = (sel, root = document) => root.querySelector(sel);
const main = $("#learnMain");

const ME = { user: "You", hue: 28 };
const HOUR = 36e5;
const ago = (h) => Date.now() - h * HOUR;
const uid = () => Math.random().toString(36).slice(2, 10);
const MAX_MEDIA = 4;

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const avatar = (user, hue, cls = "") =>
  `<span class="channel__avatar ${cls}" style="background:hsl(${hue},60%,45%)" aria-hidden="true">${esc(user[0])}</span>`;

function timeAgo(t) {
  const m = (Date.now() - t) / 60000;
  if (m < 1) return "just now";
  if (m < 60) return `${Math.floor(m)}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  if (m < 10080) return `${Math.floor(m / 1440)}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
const fmtMinutes = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`);
const fmtDuration = (sec) => {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}h ${m}m` : `${m}m ${String(s).padStart(2, "0")}s`;
};
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const replies = (n) => `${n} ${n === 1 ? "reply" : "replies"}`;
const lastActivity = (p) => Math.max(p.t, ...p.comments.map((c) => c.t));
const skillById = (id) => SKILLS.find((s) => s.id === id);

const ICONS = {
  heart: ico('<path d="M10 16.5S3 12.4 3 7.6A3.5 3.5 0 0 1 10 6a3.5 3.5 0 0 1 7 1.6c0 4.8-7 8.9-7 8.9z"/>'),
  comment: ico('<path d="M3 4h14v9H8.5L5 16v-3H3z"/>'),
  clock: ico('<circle cx="10" cy="10" r="7"/><path d="M10 6v4l2.5 2"/>'),
  media: ico('<rect x="2.5" y="4" width="15" height="12" rx="1.5"/><circle cx="7" cy="8.5" r="1.5"/><path d="M17.5 13l-4-4-7 7"/>'),
  play: ico('<path d="M7 5l8 5-8 5z"/>'),
  pulse: ico('<path d="M2 10h3.5l2-5 4 10 2-5H18"/>'),
  trash: ico('<path d="M4 6h12M8 6V4h4v2M5.5 6l1 11h7l1-11"/>'),
  grid: ico('<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="11" y="3" width="6" height="6" rx="1"/><rect x="3" y="11" width="6" height="6" rx="1"/><rect x="11" y="11" width="6" height="6" rx="1"/>'),
  text: ico('<path d="M4 5h12M4 9h12M4 13h8"/>'),
  up: ico('<path d="M5 12l5-5 5 5"/>'),
  live: ico('<circle cx="10" cy="10" r="2"/><path d="M6.5 6.5a5 5 0 0 0 0 7M13.5 6.5a5 5 0 0 1 0 7M4 4a8.5 8.5 0 0 0 0 12M16 4a8.5 8.5 0 0 1 0 12"/>'),
};

// ---------- Mock live streams: members streaming themselves learning ----------
// startedH: hours since the stream went live.
const LIVE_STREAMS = [
  { skill: "writing", sub: "Creative Writing", user: "QuietQuill", hue: 180, viewers: 412, startedH: 1.4, title: "Writing sprint: 2,000 words of my fantasy novel — come write along" },
  { skill: "writing", sub: "Professional Writing", user: "Devon Okafor", hue: 200, viewers: 96, startedH: 0.5, title: "Rewriting my résumé bullets live — roast them" },
  { skill: "art", sub: "Digital Art", user: "Ines Calder", hue: 280, viewers: 1830, startedH: 2.2, title: "Painting a forest spirit from thumbnail to final" },
  { skill: "art", sub: "Sketching", user: "Theo Marsh", hue: 160, viewers: 640, startedH: 0.8, title: "Day 61 of hand studies — 30-second gestures" },
  { skill: "art", sub: "Painting", user: "Ben Whitaker", hue: 140, viewers: 88, startedH: 0.3, title: "First time with cotton watercolor paper" },
  { skill: "cooking", sub: "Baking", user: "Sam Rivera", hue: 15, viewers: 2210, startedH: 3.1, title: "Sourdough #7 — shaping and scoring, Q&A while it proofs" },
  { skill: "cooking", sub: "Preparing Meals", user: "ChillChef", hue: 30, viewers: 1340, startedH: 1.1, title: "Fresh pasta from scratch, no pasta machine 🍝" },
  { skill: "speaking", sub: "Presenting", user: "Alexis Grant", hue: 220, viewers: 154, startedH: 0.6, title: "Practicing my conference talk — timed run, feedback welcome" },
  { skill: "instrument", sub: "Guitar", user: "Leo Brandt", hue: 45, viewers: 920, startedH: 1.7, title: "Learning 'Blackbird' fingerstyle at 60 bpm" },
  { skill: "instrument", sub: "Piano", user: "Hana Sato", hue: 300, viewers: 505, startedH: 0.9, title: "Clair de Lune page 2 — slow practice, wrong notes included" },
  { skill: "language", sub: "Spanish", user: "Lucía Ortega", hue: 10, viewers: 1120, startedH: 0.4, title: "Language exchange 🇪🇸🇬🇧 — hop in chat and practice" },
  { skill: "language", sub: "Japanese", user: "Marco Bellini", hue: 120, viewers: 310, startedH: 2.5, title: "Reading my first graded reader out loud (N4)" },
  { skill: "reading", sub: "Reading More Often", user: "Priya Nair", hue: 350, viewers: 260, startedH: 1.0, title: "Silent reading co-work — 50 min on, 10 off" },
  { skill: "fitness", sub: "Weightlifting", user: "Marcus Hale", hue: 260, viewers: 1675, startedH: 0.7, title: "Deadlift day — working up to a 145 kg triple" },
  { skill: "fitness", sub: "Running", user: "Nadia Kerr", hue: 5, viewers: 730, startedH: 0.2, title: "Treadmill 10K, chat picks my playlist" },
  { skill: "photography", sub: "Editing Photos", user: "Ravi Menon", hue: 185, viewers: 480, startedH: 1.3, title: "Editing last night's street photos — viewer RAW files welcome" },
  { skill: "dancing", sub: "Learning Routines", user: "Jordan Lee", hue: 340, viewers: 990, startedH: 0.5, title: "Learning a new routine from zero in one stream 💃" },
];
const liveIn = (skillId, sub) =>
  LIVE_STREAMS.filter((s) => s.skill === skillId && (!sub || s.sub === sub)).sort((a, b) => b.viewers - a.viewers);

// ---------- Community requests (the list of communities keeps growing from these) ----------
const REQUEST_GOAL = 250;
const seedRequests = () => [
  { id: uid(), name: "Coding", votes: 231, voted: false },
  { id: uid(), name: "Chess", votes: 188, voted: false },
  { id: uid(), name: "Gardening", votes: 142, voted: false },
  { id: uid(), name: "Woodworking", votes: 97, voted: false },
  { id: uid(), name: "Knitting", votes: 64, voted: false },
];

// "Popular": engagement that fades with age, so a great post from today beats an old one.
const score = (p) => (p.likes + 2 * p.comments.length) / Math.pow((Date.now() - p.t) / HOUR + 2, 0.6);
const byPopular = (a, b) => score(b) - score(a);

// ---------- Strava (via /api/strava, see api/strava.js) ----------
// null = not fetched yet; otherwise { configured, connected, athlete, activities, error? }.
let strava = null;
let stravaLoading = false;

async function loadStrava() {
  stravaLoading = true;
  refreshStrava();
  try {
    const res = await fetch("/api/strava/activities", { credentials: "same-origin" });
    const data = await res.json().catch(() => ({}));
    strava = res.ok ? data : { ...(strava || {}), activities: strava?.activities || [], error: data.message || "Couldn't reach Strava." };
  } catch {
    strava = { ...(strava || {}), activities: [], error: "Couldn't reach Strava. Check your connection." };
  }
  stravaLoading = false;
  refreshStrava();
}

// ---------- Seed posts ----------
const U = {
  mara: ["Mara Ellison", 330], devon: ["Devon Okafor", 200], theo: ["Theo Marsh", 160], ines: ["Ines Calder", 280],
  sam: ["Sam Rivera", 15], jun: ["Jun Park", 95], alexis: ["Alexis Grant", 220], leo: ["Leo Brandt", 45],
  hana: ["Hana Sato", 300], marco: ["Marco Bellini", 120], lucia: ["Lucía Ortega", 10], claire: ["Claire Dubois", 240],
  omar: ["Omar Haddad", 60], nadia: ["Nadia Kerr", 5], marcus: ["Marcus Hale", 260], ravi: ["Ravi Menon", 185],
  jordan: ["Jordan Lee", 340], priya: ["Priya Nair", 350], ben: ["Ben Whitaker", 140],
};
const by = (k) => ({ user: U[k][0], hue: U[k][1] });
const c = (k, body, h) => ({ id: uid(), ...by(k), body, t: ago(h) });
const img = (label) => ({ type: "image", label });
const vid = (label) => ({ type: "video", label });
const post = (k, o) => ({
  id: uid(), kind: "progress", title: null, minutes: null, media: [], strava: null,
  comments: [], likes: 0, liked: false, ...by(k), ...o, t: ago(o.h),
});
const thread = (k, o) => post(k, { kind: "thread", ...o });

function seedPosts() {
  return [
    // Writing
    post("mara", { skill: "writing", sub: "Creative Writing", h: 3, minutes: 90, likes: 42, media: [img("Draft, page 1")],
      body: "Finished the first draft of my short story! 4,200 words about a lighthouse keeper who collects lost letters. It's messy but it EXISTS.",
      comments: [c("priya", "That premise is so good. Do you share drafts with a group?", 2), c("mara", "Not yet — might post an excerpt in Discussions this week!", 1)] }),
    post("priya", { skill: "writing", sub: "Storytelling", h: 30, minutes: 20, likes: 18,
      body: "Day 30 of morning pages ✅ Three pages every day before coffee. Biggest change: I stopped waiting to feel inspired." }),
    thread("devon", { skill: "writing", sub: "Professional Writing", h: 20, likes: 9,
      title: "How do you cut a two-page cover letter down to one?",
      body: "Every time I edit I end up cutting the parts that actually sound like me. Any frameworks for deciding what stays?",
      comments: [c("mara", "One story, one number, one reason you want *this* job. Everything else goes.", 18), c("ben", "Read it out loud. Any sentence you rush through is a sentence you can delete.", 12)] }),

    // Drawing / Art
    post("theo", { skill: "art", sub: "Sketching", h: 6, minutes: 45, likes: 128, media: [img("Day 1"), img("Day 30")],
      body: "One month of daily hand studies — left is day 1, right is day 30. Hands are still terrifying but less so.",
      comments: [c("ines", "The knuckle structure on day 30 is a huge jump!", 5), c("jordan", "Saving this for motivation 🙌", 4)] }),
    post("ines", { skill: "art", sub: "Digital Art", h: 40, minutes: 180, likes: 76, media: [img("Forest spirit — final")],
      body: "First full digital painting I'm actually proud of. Learned to block in values in grayscale before adding any color." }),
    thread("ben", { skill: "art", sub: "Painting", h: 55, likes: 6,
      title: "Watercolor paper recommendations for a beginner?",
      body: "Student-grade paper keeps pilling when I layer. Is 100% cotton worth it this early?",
      comments: [c("ines", "Yes — cotton paper makes learning washes so much easier. Buy a small block so it's not expensive.", 50)] }),

    // Cooking
    post("sam", { skill: "cooking", sub: "Baking", h: 2, minutes: 240, likes: 214, media: [img("Crumb shot"), img("Crust")],
      body: "Sourdough attempt #6 — finally got an open crumb! Key change: a longer bulk ferment (6h at 24°C) and a gentler shape.",
      comments: [c("jun", "Attempt 6 and it looks like that?! What flour?", 1.5), c("sam", "70% bread flour, 30% whole wheat. Nothing fancy.", 1), c("lucia", "Bookmarking the bulk ferment tip.", 0.5)] }),
    post("jun", { skill: "cooking", sub: "Preparing Meals", h: 26, minutes: 60, likes: 37, media: [img("Five lunches")],
      body: "Meal-prepped five lunches for under $25: gochujang chicken, rice, and quick-pickled cucumbers." }),
    thread("omar", { skill: "cooking", sub: "Learning Recipes", h: 70, likes: 14,
      title: "What's a good 'first real recipe' to build fundamentals?",
      body: "I can follow recipes but I don't understand *why* they work. Looking for a dish that teaches technique.",
      comments: [c("sam", "A simple pan sauce. Sear, deglaze, reduce, mount with butter — it teaches heat control.", 60)] }),

    // Public Speaking
    post("alexis", { skill: "speaking", sub: "Presenting", h: 8, minutes: 20, likes: 58, media: [vid("Rehearsal take 3")],
      body: "Recorded my 5-minute talk rehearsal. Cut my 'um's from 23 down to 7 since last week. Feedback welcome!",
      comments: [c("claire", "Your pacing in the second half is great. Maybe pause longer before the key stat?", 6)] }),
    thread("priya", { skill: "speaking", sub: "Speaking Confidently", h: 48, likes: 21,
      title: "How do you handle your mind going blank mid-talk?",
      body: "It happened in a team meeting today and I just froze for what felt like a full minute.",
      comments: [c("alexis", "Repeat your last sentence slowly. It buys time and sounds like emphasis.", 40), c("devon", "Keep a one-line outline on a card. Just knowing it's there helps.", 30)] }),

    // Playing an Instrument
    post("leo", { skill: "instrument", sub: "Guitar", h: 4, minutes: 35, likes: 97, media: [vid("F chord progression")],
      body: "Finally nailed the F barre chord cleanly 🎸 Three weeks of buzzing. Rolling my index finger slightly onto its side was the trick." }),
    post("hana", { skill: "instrument", sub: "Piano", h: 34, minutes: 50, likes: 64,
      body: "Played the first page of Clair de Lune all the way through without stopping. Slow, but every note was there." }),
    thread("ben", { skill: "instrument", sub: "Drums", h: 80, likes: 5,
      title: "Practice pad vs. electronic kit for apartment living?",
      body: "Neighbors are already side-eyeing me. Is a pad enough to build real skills?",
      comments: [c("leo", "Pad for rudiments, then rent rehearsal space once a week for the full kit.", 70)] }),

    // Learning a Language (forum-first)
    thread("marco", { skill: "language", sub: "Japanese", h: 5, likes: 23,
      title: "Finished Genki I — what should come next?",
      body: "I know about 300 kanji and can handle basic conversations. Genki II, or start on graded readers?",
      comments: [c("hana", "Both! Genki II for grammar, plus Tadoku graded readers for volume.", 4), c("claire", "Add a weekly tutor session if you can. Speaking is what plateaus first.", 3)] }),
    thread("lucia", { skill: "language", sub: "Spanish", h: 22, likes: 31,
      title: "Language exchange partner thread 🇪🇸 — introduce yourself here",
      body: "Native Spanish speaker learning English. Say what level you're at and when you're free, and let's pair up!",
      comments: [c("omar", "A2 Spanish, free weekday evenings (EST). Would love to practice!", 20), c("jun", "B1, mostly weekends. Interested in food vocab 😄", 15)] }),
    thread("claire", { skill: "language", sub: "French", h: 60, likes: 8,
      title: "Is the subjunctive worth drilling early?",
      body: "My textbook introduces it in chapter 4 and I'm struggling. Should I just push past it?",
      comments: [] }),
    post("omar", { skill: "language", sub: "Spanish", h: 12, minutes: 25, likes: 45,
      body: "A 300-day streak, but more importantly: my first 10-minute conversation with my neighbor entirely in Spanish." }),

    // Reading (forum-first)
    thread("ben", { skill: "reading", sub: "Reading More Often", h: 9, likes: 27,
      title: "What's your trick for reading more often?",
      body: "Mine: a book in every room. Paperback by the couch, ebook on my phone, audiobook for walks.",
      comments: [c("priya", "I swapped 20 minutes of scrolling in bed for reading. 9 books so far this year.", 7)] }),
    thread("devon", { skill: "reading", sub: "Comprehension", h: 44, likes: 12,
      title: "Annotating vs. summarizing after each chapter — which sticks better?",
      body: "Testing both on nonfiction. Curious what has worked for others.",
      comments: [c("mara", "A three-sentence summary from memory, then check the chapter. Retrieval beats highlighting.", 40)] }),
    post("priya", { skill: "reading", sub: "Reading Faster", h: 50, minutes: 40, likes: 19,
      body: "Book 12 of the year done. I don't really read faster — I just stopped subvocalizing on easy passages." }),

    // Fitness (Strava)
    post("nadia", { skill: "fitness", sub: "Running", h: 1, minutes: 62, likes: 156,
      strava: { type: "Run", name: "First double digits!", distanceKm: 10.2, movingSec: 3712, elevM: 48, seed: 5 },
      body: "First double-digit run! 10.2 km without walking breaks. Six months ago I couldn't run to the end of my street.",
      comments: [c("marcus", "HUGE. Congrats!", 0.8), c("ravi", "That negative split though 👀", 0.5)] }),
    post("marcus", { skill: "fitness", sub: "Weightlifting", h: 18, minutes: 70, likes: 88, media: [vid("PR set")],
      body: "Deadlift PR: 140 kg × 3. Bracing cue that finally clicked: 'bend the bar around your shins.'" }),
    post("claire", { skill: "fitness", sub: "Flexibility", h: 36, minutes: 20, likes: 41,
      body: "Day 45 of my splits routine — 15 cm from the floor now. Consistency beats intensity." }),
    thread("jordan", { skill: "fitness", sub: "Running", h: 66, likes: 17,
      title: "Couch to 5K graduates — what did you do next?",
      body: "Just finished C25K and I'm not sure whether to train for a 10K or work on speed.",
      comments: [c("nadia", "10K plan! Building distance slowly was the most fun part for me.", 60)] }),

    // Photography
    post("ravi", { skill: "photography", sub: "Taking Photos", h: 7, minutes: 90, likes: 133,
      media: [img("Golden hour, bridge"), img("Reflections"), img("Street corner")],
      body: "Golden hour walk with a 35mm prime. Forcing myself to use one focal length is teaching me to move my feet." }),
    post("jun", { skill: "photography", sub: "Editing Photos", h: 46, minutes: 30, likes: 52, media: [img("Before"), img("After")],
      body: "Before and after of my first real edit. Lowered highlights, warmed white balance, and a gentle S-curve." }),
    thread("theo", { skill: "photography", sub: "Taking Photos", h: 90, likes: 11,
      title: "Best way to learn manual mode?",
      body: "Auto mode feels like a crutch, but every time I switch to manual my photos get worse.",
      comments: [c("ravi", "Start with aperture priority for a month and only control depth of field. Then add shutter.", 85)] }),

    // Dancing
    post("jordan", { skill: "dancing", sub: "Learning Routines", h: 11, minutes: 60, likes: 110, media: [vid("Chorus run-through")],
      body: "Learned the full chorus choreography in one weekend 💃 Breaking it into 8-counts and drilling at 0.75× speed made it doable." }),
    thread("hana", { skill: "dancing", sub: "Rhythm", h: 58, likes: 15,
      title: "Drills for staying on beat when the music is fast?",
      body: "I lose the count during quick sections and end up rushing.",
      comments: [c("jordan", "Clap only the downbeats along with the song, then add steps. Feeling the 1 is everything.", 50)] }),
  ];
}

// ---------- Store (localStorage, falls back to memory) ----------
const STORE_KEY = "tbl.learn.v1";

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      saved.requests ??= seedRequests(); // saved before requests existed
      return saved;
    }
  } catch {}
  return { posts: seedPosts(), joined: [], requests: seedRequests() };
}

const state = load();

// Videos only live as session blob URLs (too big for localStorage), so drop them on save.
function persist() {
  const posts = state.posts.map((p) =>
    p.media.some((m) => m.session)
      ? { ...p, media: p.media.map((m) => (m.session ? { type: m.type, label: m.label, unsaved: true } : m)) }
      : p
  );
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ ...state, posts }));
  } catch {
    toast("Couldn't save — browser storage is full. This change will be lost on reload.");
  }
}

// ---------- UI state ----------
let view = { skill: null, tab: "progress", sub: null, sort: "top" };
let query = ""; // hub search
let draft = { media: [], strava: null };
let stravaOpen = false;
const openComments = new Set();
const openThreads = new Set();

let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("is-shown");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-shown"), 3200);
}

// ---------- Components ----------
function mediaHTML(media) {
  if (!media?.length) return "";
  const items = media.slice(0, MAX_MEDIA);
  return `<div class="media media--${items.length}">${items
    .map((m) => {
      if (m.src) {
        return `<div class="media__item">${
          m.type === "video"
            ? `<video src="${m.src}" controls playsinline preload="metadata"></video>`
            : `<img src="${m.src}" alt="${esc(m.label || "Uploaded photo")}" loading="lazy" />`
        }</div>`;
      }
      return `<div class="media__item"><div class="media__placeholder">
          ${m.type === "video" ? ICONS.play : ICONS.media}
          <span>${esc(m.label)}</span>
          ${m.unsaved ? `<span class="media__note">Videos aren't stored in this demo</span>` : ""}
        </div></div>`;
    })
    .join("")}</div>`;
}

const pace = (a) => {
  if (/Ride$/.test(a.type)) return ["Speed", `${(a.distanceKm / (a.movingSec / 3600)).toFixed(1)} km/h`];
  const s = Math.round(a.movingSec / a.distanceKm);
  return ["Pace", `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} /km`];
};
const activitySummary = (a) => `${a.distanceKm ? `${a.distanceKm.toFixed(1)} km · ` : ""}${fmtDuration(a.movingSec)}`;

// A closed, wobbly loop seeded per activity — stands in for the activity's map polyline.
function routeSVG(seed) {
  const p1 = seed * 1.7, p2 = seed * 2.3, pts = [];
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const r = 1 + 0.18 * Math.sin(3 * a + p1) + 0.1 * Math.sin(5 * a + p2);
    pts.push(`${(50 + Math.cos(a) * 40 * r).toFixed(1)},${(32 + Math.sin(a) * 22 * r).toFixed(1)}`);
  }
  const [sx, sy] = pts[0].split(",");
  return `<svg class="strava-card__route" viewBox="0 0 100 64" aria-hidden="true">
    <polyline points="${pts.join(" ")}" /><circle cx="${sx}" cy="${sy}" r="2.6" /></svg>`;
}

// The real route from Strava (points pre-fitted to the viewBox by lib/strava.js).
function realRouteSVG(points) {
  if (!/^[\d., -]+$/.test(points)) return "";
  const [sx, sy] = points.split(" ")[0].split(",");
  return `<svg class="strava-card__route" viewBox="0 0 100 64" aria-hidden="true">
    <polyline points="${points}" /><circle cx="${sx}" cy="${sy}" r="2.6" /></svg>`;
}

function stravaCard(a) {
  const stats = [];
  if (a.distanceKm) stats.push(["Distance", `${a.distanceKm.toFixed(1)} km`], pace(a));
  stats.push(["Time", fmtDuration(a.movingSec)]);
  if (a.elevM) stats.push(["Elevation", `${a.elevM} m`]);
  return `<div class="strava-card">
    <div class="strava-card__text">
      <p class="strava-card__head">${ICONS.pulse}${esc(a.type)} · synced from Strava</p>
      <p class="strava-card__name">${esc(a.name)}</p>
      <dl class="strava-card__stats">${stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
      ${/^\d+$/.test(a.stravaId || "") ? `<a class="strava-card__link" href="https://www.strava.com/activities/${a.stravaId}" target="_blank" rel="noopener">View on Strava</a>` : ""}
    </div>
    ${a.route ? realRouteSVG(a.route) : a.distanceKm && a.seed != null ? routeSVG(a.seed) : ""}
  </div>`;
}

function actionsHTML(p, { commentToggle = true } = {}) {
  const n = p.comments.length;
  const commentLabel = p.kind === "thread" ? replies(n) : plural(n, "comment");
  return `<div class="post__actions">
    <button class="action ${p.liked ? "is-liked" : ""}" data-action="like" aria-pressed="${p.liked}" aria-label="Like (${p.likes})">
      ${ICONS.heart}<span>${p.likes}</span>
    </button>
    ${
      commentToggle
        ? `<button class="action" data-action="toggle-comments" aria-expanded="${openComments.has(p.id)}">${ICONS.comment}<span>${commentLabel}</span></button>`
        : `<span class="action action--static">${ICONS.comment}<span>${commentLabel}</span></span>`
    }
  </div>`;
}

function commentsHTML(p) {
  return `<div class="comments">
    <ul class="comments__list">${p.comments
      .map(
        (cm) => `<li class="comment">
          ${avatar(cm.user, cm.hue, "channel__avatar--sm")}
          <div class="comment__bubble">
            <p class="comment__head"><strong>${esc(cm.user)}</strong><span>${timeAgo(cm.t)}</span></p>
            <p class="comment__body">${esc(cm.body)}</p>
          </div>
        </li>`
      )
      .join("")}</ul>
    <form class="comment-form" data-form="comment">
      ${avatar(ME.user, ME.hue, "channel__avatar--sm")}
      <input class="field" name="body" autocomplete="off" required maxlength="1000"
        placeholder="${p.kind === "thread" ? "Write a reply…" : "Add a comment…"}" aria-label="Comment" />
      <button class="btn btn--primary" type="submit">Send</button>
    </form>
  </div>`;
}

const deleteBtn = (p) =>
  p.user === ME.user
    ? `<button class="icon-btn post__delete" data-action="delete" aria-label="Delete post" title="Delete">${ICONS.trash}</button>`
    : "";

function postCard(p, showSkill) {
  const s = skillById(p.skill);
  return `<article class="post" data-id="${p.id}">
    <header class="post__head">
      ${avatar(p.user, p.hue)}
      <div class="post__who">
        <p><strong>${esc(p.user)}</strong>${showSkill ? ` in <a href="${skillHref(s.id)}">${s.name}</a>` : ""}</p>
        <p class="post__meta">${esc(p.sub)} · ${timeAgo(p.t)}</p>
      </div>
      ${p.minutes ? `<span class="post__minutes" title="Time practiced">${ICONS.clock}${fmtMinutes(p.minutes)}</span>` : ""}
      ${deleteBtn(p)}
    </header>
    ${p.body ? `<p class="post__body">${esc(p.body)}</p>` : ""}
    ${mediaHTML(p.media)}
    ${p.strava ? stravaCard(p.strava) : ""}
    ${actionsHTML(p)}
    ${openComments.has(p.id) ? commentsHTML(p) : ""}
  </article>`;
}

function threadRow(p) {
  const open = openThreads.has(p.id);
  return `<li class="thread ${open ? "is-open" : ""}" data-id="${p.id}">
    <button class="thread__row" data-action="open-thread" aria-expanded="${open}">
      ${avatar(p.user, p.hue)}
      <span class="thread__main">
        <span class="thread__title">${esc(p.title)}</span>
        <span class="thread__meta">${esc(p.user)} · <span class="tag">${esc(p.sub)}</span> · ${timeAgo(lastActivity(p))}</span>
      </span>
      <span class="thread__stat" title="Replies">${ICONS.comment}${p.comments.length}</span>
      <span class="thread__stat ${p.liked ? "is-liked" : ""}" title="Likes">${ICONS.heart}${p.likes}</span>
    </button>
    ${
      open
        ? `<div class="thread__body">
            <div class="thread__toolbar"><span class="post__meta">Posted ${timeAgo(p.t)}</span>${deleteBtn(p)}</div>
            ${p.body ? `<p class="post__body">${esc(p.body)}</p>` : ""}
            ${mediaHTML(p.media)}
            ${actionsHTML(p, { commentToggle: false })}
            ${commentsHTML(p)}
          </div>`
        : ""
    }
  </li>`;
}

function attachmentsHTML() {
  const media = draft.media
    .map(
      (m, i) => `<div class="attachment">
        ${m.type === "video" ? `<video src="${m.src}" muted preload="metadata"></video><span class="attachment__badge">${ICONS.play}</span>` : `<img src="${m.src}" alt="" />`}
        <button type="button" class="attachment__remove" data-action="remove-media" data-i="${i}" aria-label="Remove ${esc(m.label)}">×</button>
      </div>`
    )
    .join("");
  const strava = draft.strava
    ? `<div class="attachment attachment--strava">
        ${ICONS.pulse}<span><strong>${esc(draft.strava.name)}</strong><br />${activitySummary(draft.strava)}</span>
        <button type="button" class="attachment__remove" data-action="remove-strava" aria-label="Remove Strava activity">×</button>
      </div>`
    : "";
  return media + strava;
}

function stravaPanelHTML() {
  if (!stravaOpen) return "";
  if (!strava) return `<div class="strava-panel"><p class="muted">Loading your Strava activities…</p></div>`;
  if (!strava.configured && !strava.error) {
    return `<div class="strava-panel"><p class="muted">Strava isn't set up on this server yet.</p></div>`;
  }
  if (!strava.connected && !strava.error) {
    return `<div class="strava-panel strava-panel--connect">
      <span class="strava-panel__logo">${ICONS.pulse}</span>
      <div class="strava-panel__text">
        <p><strong>Connect Strava</strong></p>
        <p class="muted">Import runs, rides and workouts straight into your progress posts.</p>
      </div>
      <a class="btn btn--strava" href="/api/strava/connect">Connect with Strava</a>
    </div>`;
  }
  const list = strava.activities || [];
  return `<div class="strava-panel">
    <p class="strava-panel__title">${strava.athlete ? `${esc(strava.athlete)}'s recent activities` : "Recent Strava activities"}
      <span>
        <button type="button" class="link-btn" data-action="strava-refresh" ${stravaLoading ? "disabled" : ""}>${stravaLoading ? "Loading…" : "Refresh"}</button>
        · <button type="button" class="link-btn" data-action="strava-disconnect">Disconnect</button>
      </span></p>
    ${strava.error ? `<p class="muted">${esc(strava.error)}</p>` : ""}
    ${!list.length && !strava.error ? `<p class="muted">No activities yet. Record one on Strava, then hit Refresh.</p>` : ""}
    <ul>${list.map(
      (a, i) => `<li><button type="button" class="strava-pick" data-action="strava-attach" data-i="${i}">
        <span class="strava-pick__type">${esc(a.type)}</span>
        <span class="strava-pick__name">${esc(a.name)}</span>
        <span class="muted">${activitySummary(a)} · ${timeAgo(a.t)}</span>
      </button></li>`
    ).join("")}</ul>
    <p class="strava-panel__powered">Powered by Strava</p>
  </div>`;
}

function progressComposer(s, sub) {
  return `<form class="composer" data-form="progress">
    <div class="composer__main">
      ${avatar(ME.user, ME.hue)}
      <textarea class="field" name="body" rows="3" maxlength="4000" aria-label="Progress update"
        placeholder="Share your ${esc(s.name.toLowerCase())} progress — what did you practice, what clicked, what's still hard?"></textarea>
    </div>
    <div class="attachments" id="attachments">${attachmentsHTML()}</div>
    ${s.strava ? `<div id="stravaSlot">${stravaPanelHTML()}</div>` : ""}
    <div class="composer__bar">
      <select class="field" name="sub" aria-label="Topic">${s.subs
        .map((t) => `<option ${t === sub ? "selected" : ""}>${esc(t)}</option>`)
        .join("")}</select>
      <label class="composer__minutes"><input class="field" name="minutes" type="number" min="1" max="1440" placeholder="0" /> min practiced</label>
      <span class="composer__spacer"></span>
      <button type="button" class="composer__tool" data-action="pick-media" title="Add photos or videos">${ICONS.media}<span>Photo/Video</span></button>
      ${
        s.strava
          ? `<button type="button" class="composer__tool composer__tool--strava" data-action="strava-toggle" aria-expanded="${stravaOpen}">${ICONS.pulse}<span>Strava</span></button>`
          : ""
      }
      <button class="btn btn--primary" type="submit">Post</button>
    </div>
  </form>`;
}

function threadComposer(s, sub) {
  return `<form class="composer composer--thread" data-form="thread">
    <input class="field composer__title" name="title" required maxlength="140" aria-label="Discussion title"
      placeholder="Start a discussion — ask a question or share a tip" />
    <textarea class="field" name="body" rows="3" maxlength="4000" aria-label="Details" placeholder="Add details (optional)"></textarea>
    <div class="composer__bar">
      <select class="field" name="sub" aria-label="Topic">${s.subs
        .map((t) => `<option ${t === sub ? "selected" : ""}>${esc(t)}</option>`)
        .join("")}</select>
      <span class="composer__spacer"></span>
      <button class="btn btn--primary" type="submit">Post discussion</button>
    </div>
  </form>`;
}

function topLearnersHTML(s) {
  const since = ago(7 * 24);
  const totals = {};
  state.posts
    .filter((p) => p.skill === s.id && p.minutes && p.t > since)
    .forEach((p) => {
      (totals[p.user] ??= { user: p.user, hue: p.hue, min: 0 }).min += p.minutes;
    });
  const rows = Object.values(totals).sort((a, b) => b.min - a.min).slice(0, 5);
  return `<section class="panel">
    <h2 class="panel__title">Most practice this week</h2>
    ${
      rows.length
        ? `<ol class="leaders">${rows
            .map((r) => `<li>${avatar(r.user, r.hue, "channel__avatar--sm")}<span class="leaders__name">${esc(r.user)}</span><span class="muted">${fmtMinutes(r.min)}</span></li>`)
            .join("")}</ol>`
        : `<p class="muted">No practice logged this week yet — be the first!</p>`
    }
  </section>`;
}

function formatsHTML(s) {
  const rows = [
    [ICONS.text, "Text updates & discussions"],
    [ICONS.media, "Photo & video uploads"],
    [ICONS.clock, "Log minutes practiced"],
  ];
  if (s.strava) rows.push([ICONS.pulse, "Sync activities from Strava"]);
  return `<section class="panel">
    <h2 class="panel__title">Share your progress</h2>
    <ul class="formats">${rows.map(([i, t]) => `<li>${i}${t}</li>`).join("")}</ul>
  </section>`;
}

const fmtUptime = (h) => (h >= 1 ? `${Math.floor(h)}h ${Math.round((h % 1) * 60)}m` : `${Math.round(h * 60)}m`);

// The stream player isn't built yet, so cards are links that explain that (data-action="watch").
function streamCard(st, showSkill) {
  const s = skillById(st.skill);
  return `<article class="stream-card">
    <a class="stream-card__media" href="#" data-action="watch" aria-label="${esc(st.user)} streaming ${esc(st.sub)}">
      <div class="thumb"></div>
      <span class="badge-live">Live</span>
      <span class="badge-viewers">${fmtCount(st.viewers)} watching · ${fmtUptime(st.startedH)}</span>
    </a>
    <div class="stream-card__body">
      ${avatar(st.user, st.hue)}
      <div class="stream-card__text">
        <a href="#" data-action="watch"><h3 class="stream-card__title" title="${esc(st.title)}">${esc(st.title)}</h3></a>
        <p class="stream-card__meta">${esc(st.user)}</p>
        <p class="stream-card__meta">${showSkill ? `<a href="${skillHref(s.id)}">${s.name}</a> · ` : ""}${esc(st.sub)}</p>
      </div>
    </div>
  </article>`;
}

function requestsHTML() {
  const rows = [...state.requests].sort((a, b) => b.votes - a.votes);
  return `<section class="panel" id="requestPanel">
    <h2 class="panel__title">Request a community</h2>
    <p class="muted">Don't see your skill? Request it or upvote one. A community opens at ${REQUEST_GOAL} requests.</p>
    <form class="request-form" data-form="request">
      <input class="field" name="name" required maxlength="40" autocomplete="off" placeholder="What do you want to learn?" aria-label="Community name" />
      <button class="btn btn--primary" type="submit">Request</button>
    </form>
    <ul class="requests">${rows
      .map((r) => {
        const pct = Math.min(100, Math.round((r.votes / REQUEST_GOAL) * 100));
        return `<li class="request">
          <button class="request__vote ${r.voted ? "is-voted" : ""}" data-action="vote" data-req="${r.id}"
            aria-pressed="${r.voted}" aria-label="${r.voted ? "Remove your request for" : "Request"} ${esc(r.name)}">${ICONS.up}<span>${r.votes}</span></button>
          <div class="request__main">
            <p class="request__name">${esc(r.name)}${r.votes >= REQUEST_GOAL ? ` <span class="request__ready">Opening soon</span>` : ""}</p>
            <div class="request__bar" role="progressbar" aria-valuenow="${r.votes}" aria-valuemax="${REQUEST_GOAL}" aria-label="${esc(r.name)} requests"><span style="width:${pct}%"></span></div>
          </div>
        </li>`;
      })
      .join("")}</ul>
  </section>`;
}

const matchesQuery = (s) =>
  !query || [s.name, s.blurb, ...s.subs].some((t) => t.toLowerCase().includes(query.toLowerCase()));

function communityGridHTML() {
  const counts = {};
  state.posts.forEach((p) => (counts[p.skill] = (counts[p.skill] || 0) + 1));
  const list = SKILLS.filter(matchesQuery);
  if (!list.length) {
    return `<p class="empty">No community for “${esc(query)}” yet. <button class="link-btn" data-action="request-query">Request it</button> and others can upvote it.</p>`;
  }
  return `<div class="skill-grid">${list
    .map((s) =>
      skillCard(s, `${fmtCount(s.learners + (state.joined.includes(s.id) ? 1 : 0))} members · ${plural(counts[s.id] || 0, "post")}`, liveIn(s.id).length)
    )
    .join("")}</div>`;
}

// ---------- Views ----------
function renderSidenav() {
  const item = (href, active, icon, hue, name, sub, live) => `
    <li><a class="channel ${active ? "is-active" : ""}" href="${href}" title="${name}" ${active ? 'aria-current="page"' : ""}>
      <span class="channel__avatar skill-icon" style="background:${hue == null ? "var(--thumb-bg)" : `hsl(${hue},45%,42%)`}">${icon}</span>
      <div class="channel__info"><p class="channel__name">${name}</p><p class="channel__game">${sub}</p></div>
      ${live ? `<span class="channel__viewers"><span class="live-dot"></span>${live}</span>` : ""}
    </a></li>`;
  $("#skillNav").innerHTML =
    item("#", !view.skill, ICONS.grid, null, "All communities", "Discover & request", LIVE_STREAMS.length) +
    SKILLS.map((s) =>
      item(skillHref(s.id), view.skill?.id === s.id, s.icon, s.hue, s.name,
        state.joined.includes(s.id) ? "Joined" : s.subs.join(", "), liveIn(s.id).length)
    ).join("");
}

function renderHub() {
  document.title = "Communities · Stream Platform";
  const popular = state.posts.filter((p) => p.kind === "progress").sort(byPopular).slice(0, 8);
  const discussions = state.posts.filter((p) => p.kind === "thread").sort((a, b) => lastActivity(b) - lastActivity(a)).slice(0, 6);
  const live = [...LIVE_STREAMS].sort((a, b) => b.viewers - a.viewers).slice(0, 4);

  main.innerHTML = `
    <section class="learn-hero">
      <p class="learn-hero__eyebrow">Communities</p>
      <h1 class="learn-hero__title">Learn anything, alongside people learning it too.</h1>
      <p class="learn-hero__sub">Every community is a skill people are working on. Watch members stream their practice, see the progress posts everyone's cheering for, and share your own.</p>
    </section>

    <section class="shelf">
      <div class="shelf__head">
        <h2 class="shelf__title">All communities</h2>
        <input class="field community-search" type="search" id="communitySearch" value="${esc(query)}"
          placeholder="Find a community" aria-label="Find a community" />
      </div>
      <div id="communityGrid">${communityGridHTML()}</div>
    </section>

    <section class="shelf">
      <h2 class="shelf__title"><span class="live-dot"></span> Live now: learning on stream</h2>
      <div class="stream-grid">${live.map((st) => streamCard(st, true)).join("")}</div>
    </section>

    <div class="learn-cols">
      <section class="shelf">
        <h2 class="shelf__title">Popular progress</h2>
        <div class="feed">${popular.map((p) => postCard(p, true)).join("")}</div>
      </section>
      <aside class="learn-aside">
        ${requestsHTML()}
        <section class="panel">
          <h2 class="panel__title">Active discussions</h2>
          <ul class="discussion-list">${discussions
            .map(
              (p) => `<li><a href="${skillHref(p.skill, { tab: "forum", thread: p.id })}">
                <span class="discussion-list__title">${esc(p.title)}</span>
                <span class="muted">${skillById(p.skill).name} · ${replies(p.comments.length)}</span>
              </a></li>`
            )
            .join("")}</ul>
        </section>
      </aside>
    </div>`;
}

function renderSkill() {
  const { skill: s, tab, sub, sort } = view;
  document.title = `${s.name} · Communities`;
  const inSkill = state.posts.filter((p) => p.skill === s.id);
  const posts = inSkill.filter((p) => !sub || p.sub === sub);
  const progress = posts.filter((p) => p.kind === "progress").sort(sort === "new" ? (a, b) => b.t - a.t : byPopular);
  const threads = posts.filter((p) => p.kind === "thread").sort((a, b) => lastActivity(b) - lastActivity(a));
  const live = liveIn(s.id, sub);
  const joined = state.joined.includes(s.id);
  // This page's URL with some params changed (pass sub: null to clear the topic).
  const here = ({ tab: t = tab, sub: u = sub, sort: o = sort } = {}) =>
    skillHref(s.id, { tab: t, ...(u ? { sub: u } : {}), ...(o === "new" ? { sort: o } : {}) });
  const subHref = (t) => here({ sub: t });
  const empty = (msg) => `<p class="empty">${msg}</p>`;

  main.innerHTML = `
    <a class="back-link" href="#">← All communities</a>
    <header class="skill-head">
      <div class="skill-head__icon">${s.icon}</div>
      <div class="skill-head__text">
        <h1 class="skill-head__name">${s.name}</h1>
        <p class="skill-head__blurb">${s.blurb}</p>
        <p class="skill-head__stats">${fmtCount(s.learners + (joined ? 1 : 0))} members · ${plural(inSkill.length, "post")}${
          live.length ? ` · <span class="live-dot"></span>${live.length} live now` : ""}</p>
      </div>
      <button class="btn ${joined ? "btn--secondary" : "btn--primary"}" data-action="join" aria-pressed="${joined}">${joined ? "Joined ✓" : "Join community"}</button>
    </header>

    <nav class="chips" aria-label="Topics">
      <a class="chip ${!sub ? "is-active" : ""}" href="${subHref(null)}">All</a>
      ${s.subs.map((t) => `<a class="chip ${sub === t ? "is-active" : ""}" href="${subHref(t)}">${esc(t)}</a>`).join("")}
    </nav>

    <section class="shelf">
      <h2 class="shelf__title">${live.length ? `<span class="live-dot"></span> ` : ""}Live now${sub ? ` in ${esc(sub)}` : ""}</h2>
      ${
        live.length
          ? `<div class="stream-grid">${live.map((st) => streamCard(st, false)).join("")}</div>`
          : empty(`Nobody's streaming ${esc((sub || s.name).toLowerCase())} right now. Check back soon.`)
      }
    </section>

    <nav class="tabs" aria-label="Sections">
      <a class="tab ${tab === "progress" ? "is-active" : ""}" href="${here({ tab: "progress" })}">Progress <span class="tab__count">${progress.length}</span></a>
      <a class="tab ${tab === "forum" ? "is-active" : ""}" href="${here({ tab: "forum" })}">Discussions <span class="tab__count">${threads.length}</span></a>
    </nav>

    <div class="learn-cols">
      <div>
        ${
          tab === "forum"
            ? `${threadComposer(s, sub)}
               ${threads.length ? `<ul class="thread-list">${threads.map(threadRow).join("")}</ul>` : empty("No discussions yet. Ask the first question!")}`
            : `${progressComposer(s, sub)}
               <nav class="sort" aria-label="Sort progress posts">
                 <a class="chip ${sort !== "new" ? "is-active" : ""}" href="${here({ sort: "top" })}">Popular</a>
                 <a class="chip ${sort === "new" ? "is-active" : ""}" href="${here({ sort: "new" })}">Recent</a>
               </nav>
               ${progress.length ? `<div class="feed">${progress.map((p) => postCard(p, false)).join("")}</div>` : empty("No progress posts yet. Share where you're starting from!")}`
        }
      </div>
      <aside class="learn-aside">
        ${topLearnersHTML(s)}
        ${formatsHTML(s)}
      </aside>
    </div>`;
}

function render() {
  renderSidenav();
  view.skill ? renderSkill() : renderHub();
}

function resetDraft() {
  draft.media.forEach((m) => m.session && URL.revokeObjectURL(m.src));
  draft = { media: [], strava: null };
  stravaOpen = false;
}

function route() {
  const q = new URLSearchParams(location.hash.slice(1));
  const skill = skillById(q.get("skill")) || null;
  if (skill !== view.skill) resetDraft();
  const sub = skill && skill.subs.includes(q.get("sub")) ? q.get("sub") : null;
  const tab = ["progress", "forum"].includes(q.get("tab")) ? q.get("tab") : skill?.defaultTab || "progress";
  const sort = q.get("sort") === "new" ? "new" : "top";
  view = { skill, tab, sub, sort };
  const threadId = q.get("thread");
  if (threadId) openThreads.add(threadId);
  render();
  const target = threadId && main.querySelector(`[data-id="${CSS.escape(threadId)}"]`);
  target ? target.scrollIntoView({ block: "center" }) : window.scrollTo(0, 0);
}

// ---------- Targeted re-renders (keep in-progress drafts intact) ----------
function refreshPost(p) {
  const el = main.querySelector(`[data-id="${p.id}"]`);
  if (el) el.outerHTML = el.classList.contains("thread") ? threadRow(p) : postCard(p, !view.skill);
}
function refreshAttachments() {
  const el = $("#attachments");
  if (el) el.innerHTML = attachmentsHTML();
}
function refreshStrava() {
  const el = $("#stravaSlot");
  if (el) el.innerHTML = stravaPanelHTML();
  $('[data-action="strava-toggle"]')?.setAttribute("aria-expanded", String(stravaOpen));
}

function refreshRequests() {
  const el = $("#requestPanel");
  if (el) el.outerHTML = requestsHTML();
}

// Request a new community: open the existing one if it already exists, upvote a matching
// request, or start a new request with the member's vote.
function addRequest(raw) {
  const name = raw.trim().replace(/\s+/g, " ").slice(0, 40);
  if (!name) return;
  const key = name.toLowerCase();
  const skill = SKILLS.find((s) => s.name.toLowerCase() === key || s.subs.some((t) => t.toLowerCase() === key));
  if (skill) {
    location.hash = skillHref(skill.id).split("#")[1];
    return toast(`${skill.name} already has a community. Welcome in!`);
  }
  let r = state.requests.find((x) => x.name.toLowerCase() === key);
  if (r && r.voted) return toast(`You've already requested ${r.name}.`);
  if (r) {
    r.voted = true;
    r.votes += 1;
  } else {
    r = { id: uid(), name: name[0].toUpperCase() + name.slice(1), votes: 1, voted: true };
    state.requests.push(r);
  }
  persist();
  refreshRequests();
  $("#requestPanel")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  toast(`Requested ${r.name} — ${REQUEST_GOAL - r.votes > 0 ? `${REQUEST_GOAL - r.votes} more to open it` : "it's ready to open"}.`);
}

const toggle = (set, id) => (set.has(id) ? set.delete(id) : set.add(id));

// ---------- Events ----------
main.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const id = el.closest("[data-id]")?.dataset.id;
  const p = id && state.posts.find((x) => x.id === id);

  switch (el.dataset.action) {
    case "watch":
      e.preventDefault();
      toast("The stream player is coming soon.");
      break;
    case "vote": {
      const r = state.requests.find((x) => x.id === el.dataset.req);
      r.voted = !r.voted;
      r.votes += r.voted ? 1 : -1;
      persist();
      refreshRequests();
      break;
    }
    case "request-query":
      addRequest(query);
      break;
    case "like":
      p.liked = !p.liked;
      p.likes += p.liked ? 1 : -1;
      persist();
      refreshPost(p);
      break;
    case "toggle-comments":
      toggle(openComments, id);
      refreshPost(p);
      if (openComments.has(id)) main.querySelector(`[data-id="${id}"] .comment-form input`)?.focus();
      break;
    case "open-thread":
      toggle(openThreads, id);
      refreshPost(p);
      break;
    case "delete":
      if (!confirm("Delete this post?")) return;
      state.posts = state.posts.filter((x) => x.id !== id);
      persist();
      render();
      break;
    case "join": {
      const sid = view.skill.id;
      state.joined = state.joined.includes(sid) ? state.joined.filter((x) => x !== sid) : [...state.joined, sid];
      persist();
      render();
      if (state.joined.includes(sid)) toast(`You joined ${view.skill.name}. Welcome!`);
      break;
    }
    case "pick-media":
      if (draft.media.length >= MAX_MEDIA) return toast(`You can attach up to ${MAX_MEDIA} photos or videos.`);
      $("#mediaInput").click();
      break;
    case "remove-media": {
      const [m] = draft.media.splice(Number(el.dataset.i), 1);
      if (m?.session) URL.revokeObjectURL(m.src);
      refreshAttachments();
      break;
    }
    case "remove-strava":
      draft.strava = null;
      refreshAttachments();
      break;
    case "strava-toggle":
      stravaOpen = !stravaOpen;
      refreshStrava();
      if (stravaOpen && !strava && !stravaLoading) loadStrava();
      break;
    case "strava-refresh":
      if (!stravaLoading) loadStrava();
      break;
    case "strava-disconnect":
      if (!confirm("Disconnect Strava? Posts you already shared keep their activity.")) return;
      fetch("/api/strava", { method: "DELETE", credentials: "same-origin" })
        .then((r) => r.json())
        .then((data) => { strava = { ...data, activities: [] }; refreshStrava(); toast("Strava disconnected."); })
        .catch(() => toast("Couldn't disconnect Strava. Try again."));
      break;
    case "strava-attach": {
      const { t: _t, ...a } = strava.activities[Number(el.dataset.i)];
      draft.strava = a;
      stravaOpen = false;
      refreshStrava();
      refreshAttachments();
      break;
    }
  }
});

main.addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.target;
  const data = new FormData(form);
  const body = String(data.get("body") || "").trim();

  switch (form.dataset.form) {
    case "progress": {
      if (!body && !draft.media.length && !draft.strava) return toast("Write something or attach a photo, video or activity.");
      const minutes = Math.min(1440, Math.max(0, parseInt(data.get("minutes"), 10) || 0)) || null;
      state.posts.unshift({
        id: uid(), kind: "progress", skill: view.skill.id, sub: data.get("sub"), title: null, body, minutes,
        media: draft.media, strava: draft.strava, comments: [], likes: 0, liked: false, ...ME, t: Date.now(),
      });
      draft = { media: [], strava: null }; // media now belongs to the post — don't revoke
      stravaOpen = false;
      persist();
      // A brand-new post would sit low in Popular, so show Recent where it's on top.
      if (view.sort === "new") render();
      else location.hash = skillHref(view.skill.id, { tab: "progress", ...(view.sub ? { sub: view.sub } : {}), sort: "new" }).split("#")[1];
      toast("Progress posted 🎉");
      break;
    }
    case "request":
      addRequest(String(data.get("name") || ""));
      break;
    case "thread": {
      const title = String(data.get("title") || "").trim();
      if (!title) return;
      const p = {
        id: uid(), kind: "thread", skill: view.skill.id, sub: data.get("sub"), title, body, minutes: null,
        media: [], strava: null, comments: [], likes: 0, liked: false, ...ME, t: Date.now(),
      };
      state.posts.unshift(p);
      openThreads.add(p.id);
      persist();
      render();
      break;
    }
    case "comment": {
      if (!body) return;
      const id = form.closest("[data-id]").dataset.id;
      const p = state.posts.find((x) => x.id === id);
      p.comments.push({ id: uid(), ...ME, body, t: Date.now() });
      (p.kind === "thread" ? openThreads : openComments).add(id);
      persist();
      refreshPost(p);
      main.querySelector(`[data-id="${id}"] .comment-form input`)?.focus();
      break;
    }
  }
});

// Hub search filters the community grid in place (keeps focus in the search box).
main.addEventListener("input", (e) => {
  if (e.target.id !== "communitySearch") return;
  query = e.target.value.trim();
  $("#communityGrid").innerHTML = communityGridHTML();
});

// Images are downscaled to JPEG data URLs so they fit in localStorage.
function downscale(file, max = 1280) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      const k = Math.min(1, max / Math.max(im.width, im.height));
      const cv = document.createElement("canvas");
      cv.width = Math.round(im.width * k);
      cv.height = Math.round(im.height * k);
      cv.getContext("2d").drawImage(im, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      resolve(cv.toDataURL("image/jpeg", 0.82));
    };
    im.onerror = () => (URL.revokeObjectURL(url), reject(new Error("bad image")));
    im.src = url;
  });
}

$("#mediaInput").addEventListener("change", async (e) => {
  const all = [...e.target.files];
  e.target.value = "";
  const files = all.slice(0, MAX_MEDIA - draft.media.length);
  if (files.length < all.length) toast(`Only ${MAX_MEDIA} photos or videos per post.`);
  for (const f of files) {
    if (f.type.startsWith("image/")) {
      try {
        draft.media.push({ type: "image", label: f.name, src: await downscale(f) });
      } catch {
        toast(`Couldn't read ${f.name}`);
      }
    } else if (f.type.startsWith("video/")) {
      draft.media.push({ type: "video", label: f.name, src: URL.createObjectURL(f), session: true });
    }
  }
  refreshAttachments();
});

$("#collapseBtn").addEventListener("click", () => document.body.classList.toggle("side-collapsed"));
window.addEventListener("hashchange", route);

// Coming back from Strava's consent screen (api/strava.js adds strava=connected|error).
// Strip those params first, then route() (which resets the draft, closing the Strava panel),
// then reopen the panel.
{
  const q = new URLSearchParams(location.hash.slice(1));
  const result = q.get("strava");
  const reason = q.get("reason");
  if (result) {
    q.delete("strava");
    q.delete("reason");
    history.replaceState(null, "", `#${q}`);
  }
  route();
  if (result === "connected") {
    stravaOpen = true;
    loadStrava();
    toast("Strava connected. Pick an activity to share.");
  } else if (result) {
    toast(reason || "Strava wasn't connected.");
  }
}
