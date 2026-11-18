// Phone provider: WhatsApp through Bird (https://bird.com/docs/guides/whatsapp/overview).
// Implements the phone contract in lib/messaging/index.js.
//
// Env:
//   BIRD_API_KEY            workspace key, e.g. bk_us1_… (Platform tools → API keys)
//   BIRD_WHATSAPP_NUMBER    your WhatsApp business number on Bird, E.164 (the sender)
//   BIRD_WEBHOOK_SECRET     whsec_… printed by `npm run messaging:webhook`
//   BIRD_TEMPLATE_SLUG      approved template, with one body variable named `reminder`, for
//                           messages outside the 24-hour window
//   BIRD_TEMPLATE_LANGUAGE  template language (default "en")
//   BIRD_VERIFY_CHANNELS    channels for verification codes (default "whatsapp")
//   BIRD_REGION             us1 | eu1; normally read from the key prefix
//
// WhatsApp rule: free-form messages only reach people who messaged you in the last 24 hours.
// send() uses free-form (with quick-reply buttons) inside that window and the approved
// template outside it.
import { pool, baseURL } from "../../db.js";
import { verifyStandardWebhook } from "../../webhooks.js";
import { CannotDeliver, VerificationFailed, InvalidSignature } from "../errors.js";

export const id = "bird-whatsapp";
export const label = "WhatsApp";
export const capabilities = { buttons: true, replyWindowHours: 24 };

const env = (k) => process.env[k] || "";
const region = () => env("BIRD_REGION") || env("BIRD_API_KEY").match(/^b[km]_([a-z]+\d+)_/)?.[1] || "us1";
const base = () => `https://${region()}.platform.bird.com/v1`;
const from = () => env("BIRD_WHATSAPP_NUMBER");
const TEMPLATE_PARAM = "reminder";
const WINDOW_MS = 24 * 3600e3 - 10 * 60e3; // minus a margin for clock skew and queueing

export const configured = () => Boolean(env("BIRD_API_KEY") && from());

