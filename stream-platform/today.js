// Today page: one card per commitment with a check-in form (proof, what you did,
// thoughts), the log of past check-ins, streak, and the text-reminder settings.
// Data comes from /api/me (api/me.js). ?habit=<id> opens that habit's form, which is
// where the reminder bot's "Log it" links land.

const $ = (sel, root = document) => root.querySelector(sel);

let data = { commitments: [], checkins: [], activeDays: [], phone: { configured: false, verified: false } };
let openHabit = null;          // habit id whose check-in form is open
const drafts = {};             // habit id → check-in draft, kept while the form is open

const today = () => localDate();
const dow = () => new Date().getDay();

let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("is-shown");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-shown"), 3600);
}

const check = `<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/* ---------- Derived data ---------- */

const commitmentFor = (habit) => data.commitments.find((c) => c.habit === habit);
const communityFor = (habit) => { const c = commitmentFor(habit); return c ? commitmentCommunity(c) : null; };

const doneToday = (habit) => data.checkins.filter((c) => c.habit === habit && c.day === today());

// Consecutive days with at least one check-in, ending today (or yesterday, if today isn't logged yet).
function streak() {
  const days = new Set(data.activeDays);
  const d = new Date();
  if (!days.has(localDate(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(localDate(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

function fmtDay(day) {
  if (day === today()) return "Today";
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (day === localDate(y)) return "Yesterday";
  const [Y, M, D] = day.split("-").map(Number);
  return new Date(Y, M - 1, D).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/* ---------- Header ---------- */

function renderHead() {
  $("#todayDate").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const scheduled = data.commitments.filter((c) => c.days.includes(dow()));
  const done = scheduled.filter((c) => doneToday(c.habit).length).length;
  const s = streak();
  $("#todayStats").innerHTML = `
    <li><b>${s}</b><span>day streak</span></li>
    <li><b>${done}/${scheduled.length}</b><span>done today</span></li>
    <li><b>${data.activeDays.length}</b><span>${data.activeDays.length === 1 ? "day" : "days"} logged</span></li>`;
}

/* ---------- Habit cards + check-in form ---------- */

function draftFor(h) {
  return (drafts[h.id] ??= { proofType: h.proof.types[0], photo: "", link: "", text: "", details: {}, reflection: "", share: true });
}

function proofInput(h, d) {
  const hint = esc(h.proof[d.proofType]);
  if (d.proofType === "photo") {
    return d.photo
      ? `<div class="proof-photo"><img src="${d.photo}" alt="Your proof photo" />
           <button type="button" class="btn btn--secondary" data-action="remove-photo">Remove</button></div>`
      : `<button type="button" class="proof-drop" data-action="pick-photo">
           <svg class="ico" viewBox="0 0 20 20" width="22" height="22" aria-hidden="true"><path d="M2 6.5h4L7.5 4h5L14 6.5h4V16H2z"/><circle cx="10" cy="11" r="3"/></svg>
           <span><b>Add a photo</b><br /><span class="muted">${hint}</span></span>
         </button>`;
  }
  if (d.proofType === "link") {
    return `<input class="field proof-field" type="url" data-k="link" inputmode="url" placeholder="https://…"
      value="${esc(d.link)}" aria-label="${hint}" /><p class="muted proof-hint">${hint}</p>`;
  }
  return `<textarea class="field proof-field proof-text" data-k="text" rows="8" placeholder="${hint}"
    aria-label="${hint}">${esc(d.text)}</textarea>`;
}

function fieldHTML(f, d) {
  const id = `f-${f.key}`;
  const v = d.details[f.key] ?? "";
  const req = f.required ? "required" : "";
  const label = `<span class="ob-label">${esc(f.label)}${f.required ? "" : ' <span class="muted">(optional)</span>'}</span>`;
  let input;
  if (f.type === "select") {
    input = `<select class="field" id="${id}" data-detail="${f.key}" ${req}>
      <option value="">Choose…</option>
      ${f.options.map((o) => `<option ${o === v ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
  } else if (f.type === "number") {
    input = `<input class="field" id="${id}" type="number" inputmode="numeric" min="${f.min}" max="${f.max}"
      data-detail="${f.key}" value="${esc(v)}" ${req} />`;
  } else {
    input = `<input class="field" id="${id}" data-detail="${f.key}" maxlength="300"
      placeholder="${esc(f.placeholder || "")}" value="${esc(v)}" ${req} />`;
  }
  return `<label class="checkin__field ${f.type === "text" && !f.required ? "checkin__field--wide" : ""}" for="${id}">${label}${input}</label>`;
}

function checkinForm(h) {
  const d = draftFor(h);
  const community = communityFor(h.id);
  return `
    <form class="checkin" data-habit="${h.id}" novalidate>
      <fieldset class="checkin__group">
        <legend class="checkin__legend">1. Proof</legend>
        ${h.proof.types.length > 1 ? `
          <div class="seg" role="group" aria-label="Type of proof">
            ${h.proof.types.map((t) => `<button type="button" class="seg__btn" data-proof="${t}" aria-pressed="${t === d.proofType}">${PROOF_LABELS[t]}</button>`).join("")}
          </div>` : ""}
        <div class="proof-input" data-proof-input>${proofInput(h, d)}</div>
      </fieldset>
      <fieldset class="checkin__group">
        <legend class="checkin__legend">2. What you did</legend>
        <div class="checkin__fields">${h.fields.map((f) => fieldHTML(f, d)).join("")}</div>
      </fieldset>
      <label class="checkin__group">
        <span class="checkin__legend">3. Thoughts on today</span>
        <textarea class="field" data-k="reflection" rows="3" maxlength="4000" placeholder="${esc(h.reflect)}">${esc(d.reflection)}</textarea>
      </label>
      ${community ? `
        <label class="checkin__share">
          <input type="checkbox" data-k="share" ${d.share ? "checked" : ""} />
          <span>Post this to the <a href="${skillHref(community.id)}">${esc(community.name)}</a> community's progress feed</span>
        </label>` : ""}
      <p class="ob__err" data-err role="alert"></p>
      <div class="checkin__actions">
        <button type="button" class="btn btn--secondary" data-action="close">Cancel</button>
        <button type="submit" class="btn btn--primary">Log it</button>
      </div>
    </form>`;
}

function habitCard(c) {
  const h = habitById(c.habit);
  if (!h) return "";
  const done = doneToday(h.id);
  const scheduled = c.days.includes(dow());
  const status = done.length
    ? `<span class="pill pill--done">${check} Done today</span>`
    : scheduled ? `<span class="pill">Today at ${fmtTime(c.time)}</span>` : `<span class="pill pill--rest">Rest day</span>`;
  const isOpen = openHabit === h.id;
  const btn = done.length ? "Log another" : scheduled ? "Log it" : "Log anyway";
  return `
    <article class="habit-card ${done.length ? "is-done" : ""}" id="habit-${h.id}" style="--hue:${h.hue}">
      <div class="habit-card__top">
        <span class="habit-icon">${h.icon}</span>
        <div class="habit-card__text">
          <h3 class="habit-card__name">${h.name} ${status}</h3>
          <p class="habit-card__statement">“${esc(c.statement)}”</p>
          ${commitmentCommunity(c) ? `<p class="habit-card__community muted">Shared to <a href="${skillHref(commitmentCommunity(c).id)}">${esc(commitmentCommunity(c).name)}</a></p>` : ""}
          ${done.length ? `<p class="habit-card__last">${check} ${esc(h.summary(done[0].details) || "Logged")}</p>` : ""}
        </div>
        ${isOpen ? "" : `<button type="button" class="btn ${done.length ? "btn--secondary" : "btn--primary"}" data-action="open" data-habit="${h.id}">${btn}</button>`}
      </div>
      ${isOpen ? checkinForm(h) : ""}
    </article>`;
}

function renderCards() {
  const el = $("#habitCards");
  if (!data.commitments.length) {
    el.innerHTML = `<p class="empty">You haven't made any commitments yet. <a class="link-btn" href="onboarding.html">Make one</a></p>`;
    return;
  }
  // Scheduled-today first, then by time.
  const list = [...data.commitments].sort((a, b) =>
    (b.days.includes(dow()) - a.days.includes(dow())) || a.time.localeCompare(b.time));
  el.innerHTML = list.map(habitCard).join("");
}

