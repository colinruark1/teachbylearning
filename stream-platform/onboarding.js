// Onboarding: 1) pick the habits to practice, 2) write a commitment statement for each
// (parsed into days + time for the reminder bot), 3) connect Telegram for reminders.
// New accounts land here from auth-guard.js until POST /api/me/onboarding succeeds.
// Revisiting the page edits the existing commitments.

const $ = (sel, root = document) => root.querySelector(sel);
const main = $("#obMain");

const params = new URLSearchParams(location.search);
// Where to go when done: the app page that sent the user here (e.g. a skill they clicked
// on the landing page), else Today. The bare app root is the post-login default, not a choice.
const nextUrl = (() => {
  const n = params.get("next") || "";
  const isDefault = /^\/stream-platform\/(index\.html)?$/.test(n);
  return n.startsWith("/stream-platform/") && !isDefault && !n.includes("onboarding") ? n : "today.html?welcome=1";
})();

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const REMIND_OPTIONS = [[0, "At the start time"], [10, "10 min before"], [15, "15 min before"],
  [30, "30 min before"], [45, "45 min before"], [60, "1 hour before"], [90, "1.5 hours before"], [120, "2 hours before"]];

const state = {
  step: 1,
  selected: new Set(),      // habit ids, in HABITS order when rendered
  drafts: {},               // habitId → { statement, days, time, remindBefore, touchedDays, touchedTime }
  telegram: { configured: false, linked: false },
  telegramUrl: "",
  editing: false,
};

let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("is-shown");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-shown"), 3600);
}

const draftFor = (id) =>
  (state.drafts[id] ??= {
    statement: "",
    days: [...habitById(id).defaults.days],
    time: habitById(id).defaults.time,
    remindBefore: 30,
    touchedDays: false,
    touchedTime: false,
  });

const chosen = () => HABITS.filter((h) => state.selected.has(h.id));

/* ---------- Step 1: skills ---------- */

function renderSkills() {
  main.innerHTML = `
    <section class="ob__step">
      <p class="eyebrow">${state.editing ? "Edit your plan" : "Welcome to the 1%"}</p>
      <h1 class="ob__title">What do you want to practice?</h1>
      <p class="ob__sub">Pick one or more. You'll make a specific commitment for each, and we'll help you keep it.</p>
      <ul class="habit-picks">
        ${HABITS.map((h) => `
          <li>
            <button type="button" class="habit-pick" data-pick="${h.id}" aria-pressed="${state.selected.has(h.id)}" style="--hue:${h.hue}">
              <span class="habit-icon">${h.icon}</span>
              <span class="habit-pick__text">
                <span class="habit-pick__name">${h.name}</span>
                <span class="habit-pick__tag">${h.tagline}</span>
              </span>
              <span class="habit-pick__check" aria-hidden="true">
                <svg viewBox="0 0 20 20" width="14" height="14"><path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </span>
            </button>
          </li>`).join("")}
      </ul>
      <div class="ob__actions">
        ${state.editing ? `<a class="btn btn--secondary btn--lg" href="today.html">Cancel</a>` : ""}
        <span class="ob__spacer"></span>
        <button type="button" class="btn btn--primary btn--lg" data-go="2" ${state.selected.size ? "" : "disabled"}>Continue</button>
      </div>
    </section>`;
}

/* ---------- Step 2: commitments ---------- */

function previewText(d, h) {
  if (!d.days.length) return "Pick at least one day so we know when to check in.";
  const at = fmtTime(d.time);
  const nudge = d.remindBefore ? `${fmtTime(minusMinutes(d.time, d.remindBefore))}` : at;
  return `We'll message you ${fmtDays(d.days)} at <b>${nudge}</b> before you ${esc(h.verb)} at ${at}, ` +
    `and follow up later if you haven't logged it.`;
}

function commitCard(h) {
  const d = draftFor(h.id);
  return `
    <article class="commit" data-habit="${h.id}" style="--hue:${h.hue}">
      <header class="commit__head">
        <span class="habit-icon">${h.icon}</span>
        <h2 class="commit__name">${h.name}</h2>
      </header>
      <label class="ob-label" for="st-${h.id}">Your commitment</label>
      <textarea id="st-${h.id}" class="field commit__statement" data-k="statement" rows="2" maxlength="280"
        placeholder="${esc(h.example)}">${esc(d.statement)}</textarea>
      <p class="commit__hint">Say <b>when</b> and <b>what</b>, like “${esc(h.example)}” We read the days and time from it, and you can adjust them below.</p>
      <div class="commit__sched">
        <fieldset class="days">
          <legend class="ob-label">Days</legend>
          <div class="days__row">
            ${DAY_SHORT.map((n, i) => `<button type="button" class="day" data-day="${i}" aria-pressed="${d.days.includes(i)}" aria-label="${n}">${n[0]}</button>`).join("")}
          </div>
        </fieldset>
        <label class="commit__field">
          <span class="ob-label">Time</span>
          <input type="time" class="field" data-k="time" value="${d.time}" required />
        </label>
        <label class="commit__field">
          <span class="ob-label">Remind me</span>
          <select class="field" data-k="remindBefore">
            ${REMIND_OPTIONS.map(([v, l]) => `<option value="${v}" ${v === d.remindBefore ? "selected" : ""}>${l}</option>`).join("")}
          </select>
        </label>
      </div>
      <p class="commit__preview" data-preview>${previewText(d, h)}</p>
    </article>`;
}

