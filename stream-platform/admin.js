// Admin dashboard: signed-up users with ways to reach them (email, text), and the health
// of each API/integration. Data from GET /api/admin/overview (api/admin.js), admins only.

const $ = (sel, root = document) => root.querySelector(sel);

let data = { users: [], health: [] };
let composeFor = null; // user id whose text composer is open

let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("is-shown");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-shown"), 3600);
}

async function adminApi(path, { method = "GET", body } = {}) {
  const res = await fetch(`/api/admin/${path}`, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => { throw new Error("Can't reach the server."); });
  const out = await res.json().catch(() => null);
  if (!res.ok) throw new Error(out?.message || `Request failed (${res.status})`);
  return out;
}

const DAY = 864e5;
const age = (t) => (t ? Date.now() - new Date(t).getTime() : Infinity);
function relTime(t) {
  if (!t) return "never";
  const m = Math.round(age(t) / 6e4);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
}
const fmtDate = (t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
// Inline `code` in server-written health text.
const codeify = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");

/* ---------- Summary ---------- */

function renderStats() {
  const u = data.users;
  const stats = [
    [u.length, "users"],
    [u.filter((x) => age(x.createdAt) < 7 * DAY).length, "new this week"],
    [u.filter((x) => x.onboardedAt).length, "finished onboarding"],
    [u.filter((x) => x.phoneVerifiedAt).length, "getting texts"],
    [u.filter((x) => age(x.lastCheckinAt) < DAY).length, "logged in last 24 h"],
  ];
  $("#stats").innerHTML = stats.map(([n, l]) => `<li><b>${n}</b><span>${l}</span></li>`).join("");
}

/* ---------- Health ---------- */

const STATUS_LABEL = { ok: "Working", warn: "Needs attention", missing: "Not wired" };
const ORDER = { missing: 0, warn: 1, ok: 2 };

function renderHealth() {
  const list = [...data.health].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  const bad = list.filter((c) => c.status !== "ok").length;
  $("#healthSummary").textContent = bad ? `${bad} of ${list.length} need work` : "Everything is wired up.";
  $("#health").innerHTML = list.map((c) => `
    <li class="health__item health__item--${c.status}">
      <span class="health__dot" aria-hidden="true"></span>
      <div class="health__text">
        <p class="health__name">${esc(c.name)} <span class="health__status">${STATUS_LABEL[c.status]}</span></p>
        <p class="health__detail">${codeify(c.detail)}</p>
        ${c.fix ? `<p class="health__fix"><b>Fix:</b> ${codeify(c.fix)}</p>` : ""}
      </div>
    </li>`).join("");
}

/* ---------- Users ---------- */

function filtered() {
  const range = $("#rangeSel").value;
  const q = $("#searchInput").value.trim().toLowerCase();
  const qDigits = q.replace(/\D/g, "");
  return data.users.filter((u) =>
    (range === "all" || age(u.createdAt) < Number(range) * DAY) &&
    (!q || `${u.name} ${u.email}`.toLowerCase().includes(q) || (qDigits.length >= 3 && (u.phone || "").includes(qDigits))));
}

function contactCell(u) {
  const email = `<a class="contact contact--email" href="mailto:${esc(u.email)}">${esc(u.email)}</a>`;
  let phone;
  if (u.phone && u.phoneVerifiedAt) {
    phone = `<span class="contact contact--phone">
        <a href="sms:${esc(u.phone)}" title="Open in your Messages app">${esc(fmtPhone(u.phone))}</a>
        <button type="button" class="link-btn" data-text="${esc(u.id)}">Text via Linq</button>
      </span>`;
  } else if (u.phone) {
    phone = `<span class="contact muted">${esc(fmtPhone(u.phone))} · not verified</span>`;
  } else {
    phone = `<span class="contact muted">No phone</span>`;
  }
  return `${email}${phone}`;
}

const badge = (on, yes, no) => `<span class="pill ${on ? "pill--done" : "pill--rest"}">${on ? yes : no}</span>`;

function userRow(u) {
  const isNew = age(u.createdAt) < 7 * DAY;
  const habits = (u.habits || []).map((id) => {
    const h = habitById(id);
    return h ? `<span class="mini-habit" style="--hue:${h.hue}" title="${esc(h.name)}">${h.icon}<span>${esc(h.name)}</span></span>` : "";
  }).join("") || `<span class="muted">—</span>`;
  const composer = composeFor === u.id ? `
    <tr class="compose-row"><td colspan="6">
      <form class="compose" data-user="${esc(u.id)}">
        <label class="ob-label" for="msg-${esc(u.id)}">Text ${esc(u.name || u.email)} at ${esc(fmtPhone(u.phone))}</label>
        <textarea class="field" id="msg-${esc(u.id)}" name="message" rows="3" maxlength="1000"
          placeholder="Hey! How's the streak going?"></textarea>
        <div class="compose__bar">
          <span class="muted">Sent from your Linq number. They can reply STOP to opt out.</span>
          <button type="button" class="btn btn--secondary" data-cancel>Cancel</button>
          <button type="submit" class="btn btn--primary">Send text</button>
        </div>
      </form>
    </td></tr>` : "";
  return `
    <tr>
      <td data-label="User">
        <span class="user-cell"><b>${esc(u.name || "—")}</b>${isNew ? ' <span class="pill pill--new">New</span>' : ""}</span>
      </td>
      <td data-label="Contact"><div class="contact-cell">${contactCell(u)}</div></td>
      <td data-label="Signed up"><span title="${esc(new Date(u.createdAt).toLocaleString())}">${fmtDate(u.createdAt)}</span>
        <br /><span class="muted">${relTime(u.createdAt)}</span></td>
      <td data-label="Setup"><div class="badges">${badge(u.twoFactorEnabled, "2FA on", "2FA unfinished")}${
        badge(u.onboardedAt, "Onboarded", "Not onboarded")}</div></td>
      <td data-label="Practicing"><div class="mini-habits">${habits}</div></td>
      <td data-label="Activity">${u.checkins} check-in${u.checkins === 1 ? "" : "s"}
        <br /><span class="muted">Last seen ${relTime(u.lastSeenAt)}</span></td>
    </tr>${composer}`;
}

function renderUsers() {
  const list = filtered();
  $("#usersTitle").textContent = `${$("#rangeSel").value === "all" ? "All users" : "New users"} (${list.length})`;
  $("#userRows").innerHTML = list.length
    ? list.map(userRow).join("")
    : `<tr><td colspan="6"><p class="empty">No users match.</p></td></tr>`;
  if (composeFor) $(`.compose[data-user="${CSS.escape(composeFor)}"] textarea`)?.focus();
}

/* ---------- Load + events ---------- */

async function load() {
  const btn = $("#refreshBtn");
  btn.disabled = true;
  try {
    data = await adminApi("overview");
    renderStats();
    renderHealth();
    renderUsers();
    $("#updatedAt").textContent = `Updated ${new Date(data.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  } catch (e) {
    $("#userRows").innerHTML = `<tr><td colspan="6"><p class="empty">${esc(e.message)}</p></td></tr>`;
    toast(e.message);
  } finally {
    btn.disabled = false;
  }
}

$("#refreshBtn").addEventListener("click", load);
$("#rangeSel").addEventListener("change", renderUsers);
$("#searchInput").addEventListener("input", renderUsers);

$("#copyEmails").addEventListener("click", async () => {
  const emails = filtered().map((u) => u.email).join(", ");
  if (!emails) return toast("No users to copy.");
  try {
    await navigator.clipboard.writeText(emails);
    toast(`Copied ${filtered().length} email address${filtered().length === 1 ? "" : "es"}.`);
  } catch {
    prompt("Copy these addresses:", emails);
  }
});

$("#userRows").addEventListener("click", (e) => {
  const t = e.target.closest("[data-text]");
  if (t) { composeFor = composeFor === t.dataset.text ? null : t.dataset.text; renderUsers(); return; }
  if (e.target.closest("[data-cancel]")) { composeFor = null; renderUsers(); }
});

$("#userRows").addEventListener("submit", async (e) => {
  const form = e.target.closest(".compose");
  if (!form) return;
  e.preventDefault();
  const message = form.message.value.trim();
  if (!message) return form.message.focus();
  const btn = form.querySelector("[type=submit]");
  btn.disabled = true;
  try {
    await adminApi("text", { method: "POST", body: { userId: form.dataset.user, message } });
    composeFor = null;
    renderUsers();
    toast("Text sent.");
  } catch (ex) {
    toast(ex.message);
    btn.disabled = false;
  }
});

load();
