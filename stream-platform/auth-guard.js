// Login gate for the app pages. Load it in <head>, before the stylesheet.
// The page stays hidden until /api/auth/get-session returns a user. Otherwise the
// visitor goes to the landing page's login dialog, with ?next= set to bring them back.
// This fails closed: if the auth API can't be reached, the visitor is sent to log in.
// Signed-in users who haven't finished onboarding are sent to onboarding.html first.
//
// Admins (session.user.isAdmin, see lib/admin.js) also get a "View as Admin / User"
// switch in the nav. Admin view adds an Admin link to the dashboard (admin.html); User
// view hides it, so the site looks exactly as members see it. The choice is remembered
// per browser. This only changes what's shown: /api/admin checks admin rights itself.
(function () {
  const root = document.documentElement;
  root.style.visibility = "hidden";
  const VIEW_KEY = "tbl.viewAs";
  const page = location.pathname;
  const onPage = (name) => page.endsWith(`/${name}`);
  const here = () => page + location.search + location.hash;

  const toLogin = () => location.replace(`/?next=${encodeURIComponent(here())}#login`);

  const getView = () => { try { return localStorage.getItem(VIEW_KEY) || "admin"; } catch { return "admin"; } };
  const setView = (v) => { try { localStorage.setItem(VIEW_KEY, v); } catch { /* private mode */ } };

  fetch("/api/auth/get-session", { credentials: "same-origin" })
    .then((r) => (r.ok ? r.json() : null))
    .then((session) => {
      const user = session?.user;
      // A session without 2FA means sign-up was abandoned before enrolling an authenticator.
      if (!user || !user.twoFactorEnabled) return toLogin();

      const admin = Boolean(user.isAdmin);
      const view = admin ? getView() : "user";
      if (onPage("admin.html") && view !== "admin") return location.replace("/stream-platform/today.html");

      // New accounts pick their habits and commitments before seeing the app
      // (admins can still reach the dashboard without doing so).
      if (!user.onboardedAt && !onPage("onboarding.html") && !onPage("admin.html")) {
        return location.replace(`/stream-platform/onboarding.html?next=${encodeURIComponent(here())}`);
      }
      window.currentUser = user;

      const ready = () => {
        const right = document.querySelector(".topnav__right");
        if (right) {
          // Swap the nav's Log In / Sign Up buttons for the user's name and a Log out button.
          right.querySelectorAll('a[href*="#login"], a[href*="#signup"]').forEach((a) => a.remove());
          const name = document.createElement("span");
          name.className = "topnav__user";
          name.textContent = user.name || user.email;
          const out = document.createElement("button");
          out.className = "btn btn--secondary";
          out.textContent = "Log out";
          out.addEventListener("click", () =>
            fetch("/api/auth/sign-out", {
              method: "POST", credentials: "same-origin",
              headers: { "content-type": "application/json" }, body: "{}",
            }).finally(() => location.replace("/")));
          right.prepend(name, out);

          if (admin) {
            const sw = document.createElement("div");
            sw.className = "view-switch";
            sw.setAttribute("role", "group");
            sw.setAttribute("aria-label", "View the site as");
            sw.innerHTML = ["admin", "user"].map((v) =>
              `<button type="button" data-view="${v}" aria-pressed="${v === view}">${v === "admin" ? "Admin" : "User"}</button>`).join("");
            sw.addEventListener("click", (e) => {
              const v = e.target.closest("[data-view]")?.dataset.view;
              if (!v || v === view) return;
              setView(v);
              if (v === "admin") location.href = "/stream-platform/admin.html";
              else if (onPage("admin.html")) location.href = "/stream-platform/today.html";
              else location.reload();
            });
            right.prepend(sw);
          }
        }

        const links = document.querySelector(".topnav__links");
        if (admin && view === "admin" && links) {
          const a = document.createElement("a");
          a.href = "admin.html";
          a.className = `topnav__link${onPage("admin.html") ? " is-active" : ""}`;
          a.textContent = "Admin";
          links.append(a);
        }
        root.style.visibility = "";
      };
      document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", ready) : ready();
    })
    .catch(toLogin);
})();