function renderCommitments() {
  main.innerHTML = `
    <section class="ob__step">
      <p class="eyebrow">Step 2 of 3</p>
      <h1 class="ob__title">Make it a commitment.</h1>
      <p class="ob__sub">Specific promises get kept. Write yours in your own words; our reminder bot will hold you to it.
        Times are in your time zone (${esc(timezone.replace(/_/g, " "))}).</p>
      <form class="commits" id="commitForm" novalidate>
        ${chosen().map(commitCard).join("")}
        <p class="ob__err" id="obErr" role="alert"></p>
        <div class="ob__actions">
          <button type="button" class="btn btn--secondary btn--lg" data-go="1">Back</button>
          <span class="ob__spacer"></span>
          <button type="submit" class="btn btn--primary btn--lg">Save &amp; continue</button>
        </div>
      </form>
    </section>`;
  main.querySelector("textarea")?.focus();
}

// Reflect a draft into its card without re-rendering (keeps focus and caret).
function syncCard(id) {
  const card = main.querySelector(`.commit[data-habit="${id}"]`);
  const d = draftFor(id);
  card.querySelectorAll(".day").forEach((b) => b.setAttribute("aria-pressed", d.days.includes(Number(b.dataset.day))));
  const time = card.querySelector('[data-k="time"]');
  if (time.value !== d.time) time.value = d.time;
  card.querySelector("[data-preview]").innerHTML = previewText(d, habitById(id));
}

async function saveCommitments(e) {
  e.preventDefault();
  const err = $("#obErr");
  err.textContent = "";
  for (const h of chosen()) {
    const d = draftFor(h.id);
    const problem = d.statement.trim().length < 10 ? "Write your commitment for"
      : !d.days.length ? "Pick at least one day for"
      : !d.time ? "Pick a time for" : "";
    if (problem) {
      err.textContent = `${problem} ${h.name}.`;
      main.querySelector(`.commit[data-habit="${h.id}"] textarea`).focus();
      return;
    }
  }
  const btn = e.target.querySelector("[type=submit]");
  btn.disabled = true;
  try {
    await meApi("onboarding", {
      method: "POST",
      body: {
        commitments: chosen().map((h) => {
          const d = draftFor(h.id);
          return { habit: h.id, statement: d.statement.trim(), days: d.days, time: d.time, timezone, remindBefore: d.remindBefore };
        }),
      },
    });
    go(3);
  } catch (ex) {
    err.textContent = ex.message;
  } finally {
    btn.disabled = false;
  }
}

/* ---------- Step 3: reminders ---------- */

let pollTimer;
const stopPolling = () => clearInterval(pollTimer);

function samplePing() {
  const h = chosen()[0] || HABITS[0];
  const d = draftFor(h.id);
  const lines = {
    gym: `Almost ready for the gym? You're on for ${fmtTime(d.time)}.`,
    poetry: `Poetry at ${fmtTime(d.time)}. Got a pen ready?`,
    reading: `Reading time at ${fmtTime(d.time)}. Which book is on deck?`,
    leetcode: `LeetCode at ${fmtTime(d.time)}. Pick your problem now so you can start on time.`,
  };
  return `
    <figure class="ping" aria-label="Example reminder">
      <span class="ping__time">${fmtTime(minusMinutes(d.time, d.remindBefore))}</span>
      <p class="ping__bubble">${esc(lines[h.id])}<br /><span class="ping__quote">You said: “${esc(d.statement.trim() || h.example)}”</span></p>
      <div class="ping__buttons"><span>💪 On my way</span><span>Skip today</span></div>
    </figure>`;
}

function telegramBlock() {
  const t = state.telegram;
  if (!t.configured) {
    return `<div class="notice">Reminders aren't switched on for this server yet. Your commitments are saved;
      you can connect reminders from the Today page once they are.</div>`;
  }
  if (t.linked) {
    return `<div class="notice notice--ok">
      <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span><b>Telegram connected.</b> Your first nudge arrives before your next session.</span></div>`;
  }
  return `
    <ol class="tg-steps">
      <li>Install Telegram if you don't have it (free on iPhone, Android and desktop).</li>
      <li>Tap <b>Connect Telegram</b>, then press <b>Start</b> in the chat that opens.</li>
      <li>Come back here. This page updates on its own.</li>
    </ol>
    <a class="btn btn--tg btn--lg" id="tgConnect" href="${esc(state.telegramUrl) || "#"}" target="_blank" rel="noopener"
      ${state.telegramUrl ? "" : 'aria-disabled="true"'}>Connect Telegram</a>
    <p class="muted tg-wait" id="tgWait" hidden>Waiting for you to press Start in Telegram…</p>`;
}