/* ---------- Log ---------- */

function proofHTML(c) {
  if (c.proofType === "photo") {
    return `<a class="log__photo" href="/api/me/proof/${c.id}" target="_blank" rel="noopener">
      <img src="/api/me/proof/${c.id}" alt="Proof photo" loading="lazy" /></a>`;
  }
  if (c.proofType === "link") {
    let label = c.proof;
    try { const u = new URL(c.proof); label = u.host + (u.pathname.length > 1 ? u.pathname : ""); } catch { /* show raw */ }
    return `<a class="log__link" href="${esc(c.proof)}" target="_blank" rel="noopener nofollow">${esc(label)} ↗</a>`;
  }
  return `<details class="log__text"><summary>Read it</summary><pre>${esc(c.proof)}</pre></details>`;
}

function logItem(c) {
  const h = habitById(c.habit);
  if (!h) return "";
  // Optional free-text details that the one-line summary leaves out.
  const extra = h.fields.filter((f) => f.type === "text" && !f.required && c.details[f.key])
    .map((f) => `<span><span class="muted">${esc(f.label)}:</span> ${esc(c.details[f.key])}</span>`).join("");
  return `
    <article class="log" style="--hue:${h.hue}">
      <span class="habit-icon habit-icon--sm">${h.icon}</span>
      <div class="log__body">
        <p class="log__head"><b>${h.name}</b><span class="muted">${fmtDay(c.day)}</span></p>
        <p class="log__summary">${esc(h.summary(c.details))}</p>
        ${extra ? `<p class="log__extra">${extra}</p>` : ""}
        ${proofHTML(c)}
        ${c.reflection ? `<p class="log__reflection">${esc(c.reflection)}</p>` : ""}
      </div>
      <button type="button" class="icon-btn log__delete" data-action="delete" data-id="${c.id}" aria-label="Delete this entry">
        <svg viewBox="0 0 20 20" width="16" height="16"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>
      </button>
    </article>`;
}

