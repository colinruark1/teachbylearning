// Communities: one per skill people want to learn. Shared by communities.html, browse.html
// (unlinked) and the root landing page. New communities come from requests on the hub
// (see REQUESTS in communities.js). Add one here, with a unique `hue`, when it opens.
// Mock data — swap for a real API later.

// Stroke-style 20×20 icon. `.ico` in styles.css switches svg from fill to stroke.
const ico = (paths) =>
  `<svg class="ico" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">${paths}</svg>`;

// defaultTab: which tab a skill opens on — "progress" (feed of posts) or "forum" (discussions).
// strava: lets members attach Strava activities to progress posts.
const SKILLS = [
  {
    id: "writing", name: "Writing", hue: 25, learners: 18400, defaultTab: "progress",
    blurb: "Creative writing, professional writing, storytelling",
    subs: ["Creative Writing", "Professional Writing", "Storytelling"],
    icon: ico('<path d="M3.5 16.5l1-4L13 4a2 2 0 0 1 3 3l-8.5 8.5z"/><path d="M11.5 5.5l3 3"/>'),
  },
  {
    id: "art", name: "Drawing / Art", hue: 175, learners: 24100, defaultTab: "progress",
    blurb: "Sketching, painting, digital art",
    subs: ["Sketching", "Painting", "Digital Art"],
    icon: ico('<path d="M10 2.5a7.5 7.5 0 0 0 0 15c1 0 1.5-.7 1.5-1.4 0-1-.8-1.2-.8-2.1 0-.9.7-1.3 1.6-1.3H14a3.5 3.5 0 0 0 3.5-3.5C17.5 5.6 14.1 2.5 10 2.5z"/><circle cx="6" cy="9" r="1"/><circle cx="8.5" cy="5.8" r="1"/><circle cx="12.5" cy="6" r="1"/>'),
  },
  {
    id: "cooking", name: "Cooking", hue: 15, learners: 31200, defaultTab: "progress",
    blurb: "Preparing meals, learning recipes, baking",
    subs: ["Preparing Meals", "Learning Recipes", "Baking"],
    icon: ico('<path d="M3.5 9h13v5a3 3 0 0 1-3 3h-7a3 3 0 0 1-3-3z"/><path d="M1.5 9h17"/><path d="M7 6.5c0-1 1-1 1-2.5M10 6.5c0-1 1-1 1-2.5M13 6.5c0-1 1-1 1-2.5"/>'),
  },
  {
    id: "speaking", name: "Public Speaking", hue: 215, learners: 9700, defaultTab: "progress",
    blurb: "Presenting, speaking confidently",
    subs: ["Presenting", "Speaking Confidently"],
    icon: ico('<rect x="7" y="2" width="6" height="10" rx="3"/><path d="M4 9a6 6 0 0 0 12 0M10 15v3M7 18h6"/>'),
  },
  {
    id: "instrument", name: "Playing an Instrument", hue: 45, learners: 21800, defaultTab: "progress",
    blurb: "Guitar, piano, drums",
    subs: ["Guitar", "Piano", "Drums"],
    icon: ico('<path d="M8 15V4.5l9-2V13"/><circle cx="5.5" cy="15" r="2.5"/><circle cx="14.5" cy="13" r="2.5"/>'),
  },
  {
    id: "language", name: "Learning a Language", hue: 125, learners: 27300, defaultTab: "forum",
    blurb: "Spanish, French, Japanese, etc.",
    subs: ["Spanish", "French", "Japanese", "Other Languages"],
    icon: ico('<path d="M2.5 3.5h9v6.5H7l-3 2.5V10H2.5z"/><path d="M11.5 7.5h6v6.5h-1.5v2.5L13 14H8.5v-2"/>'),
  },
  {
    id: "reading", name: "Reading", hue: 265, learners: 15600, defaultTab: "forum",
    blurb: "Reading faster, comprehension, reading more often",
    subs: ["Reading Faster", "Comprehension", "Reading More Often"],
    icon: ico('<path d="M10 5C8 3.5 5 3 2 3.5v12c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5v-12C15 3 12 3.5 10 5z"/><path d="M10 5v12"/>'),
  },
  {
    id: "fitness", name: "Fitness / Exercise", hue: 0, learners: 38900, defaultTab: "progress", strava: true,
    blurb: "Running, weightlifting, flexibility",
    subs: ["Running", "Weightlifting", "Flexibility"],
    icon: ico('<path d="M2 8v4M5 5.5v9M15 5.5v9M18 8v4M5 10h10"/>'),
  },
  {
    id: "photography", name: "Photography", hue: 190, learners: 16200, defaultTab: "progress",
    blurb: "Taking and editing photos",
    subs: ["Taking Photos", "Editing Photos"],
    icon: ico('<path d="M2 6.5h4L7.5 4h5L14 6.5h4V16H2z"/><circle cx="10" cy="11" r="3"/>'),
  },
  {
    id: "dancing", name: "Dancing", hue: 330, learners: 11400, defaultTab: "progress",
    blurb: "Learning routines, improving rhythm and technique",
    subs: ["Learning Routines", "Rhythm", "Technique"],
    icon: ico('<circle cx="11.5" cy="3.5" r="1.5"/><path d="M5 4.5l5.5 2.5L15 5M10.5 7L9 11.5l3.5 2.5-1 4M9 11.5l-3 3.5H3.5"/>'),
  },
];

const fmtCount = (n) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "")}K` : String(n);

const skillHref = (id, extra = {}) => `communities.html#${new URLSearchParams({ skill: id, ...extra })}`;

// `live`: how many members are streaming right now (shows a badge on the art).
const skillCard = (s, meta, live = 0) => `
  <article class="skill-card">
    <a class="skill-card__art" href="${skillHref(s.id)}" aria-label="${s.name}">
      <div class="thumb">${s.icon}</div>
      ${live ? `<span class="badge-live">${live} live</span>` : ""}
    </a>
    <a href="${skillHref(s.id)}"><h3 class="skill-card__name">${s.name}</h3></a>
    <p class="skill-card__meta">${meta}</p>
    <div class="tags">${s.subs.map((t) => `<a class="tag" href="${skillHref(s.id, { sub: t })}">${t}</a>`).join("")}</div>
  </article>`;