function renderReminders() {
  const t = state.telegram;
  main.innerHTML = `
    <section class="ob__step">
      <p class="eyebrow">Step 3 of 3</p>
      <h1 class="ob__title">Let us hold you to it.</h1>
      <p class="ob__sub">Before each session our bot sends you a nudge, and if you haven't logged it afterward, it checks in.
        Text messages are on the way; for now the bot lives in Telegram, which is free.</p>
      <div class="ob__reminders">
        <div class="tg">${telegramBlock()}</div>
        ${samplePing()}
      </div>
      <div class="ob__actions">
        <button type="button" class="btn btn--secondary btn--lg" data-go="2">Back</button>
        <span class="ob__spacer"></span>
        ${t.configured && !t.linked ? `<a class="link-btn ob__skip" href="${esc(nextUrl)}">Skip for now</a>` : ""}
        <a class="btn btn--primary btn--lg" href="${esc(nextUrl)}" ${t.configured && !t.linked ? "hidden" : ""} id="obFinish">
          ${state.editing ? "Done" : "Start my streak"}</a>
      </div>
    </section>`;

  stopPolling();
  if (!t.configured || t.linked) return;
  if (!state.telegramUrl) {
    meApi("telegram/link", { method: "POST" })
      .then(({ url }) => { state.telegramUrl = url; if (state.step === 3) renderReminders(); })
      .catch((e) => toast(e.message));
    return;
  }
  pollTimer = setInterval(async () => {
    try {
      const s = await meApi("telegram");
      if (s.linked) { state.telegram = s; stopPolling(); renderReminders(); toast("Telegram connected!"); }
    } catch { /* keep polling */ }
  }, 3000);
}

/* ---------- Navigation ---------- */

function go(step) {
  stopPolling();
  state.step = step;
  document.querySelectorAll("#obProgress li").forEach((li) => {
    const n = Number(li.dataset.n);
    li.classList.toggle("is-done", n < step);
    li.classList.toggle("is-current", n === step);
    if (n === step) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
  });
  [renderSkills, renderCommitments, renderReminders][step - 1]();
  window.scrollTo({ top: 0 });
}

main.addEventListener("click", (e) => {
  const pick = e.target.closest("[data-pick]");
  if (pick) {
    const id = pick.dataset.pick;
    state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
    pick.setAttribute("aria-pressed", state.selected.has(id));
    main.querySelector('[data-go="2"]').disabled = !state.selected.size;
    return;
  }
  const day = e.target.closest(".day");
  if (day) {
    const id = day.closest(".commit").dataset.habit;
    const d = draftFor(id), n = Number(day.dataset.day);
    d.days = d.days.includes(n) ? d.days.filter((x) => x !== n) : [...d.days, n].sort();
    d.touchedDays = true;
    syncCard(id);
    return;
  }
  const nav = e.target.closest("[data-go]");
  if (nav) go(Number(nav.dataset.go));
  if (e.target.closest("#tgConnect")) {
    if (!state.telegramUrl) { e.preventDefault(); return; }
    $("#tgWait").hidden = false;
  }
});

main.addEventListener("input", (e) => {
  const card = e.target.closest(".commit");
  if (!card) return;
  const id = card.dataset.habit, d = draftFor(id), k = e.target.dataset.k;
  if (k === "statement") {
    d.statement = e.target.value;
    // Fill days/time from the sentence unless the user already set them by hand.
    const parsed = parseCommitment(d.statement);
    if (parsed.days && !d.touchedDays) d.days = parsed.days;
    if (parsed.time && !d.touchedTime) d.time = parsed.time;
  } else if (k === "time") {
    d.time = e.target.value;
    d.touchedTime = true;
  } else if (k === "remindBefore") {
    d.remindBefore = Number(e.target.value);
  }
  syncCard(id);
});

main.addEventListener("submit", (e) => { if (e.target.id === "commitForm") saveCommitments(e); });

/* ---------- Start ---------- */

(async function init() {
  main.innerHTML = `<p class="muted ob__loading">Loading…</p>`;
  try {
    const s = await meApi("state");
    state.telegram = s.telegram;
    state.editing = s.user.onboarded;
    for (const c of s.commitments) {
      if (!habitById(c.habit)) continue;
      state.selected.add(c.habit);
      state.drafts[c.habit] = {
        statement: c.statement, days: c.days, time: c.time, remindBefore: c.remindBefore,
        touchedDays: true, touchedTime: true,
      };
    }
  } catch (e) {
    toast(e.message);
  }
  go(1);
})();