function renderLog() {
  $("#logList").innerHTML = data.checkins.length
    ? data.checkins.map(logItem).join("")
    : `<p class="empty">Nothing logged yet. Your first entry starts the streak.</p>`;
}

/* ---------- Aside ---------- */

function renderCommitList() {
  $("#commitList").innerHTML = data.commitments.map((c) => {
    const h = habitById(c.habit);
    return h ? `<li style="--hue:${h.hue}"><span class="habit-icon habit-icon--sm">${h.icon}</span>
      <span><b>${h.name}</b><br /><span class="muted">${fmtDays(c.days)} at ${fmtTime(c.time)}${
        c.remindBefore ? ` · nudge ${c.remindBefore} min before` : ""}${
        commitmentCommunity(c) ? ` · shared to ${esc(commitmentCommunity(c).name)}` : ""}</span></span></li>` : "";
  }).join("");
}

function renderAll() {
  renderHead();
  renderCards();
  renderLog();
  renderCommitList();
}

/* ---------- Events ---------- */

function openForm(id) {
  openHabit = id;
  renderCards();
  const card = $(`#habit-${id}`);
  card?.scrollIntoView({ behavior: "smooth", block: "start" });
  card?.querySelector(".seg__btn, .proof-drop, .proof-field")?.focus({ preventScroll: true });
}

function refreshProof(form) {
  const h = habitById(form.dataset.habit);
  const d = draftFor(h);
  form.querySelectorAll(".seg__btn").forEach((b) => b.setAttribute("aria-pressed", b.dataset.proof === d.proofType));
  form.querySelector("[data-proof-input]").innerHTML = proofInput(h, d);
}

let photoFor = null; // habit id waiting on the file picker
$("#photoInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file || !photoFor) return;
  try {
    const h = habitById(photoFor);
    draftFor(h).photo = await downscale(file);
    const form = $(`.checkin[data-habit="${photoFor}"]`);
    if (form) refreshProof(form);
  } catch (ex) {
    toast(ex.message);
  }
});

document.addEventListener("click", async (e) => {
  const seg = e.target.closest(".seg__btn");
  if (seg) {
    const form = seg.closest(".checkin");
    draftFor(habitById(form.dataset.habit)).proofType = seg.dataset.proof;
    refreshProof(form);
    return;
  }
  const a = e.target.closest("[data-action]");
  if (!a) return;
  const form = a.closest(".checkin");
  switch (a.dataset.action) {
    case "open": openForm(a.dataset.habit); break;
    case "close": openHabit = null; renderCards(); break;
    case "pick-photo": photoFor = form.dataset.habit; $("#photoInput").click(); break;
    case "remove-photo": draftFor(habitById(form.dataset.habit)).photo = ""; refreshProof(form); break;
    case "delete": {
      if (!confirm("Delete this entry? This can't be undone.")) return;
      try {
        await meApi(`checkins/${a.dataset.id}`, { method: "DELETE" });
        data = await meApi("state"); // reload so the streak and day counts are recomputed
        renderAll();
      } catch (ex) { toast(ex.message); }
      break;
    }
  }
});

