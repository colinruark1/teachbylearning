// Mock data — swap for a real API later.
const STREAMS = [
  { user: "PixelPaladin",  game: "Elden Ring",          viewers: 48213, title: "NO HIT RUN attempt #47 — today is the day",            tags: ["English", "Speedrun"],     hue: 265 },
  { user: "LunaCasts",     game: "Just Chatting",       viewers: 31877, title: "coffee + chat ☕ reacting to your clips",               tags: ["English", "Chill"],        hue: 320 },
  { user: "ByteBrawler",   game: "VALORANT",            viewers: 27450, title: "Radiant grind | !settings !crosshair",                 tags: ["English", "FPS"],          hue: 0   },
  { user: "MossyMaker",    game: "Minecraft",           viewers: 19204, title: "building a 1:1 castle in survival day 112",            tags: ["English", "Creative"],     hue: 120 },
  { user: "NovaKnight",    game: "League of Legends",   viewers: 15988, title: "Challenger mid lane coaching — ask me anything",       tags: ["English", "Educational"],  hue: 210 },
  { user: "SynthSorcerer", game: "Music",               viewers: 9871,  title: "live synthwave production 🎹 requests open",           tags: ["Music", "Production"],     hue: 290 },
  { user: "TacoTactician", game: "Counter-Strike 2",    viewers: 8420,  title: "FACEIT lvl 10 pugs w/ the boys",                       tags: ["English", "Competitive"],  hue: 30  },
  { user: "QuietQuill",    game: "Art",                 viewers: 5110,  title: "digital painting a dragon commission from scratch",    tags: ["Art", "Relaxing"],         hue: 180 },
  { user: "GlitchGoblin",  game: "Fortnite",            viewers: 4402,  title: "zero build arena, viewers can join at 9pm",            tags: ["English", "Family Friendly"], hue: 50 },
  { user: "OrbitOtter",    game: "Kerbal Space Program", viewers: 2215, title: "landing on every moon without reverting",              tags: ["English", "Science"],      hue: 195 },
  { user: "RetroRaven",    game: "Retro",               viewers: 1802,  title: "first playthrough of Chrono Trigger!",                 tags: ["English", "Blind"],        hue: 340 },
  { user: "ChillChef",     game: "Food & Drink",        viewers: 1340,  title: "making fresh pasta from scratch 🍝",                   tags: ["Cooking", "IRL"],          hue: 15  },
];

const CATEGORIES = [
  { name: "Just Chatting",       viewers: 412000, tags: ["IRL"],          hue: 270 },
  { name: "League of Legends",   viewers: 188000, tags: ["MOBA"],         hue: 210 },
  { name: "Grand Theft Auto V",  viewers: 141000, tags: ["Action"],       hue: 100 },
  { name: "VALORANT",            viewers: 97000,  tags: ["Shooter"],      hue: 355 },
  { name: "Counter-Strike 2",    viewers: 88000,  tags: ["Shooter"],      hue: 35  },
  { name: "Minecraft",           viewers: 64000,  tags: ["Sandbox"],      hue: 125 },
  { name: "Elden Ring",          viewers: 51000,  tags: ["RPG"],          hue: 45  },
  { name: "Fortnite",            viewers: 47000,  tags: ["Battle Royale"], hue: 285 },
  { name: "Art",                 viewers: 22000,  tags: ["Creative"],     hue: 175 },
  { name: "Music",               viewers: 18000,  tags: ["Creative"],     hue: 310 },
];

const $ = (sel) => document.querySelector(sel);

