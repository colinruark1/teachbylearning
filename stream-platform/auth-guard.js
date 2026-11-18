// Login gate for the app pages. Load it in <head>, before the stylesheet.
// The page stays hidden until /api/auth/get-session returns a user. Otherwise the
// visitor goes to the landing page's login dialog, with ?next= set to bring them back.
// This fails closed: if the auth API can't be reached, the visitor is sent to log in.
(function () {
  const root = document.documentElement;
  root.style.visibility = "hidden";

  const toLogin = () => {
    const next = location.pathname + location.search + location.hash;
    location.replace(`/?next=${encodeURIComponent(next)}#login`);
  };

  fetch("/api/auth/get-session", { credentials: "same-origin" })
    .then((r) => (r.ok ? r.json() : null))
    .then((session) => {
      if (!session?.user) return toLogin();
      window.currentUser = session.user;
      const ready = () => {
        // Swap the nav's Log In / Sign Up buttons for the user's name and a Log out button.
        const right = document.querySelector(".topnav__right");
        if (right) {
          right.querySelectorAll('a[href*="#login"], a[href*="#signup"]').forEach((a) => a.remove());
          const name = document.createElement("span");
          name.className = "topnav__user";
          name.textContent = session.user.name || session.user.email;
          const out = document.createElement("button");
          out.className = "btn btn--secondary";
          out.textContent = "Log out";
          out.addEventListener("click", () =>
            fetch("/api/auth/sign-out", {
              method: "POST", credentials: "same-origin",
              headers: { "content-type": "application/json" }, body: "{}",
            }).finally(() => location.replace("/")));
          right.prepend(name, out);
        }
        root.style.visibility = "";
      };
      document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", ready) : ready();
    })
    .catch(toLogin);
})();