document.addEventListener("input", (e) => {
  const form = e.target.closest(".checkin");
  if (!form) return;
  const d = draftFor(habitById(form.dataset.habit));
  if (e.target.dataset.detail) d.details[e.target.dataset.detail] = e.target.value;
  else if (e.target.type === "checkbox") d[e.target.dataset.k] = e.target.checked;
  else if (e.target.dataset.k) d[e.target.dataset.k] = e.target.value;
});

document.addEventListener("submit", async (e) => {
  const form = e.target.closest(".checkin");
  if (!form) return;
  e.preventDefault();
  const h = habitById(form.dataset.habit);
  const d = draftFor(h);
  const err = form.querySelector("[data-err]");
  const fail = (msg, el) => { err.textContent = msg; el?.focus(); };
  err.textContent = "";

  let proof;
  if (d.proofType === "photo") {
    if (!d.photo) return fail("Add a photo as proof.", form.querySelector(".proof-drop"));
    proof = { type: "photo", data: d.photo };
  } else if (d.proofType === "link") {
    if (!/^https?:\/\/\S+\.\S+/.test(d.link.trim())) return fail("Paste a full link, starting with https://", form.querySelector(".proof-field"));
    proof = { type: "link", url: d.link.trim() };
  } else {
    if (!d.text.trim()) return fail("Paste your work as proof.", form.querySelector(".proof-field"));
    proof = { type: "text", text: d.text };
  }

  const details = {};
  for (const f of h.fields) {
    const raw = String(d.details[f.key] ?? "").trim();
    if (!raw) {
      if (f.required) return fail(`Fill in “${f.label}”.`, form.querySelector(`[data-detail="${f.key}"]`));
      continue;
    }
    if (f.type === "number") {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < f.min || n > f.max) return fail(`“${f.label}” should be between ${f.min} and ${f.max}.`, form.querySelector(`[data-detail="${f.key}"]`));
      details[f.key] = n;
    } else details[f.key] = raw;
  }
  if (!d.reflection.trim()) return fail("Add a few thoughts on what you accomplished today.", form.querySelector('[data-k="reflection"]'));

  const btn = form.querySelector("[type=submit]");
  btn.disabled = true;
  try {
    const saved = await meApi("checkins", {
      method: "POST",
      body: { habit: h.id, day: today(), proof, details, reflection: d.reflection },
    });
    data.checkins.unshift(saved);
    if (!data.activeDays.includes(saved.day)) data.activeDays.unshift(saved.day);
    const community = d.share ? communityFor(h.id) : null;
    const shared = community && shareToCommunity(h, community.id, saved, proof.type === "photo" ? d.photo : "");
    delete drafts[h.id];
    openHabit = null;
    renderHead();
    renderCards();
    renderLog();
    toast(shared ? `${h.name} logged and posted to ${community.name}.`
      : community ? `${h.name} logged, but it couldn't be posted to ${community.name} (browser storage is full).`
      : `${h.name} logged. That's your 1% for today.`);
  } catch (ex) {
    err.textContent = ex.message;
    btn.disabled = false;
  }
});

/* ---------- Start ---------- */

(async function init() {
  try {
    data = await meApi("state");
  } catch (e) {
    $("#habitCards").innerHTML = `<p class="empty">${esc(e.message)}</p>`;
    return;
  }
  renderAll();
  bindPhoneForm($("#phonePanel"), () => data.phone, (s) => {
    if (s.verified && !data.phone.verified) toast(s.channel?.replyWindowHours ? `You're connected! One last step: say hi on ${s.channel.label}.` : "You're connected!");
    data.phone = s;
  });
  const params = new URLSearchParams(location.search);
  if (params.has("welcome")) toast("You're all set. Log each session here once it's done.");
  const habit = params.get("habit");
  if (habit && data.commitments.some((c) => c.habit === habit)) openForm(habit);
  if (params.has("welcome") || habit) history.replaceState(null, "", location.pathname);
})();