class BirdError extends Error {
  constructor(status, body) {
    super(`Bird API ${status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
  // Free-form send outside the 24-hour window (422 WhatsAppServiceWindowClosed).
  get windowClosed() { return /WhatsAppServiceWindowClosed|service_window/i.test(JSON.stringify(this.body)); }
}

async function bird(path, body, { method = "POST", idempotencyKey } = {}) {
  const res = await fetch(base() + path, {
    method,
    headers: {
      authorization: `Bearer ${env("BIRD_API_KEY")}`,
      "content-type": "application/json",
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new BirdError(res.status, data);
  return data;
}

/* ---------- Sending ---------- */

function freeform(to, text, { buttons, idempotencyKey }) {
  if (buttons?.length) {
    return bird("/whatsapp/messages", {
      to, from: from(),
      interactive: {
        type: "button",
        body_text: text.slice(0, 1024),
        buttons: buttons.slice(0, 3).map((b) => ({ type: "quick_reply", quick_reply: { slug: b.slug, text: b.text.slice(0, 20) } })),
      },
    }, { idempotencyKey });
  }
  return bird("/whatsapp/messages", { to, from: from(), text: { body: text.slice(0, 4096) } }, { idempotencyKey });
}

// WhatsApp rejects template parameters containing newlines, tabs or 4+ spaces in a row.
function template(to, text, { idempotencyKey }) {
  const value = text.replace(/\s*\n+\s*/g, " ").replace(/\t/g, " ").replace(/ {4,}/g, "   ").slice(0, 1000);
  return bird("/whatsapp/messages", {
    to, from: from(),
    template: {
      slug: env("BIRD_TEMPLATE_SLUG"),
      language: env("BIRD_TEMPLATE_LANGUAGE") || "en",
      parameters: { [TEMPLATE_PARAM]: value },
    },
  }, { idempotencyKey: idempotencyKey && `${idempotencyKey}/template` });
}

export async function send(to, text, { buttons, idempotencyKey, lastInboundAt } = {}) {
  const open = Boolean(lastInboundAt) && Date.now() - new Date(lastInboundAt).getTime() < WINDOW_MS;
  if (open) {
    try {
      await freeform(to, text, { buttons, idempotencyKey });
      return "message";
    } catch (e) {
      if (!(e instanceof BirdError && e.windowClosed)) throw e;
      // Our record said the window was open but WhatsApp disagrees; use the template.
    }
  }
  if (!env("BIRD_TEMPLATE_SLUG")) {
    throw new CannotDeliver("Their 24-hour WhatsApp window is closed and BIRD_TEMPLATE_SLUG isn't set.");
  }
  await template(to, text, { idempotencyKey });
  return "template";
}

/* ---------- Verification (Bird Verify sends the code over WhatsApp) ---------- */

export async function startVerification(to) {
  const channels = (env("BIRD_VERIFY_CHANNELS") || "whatsapp").split(",").map((s) => s.trim()).filter(Boolean);
  try {
    await bird("/verify/verifications", { to: { phone_number: to }, options: { channels } });
  } catch (e) {
    if (e instanceof BirdError && (e.status === 422 || e.status === 400)) {
      throw new VerificationFailed("We couldn't send a code to that number. Check that it's right and has WhatsApp.");
    }
    if (e instanceof BirdError && e.status === 429) throw new VerificationFailed("Too many codes requested. Try again in a few minutes.");
    throw e;
  }
}

export async function checkVerification(to, code) {
  try {
    const r = await bird("/verify/verifications/check", { to: { phone_number: to }, code });
    return { success: Boolean(r?.success), reason: r?.reason ?? null, attemptsRemaining: r?.attempts_remaining };
  } catch (e) {
    if (e instanceof BirdError && e.status === 404) return { success: false, reason: "not_found" };
    throw e;
  }
}

/* ---------- Inbound ---------- */

// `whatsapp.received` webhook → { id, from, text, button }. `button` is the slug of a tapped
// quick-reply button. (Bird's docs don't show a plain-text example, so the text is read from
// the likely places.)
export async function inbound(request) {
  const raw = await request.text();
  if (!verifyStandardWebhook(request.headers, raw, env("BIRD_WEBHOOK_SECRET"))) throw new InvalidSignature();
  let event;
  try { event = JSON.parse(raw); } catch { return null; }
  const d = event?.data ?? {};
  if (event?.type !== "whatsapp.received" || d.direction === "outbound") return null;
  const t = d.text;
  const reply = d.interactive_reply;
  return {
    id: request.headers.get("webhook-id"),
    from: d.from?.phone_number ?? "",
    text: String(reply?.button?.text ?? reply?.list?.text ?? (typeof t === "string" ? t : t?.body ?? t?.text ?? "")).trim(),
    button: reply?.button?.slug ?? reply?.list?.slug ?? null,
  };
}

// Opens a WhatsApp chat with the business number, pre-filled with "Hi".
export const chatLink = () => (from() ? `https://wa.me/${from().replace(/\D/g, "")}?text=Hi` : null);

// Opens a WhatsApp chat with a user (for the admin dashboard).
export const contactLink = (to) => `https://wa.me/${String(to).replace(/\D/g, "")}`;

export async function registerWebhook(url) {
  const hook = await bird("/webhooks", {
    url, events: ["whatsapp.received"], description: "Teach by Learning: inbound WhatsApp replies",
  });
  return { id: hook.id, secret: hook.secret, secretEnv: "BIRD_WEBHOOK_SECRET" };
}

/* ---------- Admin health checks ---------- */

const MIN = 60e3;
const ago = (t) => (t ? Date.now() - new Date(t).getTime() : Infinity);
const when = (t) => {
  if (!t) return "never";
  const m = Math.round(ago(t) / MIN);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};
// Bird list responses: accept a bare array or a wrapped one.
const items = (data) => (Array.isArray(data) ? data : data?.data ?? data?.items ?? data?.results ?? data?.webhooks ?? data?.templates ?? null);

export async function health(hb) {
  const out = [];
  const key = env("BIRD_API_KEY");
  const keyFix = "Create a key at bird.com/dashboard/w/api-keys and set BIRD_API_KEY.";

  let hooks = null;
  if (!key) {
    out.push({ id: "bird_api", name: "Bird WhatsApp API", status: "missing", detail: "BIRD_API_KEY is not set, so no WhatsApp messages can be sent.", fix: keyFix });
  } else {
    try {
      hooks = items(await bird("/webhooks", undefined, { method: "GET" }));
      out.push({ id: "bird_api", name: "Bird WhatsApp API", status: "ok", detail: "Key accepted by Bird." });
    } catch (e) {
      const detail = e.status === 401 ? "Bird rejected BIRD_API_KEY."
        : e.status === 421 ? "BIRD_API_KEY belongs to a different region. Fix BIRD_REGION or use the key's region."
        : e.status === 403 ? "The key works but can't list webhooks (missing scope), so the webhook check below is skipped."
        : `Couldn't reach Bird: ${e.message}`;
      out.push({ id: "bird_api", name: "Bird WhatsApp API", status: e.status === 401 ? "missing" : "warn", detail, fix: e.status === 401 ? keyFix : undefined });
    }
  }

  out.push(from()
    ? { id: "bird_number", name: "WhatsApp business number", status: "ok", detail: `Sending from ${from()}.` }
    : { id: "bird_number", name: "WhatsApp business number", status: "missing",
        detail: "BIRD_WHATSAPP_NUMBER is not set, so there's no sender.",
        fix: "Set BIRD_WHATSAPP_NUMBER to your WhatsApp number on Bird, in E.164 (e.g. +15551234567)." });

  // Template for messages outside the 24-hour window.
  const { rows: [w] } = await pool.query(
    `select count(*)::int as verified,
            count(*) filter (where last_inbound_at > now() - interval '23 hours 50 minutes')::int as open
     from phone_link where verified_at is not null`);
  if (!env("BIRD_TEMPLATE_SLUG")) {
    out.push({
      id: "bird_template", name: "Reminder template (outside 24 h)", status: "warn",
      detail: `No template set, so reminders only reach people who messaged in the last 24 hours (${w.open} of ${w.verified} connected users right now).`,
      fix: "Create a Utility template in Bird with a body variable named `reminder`, get it approved, then set BIRD_TEMPLATE_SLUG.",
    });
  } else {
    let detail = `Using \`${env("BIRD_TEMPLATE_SLUG")}\`. ${w.open} of ${w.verified} connected users have an open 24-hour window.`;
    let status = "ok";
    if (key) {
      try {
        const list = items(await bird("/whatsapp/templates", undefined, { method: "GET" }));
        if (list && !list.some((t) => t.slug === env("BIRD_TEMPLATE_SLUG"))) {
          status = "missing"; detail = `BIRD_TEMPLATE_SLUG is \`${env("BIRD_TEMPLATE_SLUG")}\`, but Bird has no template with that slug.`;
        }
      } catch { detail += " (Couldn't list templates to confirm it exists.)"; }
    }
    out.push({ id: "bird_template", name: "Reminder template (outside 24 h)", status, detail,
      fix: status === "ok" ? undefined : "Check the slug on bird.com/dashboard/w/whatsapp/templates." });
  }

  // Inbound webhook: secret set, registered with Bird, and receiving.
  const target = baseURL ? `${baseURL}/api/inbound` : null;
  const registered = hooks && target ? hooks.some((h) => String(h.url || "").startsWith(target) && h.status !== "paused") : null;
  const got = hb.phone_inbound?.at, badSig = hb.phone_inbound_bad_signature?.at;
  let status = "ok", detail, fix;
  if (!env("BIRD_WEBHOOK_SECRET")) {
    status = "missing"; detail = "BIRD_WEBHOOK_SECRET is not set, so replies and button taps are rejected.";
    fix = "Run `npm run messaging:webhook` with BETTER_AUTH_URL set to this site, then set the printed secret.";
  } else if (badSig && ago(badSig) < ago(got)) {
    status = "warn"; detail = `Bird is calling the webhook but the signature check fails (last ${when(badSig)}).`;
    fix = "BIRD_WEBHOOK_SECRET doesn't match the subscription. Re-run `npm run messaging:webhook` and update it.";
  } else if (registered === false) {
    status = "missing"; detail = `No active Bird webhook points at ${target}.`;
    fix = "Run `npm run messaging:webhook` with BETTER_AUTH_URL set to this site.";
  } else {
    detail = got ? `Last reply received ${when(got)}.` : "Configured; no replies received yet.";
    if (registered === null && key) detail += " (Couldn't confirm the webhook with Bird.)";
  }
  out.push({ id: "bird_webhook", name: "WhatsApp replies (webhook)", status, detail, fix });
  return out;
}
