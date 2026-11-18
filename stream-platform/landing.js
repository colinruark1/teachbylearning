// Landing page: compounding curve, 1% calculator, skill chips, and the
// Better Auth login dialog (email + password, then TOTP two-factor).

const $ = (sel, root = document) => root.querySelector(sel);

/* ---------- Hero stats ---------- */
const totalLearners = SKILLS.reduce((n, s) => n + s.learners, 0);
$("#heroStats").innerHTML = [
  [fmtCount(totalLearners), "learners"],
  [SKILLS.length, "skills"],
  ["37.8×", "in a year"],
].map(([v, l]) => `<li><b>${v}</b><span>${l}</span></li>`).join("");

/* ---------- Compounding curve ---------- */
// Plot 1.01^d (up) and 0.99^d (down) for d in 0..365 on a linear scale, so the
// hockey-stick shape of compounding is visible.
(function drawCurve() {
  const X0 = 30, X1 = 390, Y_ZERO = 226, Y_TOP = 20;
  const MAX = Math.pow(1.01, 365);                        // 37.8
  const y = (v) => Y_ZERO - (v / MAX) * (Y_ZERO - Y_TOP);
  const pts = (rate) => {
    let d = "";
    for (let i = 0; i <= 365; i += 5) {
      const x = X0 + (i / 365) * (X1 - X0);
      d += `${i ? "L" : "M"}${x.toFixed(1)} ${y(Math.pow(rate, i)).toFixed(1)}`;
    }
    return d;
  };
  $("#curveUp").setAttribute("d", pts(1.01));
  $("#curveDown").setAttribute("d", pts(0.99));
})();

/* ---------- 1% calculator ---------- */
const days = $("#calcDays");
const updateCalc = () => {
  const d = Number(days.value);
  $("#calcDaysOut").textContent = d;
  $("#calcMult").textContent = `${Math.pow(1.01, d).toFixed(2)}×`;
};
days.addEventListener("input", updateCalc);
updateCalc();

/* ---------- Skill chips ---------- */
$("#skillChips").innerHTML = SKILLS.map((s) => `
  <li>
    <a class="skill-chip" href="${skillHref(s.id)}" style="--hue:${s.hue}">
      <span class="skill-chip__ico">${s.icon}</span>
      <span class="skill-chip__name">${s.name}</span>
      <span class="skill-chip__meta">${fmtCount(s.learners)} learners</span>
    </a>
  </li>`).join("");

/* ---------- Login dialog (Better Auth + 2FA) ---------- */
const dlg = $("#loginDialog");
const credForm = $("#credForm"), enrollForm = $("#enrollForm"), verifyForm = $("#verifyForm");
const errEl = $("#loginErr");
let mode = "login";        // "login" | "signup"
let password = "";         // kept in memory only, to enrol 2FA right after sign-up/sign-in
let backupMode = false;    // verify step: TOTP vs backup code

const COPY = {
  login:  ["Welcome back", "Log in to keep your streak going."],
  signup: ["Join the 1%", "Create an account and start your streak today."],
  enroll: ["Secure your account", "Two-factor authentication is required for every account."],
  verify: ["Two-factor check", "Enter the code from your authenticator app."],
};
const setHead = (key) => { [$("#loginTitle").textContent, $("#loginSub").textContent] = COPY[key]; };
const showErr = (msg = "") => { errEl.textContent = msg; };

const showStep = (step) => {
  for (const f of [credForm, enrollForm, verifyForm]) f.hidden = f.dataset.step !== step;
  setHead(step === "cred" ? mode : step);
  showErr();
  if (dlg.open) {
    [...document.querySelectorAll(`[data-step="${step}"] input:not([type=checkbox])`)]
      .find((el) => !el.closest("[hidden]"))?.focus();
  }
};

const setMode = (m) => {
  mode = m;
  const signup = m === "signup";
  credForm.querySelectorAll("[data-signup-only]").forEach((el) => (el.hidden = !signup));
  credForm.password.autocomplete = signup ? "new-password" : "current-password";
  $("#credSubmit").textContent = signup ? "Create account" : "Log In";
  $("#loginSwitchText").textContent = signup ? "Already a member?" : "New here?";
  $("#loginSwitch").textContent = signup ? "Log in" : "Create an account";
  showStep("cred");
};

const openLogin = (m = "login") => { if (!dlg.open) dlg.showModal(); setMode(m); };
const finish = () => { password = ""; location.href = "browse.html"; };