const fmtViewers = (n) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "")}K` : String(n);

const avatar = (s) =>
  `<span class="channel__avatar" style="background:hsl(${s.hue},60%,45%)">${s.user[0]}</span>`;

// ---------- Side nav ----------
function renderSidenav(count) {
  $("#channelList").innerHTML = STREAMS.slice(0, count)
    .map(
      (s) => `
      <li>
        <a class="channel" href="#" title="${s.user}">
          ${avatar(s)}
          <div class="channel__info">
            <p class="channel__name">${s.user}</p>
            <p class="channel__game">${s.game}</p>
          </div>
          <span class="channel__viewers"><span class="live-dot"></span>${fmtViewers(s.viewers)}</span>
        </a>
      </li>`
    )
    .join("");
}

let sideCount = 6;
renderSidenav(sideCount);

$("#showMore").addEventListener("click", (e) => {
  sideCount = sideCount === 6 ? STREAMS.length : 6;
  e.currentTarget.textContent = sideCount === 6 ? "Show More" : "Show Less";
  renderSidenav(sideCount);
});

$("#collapseBtn").addEventListener("click", () => {
  document.body.classList.toggle("side-collapsed");
});

// ---------- Stream cards ----------
const streamCard = (s) => `
  <article class="stream-card">
    <a class="stream-card__media" href="#" aria-label="${s.user} streaming ${s.game}">
      <div class="thumb"></div>
      <span class="badge-live">Live</span>
      <span class="badge-viewers">${fmtViewers(s.viewers)} viewers</span>
    </a>
    <div class="stream-card__body">
      <a href="#">${avatar(s)}</a>
      <div class="stream-card__text">
        <a href="#"><h3 class="stream-card__title" title="${s.title}">${s.title}</h3></a>
        <p class="stream-card__meta"><a href="#">${s.user}</a></p>
        <p class="stream-card__meta"><a href="#">${s.game}</a></p>
        <div class="tags">${s.tags.map((t) => `<a class="tag" href="#">${t}</a>`).join("")}</div>
      </div>
    </div>
  </article>`;

$("#liveGrid").innerHTML = STREAMS.slice(0, 8).map(streamCard).join("");
$("#chatGrid").innerHTML = STREAMS.filter((_, i) => i % 2 === 1).slice(0, 4).map(streamCard).join("");

// ---------- Category cards ----------
$("#categoryGrid").innerHTML = CATEGORIES.map(
  (c) => `
  <article class="category-card">
    <a class="category-card__art" href="#" aria-label="${c.name}">
      <div class="thumb">${c.name}</div>
    </a>
    <a href="#"><h3 class="category-card__name">${c.name}</h3></a>
    <p class="category-card__viewers">${fmtViewers(c.viewers)} viewers</p>
    <div class="tags">${c.tags.map((t) => `<a class="tag" href="#">${t}</a>`).join("")}</div>
  </article>`
).join("");

// ---------- Hero carousel ----------
const featured = STREAMS.slice(0, 5);
let heroIndex = 0;

$("#heroStage").innerHTML = featured
  .map(
    (s, i) => `
    <div class="hero__slide" data-i="${i}">
      <div class="hero__video">
        <div class="thumb"></div>
        <span class="badge-live hero__live">Live</span>
      </div>
      <div class="hero__details">
        <div class="hero__head">
          ${avatar(s)}
          <div>
            <p class="hero__name">${s.user}</p>
            <p class="hero__game">${s.game}</p>
            <p class="hero__viewers">${fmtViewers(s.viewers)} viewers</p>
          </div>
        </div>
        <div class="tags">${s.tags.map((t) => `<span class="tag">${t}</span>`).join("")}</div>
        <p class="hero__desc">${s.title}. Come hang out, say hi in chat, and don't forget to follow so you never miss a stream!</p>
      </div>
    </div>`
  )
  .join("");

const slides = [...document.querySelectorAll(".hero__slide")];

function layoutHero() {
  const n = slides.length;
  slides.forEach((el, i) => {
    // Signed distance from the active slide, wrapped to [-n/2, n/2].
    let d = (i - heroIndex + n) % n;
    if (d > n / 2) d -= n;
    const abs = Math.abs(d);
    const x = d * 22; // % of slide width
    const scale = 1 - abs * 0.15;
    el.style.transform = `translate(calc(-50% + ${x}%), -50%) scale(${scale})`;
    el.style.zIndex = String(10 - abs);
    el.style.opacity = abs > 2 ? "0" : "1";
    el.style.pointerEvents = abs > 2 ? "none" : "auto";
    el.classList.toggle("is-center", d === 0);
  });
}

function goTo(i) {
  heroIndex = (i + slides.length) % slides.length;
  layoutHero();
}

$("#heroPrev").addEventListener("click", () => goTo(heroIndex - 1));
$("#heroNext").addEventListener("click", () => goTo(heroIndex + 1));
slides.forEach((el) =>
  el.addEventListener("click", () => {
    const i = Number(el.dataset.i);
    if (i !== heroIndex) goTo(i);
  })
);

layoutHero();
