// Tiny browser client for the Better Auth REST API served at /api/auth (see api/auth.js).
// Sessions live in httpOnly cookies set by the server, so nothing is stored in JS.
// Rejects with an Error whose .code is Better Auth's error code (e.g. INVALID_CODE).

const AUTH_BASE = "/api/auth";

async function authCall(path, body) {
  let res;
  try {
    res = await fetch(AUTH_BASE + path, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    throw Object.assign(new Error("Can't reach the sign-in server. Try again in a moment."), { code: "NETWORK" });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.message || `Request failed (${res.status})`);
    err.code = data?.code;
    throw err;
  }
  return data;
}

const Auth = {
  signUp: (name, email, password) => authCall("/sign-up/email", { name, email, password }),
  // Resolves to { twoFactorRedirect: true } when a 2FA code is still required.
  signIn: (email, password) => authCall("/sign-in/email", { email, password }),
  signOut: () => authCall("/sign-out", {}),
  getSession: () => authCall("/get-session"), // null when signed out
  // Returns { totpURI, backupCodes }. 2FA only turns on after verifyTotp succeeds.
  enable2fa: (password) => authCall("/two-factor/enable", { password }),
  verifyTotp: (code, trustDevice = false) => authCall("/two-factor/verify-totp", { code, trustDevice }),
  verifyBackupCode: (code, trustDevice = false) => authCall("/two-factor/verify-backup-code", { code, trustDevice }),
};