// Disable a form's submit button while a request is in flight.
const busy = async (form, fn) => {
  const btn = form.querySelector("[type=submit]");
  btn.disabled = true;
  try { await fn(); } catch (e) { showErr(friendly(e)); } finally { btn.disabled = false; }
};
const friendly = (e) => ({
  INVALID_EMAIL_OR_PASSWORD: "That email and password don't match.",
  USER_ALREADY_EXISTS: "An account with that email already exists — try logging in.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "An account with that email already exists — try logging in.",
  PASSWORD_TOO_SHORT: "Password must be at least 8 characters.",
  INVALID_CODE: "That code didn't work. Check your app and try again.",
  INVALID_BACKUP_CODE: "That backup code didn't work.",
}[e.code] || e.message);

async function startEnroll() {
  const { totpURI, backupCodes } = await Auth.enable2fa(password);
  const qr = qrcode(0, "M");
  qr.addData(totpURI);
  qr.make();
  $("#enrollQr").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  $("#enrollSecret").textContent = new URL(totpURI).searchParams.get("secret");
  $("#enrollBackup").innerHTML = backupCodes.map((c) => `<li><code>${c}</code></li>`).join("");
  enrollForm.code.value = "";
  showStep("enroll");
}

const setBackupMode = (on) => {
  backupMode = on;
  $("#verifyLabel").textContent = on ? "Backup code" : "6-digit code from your authenticator app";
  verifyForm.code.inputMode = on ? "text" : "numeric";
  $("#useBackup").textContent = on ? "Use authenticator app instead" : "Use a backup code instead";
  verifyForm.code.value = "";
  verifyForm.code.focus();
};

credForm.addEventListener("submit", (e) => {
  e.preventDefault();
  busy(credForm, async () => {
    const email = credForm.email.value.trim();
    password = credForm.password.value;
    if (!credForm.email.checkValidity() || !email) throw new Error("Enter a valid email address.");
    if (password.length < 8) throw new Error("Password must be at least 8 characters.");

    if (mode === "signup") {
      const name = credForm.name.value.trim() || email.split("@")[0];
      await Auth.signUp(name, email, password);
      return startEnroll();
    }
    const res = await Auth.signIn(email, password);
    if (res?.twoFactorRedirect) { setBackupMode(false); return showStep("verify"); }
    // Signed in but 2FA was never finished — require it before entering the app.
    if (!res?.user?.twoFactorEnabled) return startEnroll();
    finish();
  });
});

enrollForm.addEventListener("submit", (e) => {
  e.preventDefault();
  busy(enrollForm, async () => {
    const code = enrollForm.code.value.replace(/\s/g, "");
    if (!/^\d{6}$/.test(code)) throw new Error("Enter the 6-digit code from your app.");
    await Auth.verifyTotp(code);
    finish();
  });
});

verifyForm.addEventListener("submit", (e) => {
  e.preventDefault();
  busy(verifyForm, async () => {
    const code = verifyForm.code.value.trim();
    const trust = verifyForm.trustDevice.checked;
    if (backupMode) await Auth.verifyBackupCode(code, trust);
    else {
      if (!/^\d{6}$/.test(code.replace(/\s/g, ""))) throw new Error("Enter the 6-digit code from your app.");
      await Auth.verifyTotp(code.replace(/\s/g, ""), trust);
    }
    finish();
  });
});

$("#useBackup").addEventListener("click", () => setBackupMode(!backupMode));
$("#loginSwitch").addEventListener("click", () => setMode(mode === "login" ? "signup" : "login"));
$("#loginClose").addEventListener("click", () => dlg.close());
dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); }); // backdrop click
dlg.addEventListener("close", () => { password = ""; });

document.querySelectorAll("[data-open-login]").forEach((btn) =>
  btn.addEventListener("click", () => openLogin(btn.dataset.mode || "login")));

// Other pages link here as index.html#login / #signup.
if (location.hash === "#login" || location.hash === "#signup") {
  openLogin(location.hash.slice(1));
  history.replaceState(null, "", location.pathname);
}

// Signed in already? Swap the nav buttons for "Go to streams" + "Log out".
Auth.getSession().then((s) => {
  if (!s?.user) return;
  const actions = $(".lnav__actions");
  actions.innerHTML = `
    <button class="btn btn--secondary" id="logoutBtn">Log out</button>
    <a class="btn btn--primary" href="browse.html">Go to streams</a>`;
  $("#logoutBtn").addEventListener("click", async () => {
    try { await Auth.signOut(); } finally { location.reload(); }
  });
}).catch(() => { /* auth server unavailable (e.g. opened as a file) — stay signed out */ });
