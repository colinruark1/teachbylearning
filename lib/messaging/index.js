// Messaging facade: the ONLY module the rest of the app uses to reach people.
//
//   import { phone, email } from "../lib/messaging/index.js";
//
// Which service actually delivers is picked by env vars, so providers can be swapped as
// tools and prices change without touching app code:
//
//   PHONE_PROVIDER   bird-whatsapp | log | none   (default: bird-whatsapp if BIRD_API_KEY is set, else none)
//   EMAIL_PROVIDER   log | none                   (default: none)
//
// To add a provider, create lib/messaging/phone/<id>.js or lib/messaging/email/<id>.js that
// implements the contract below, and register it in PHONE_PROVIDERS / EMAIL_PROVIDERS.
//
// ── Phone provider contract ──────────────────────────────────────────────────────────
//   id, label                       e.g. "bird-whatsapp", "WhatsApp" (label is shown to users)
//   capabilities                    { buttons: bool,            // quick-reply buttons supported
//                                     replyWindowHours: number|null } // e.g. 24 for WhatsApp; null = can message anytime
//   configured()                    → bool (env vars present)
//   send(to, text, opts)            → "message" | "template"; opts: { buttons: [{slug, text}], idempotencyKey, lastInboundAt }
//                                     Throw CannotDeliver when the channel's rules forbid this send.
//   startVerification(to)           send a one-time code; throw VerificationFailed(userMessage) for user-fixable problems
//   checkVerification(to, code)     → { success, reason?: "incorrect_code"|"expired"|"attempts_exhausted"|"not_found", attemptsRemaining? }
//   inbound(request)                → { id, from, text, button } | null for an incoming-message webhook request
//                                     (verify its signature; throw InvalidSignature if it fails)
//   chatLink()                      → URL that opens a chat with us, or null
//   contactLink(to)  (optional)     → URL an admin can click to message `to` directly (default sms:)
//   registerWebhook(url)            → { id, secret, secretEnv } (used by scripts/register-webhook.js)
//   health(heartbeats)              → [{ id, name, status: "ok"|"warn"|"missing", detail, fix? }] for the admin dashboard
//
// ── Email provider contract ──────────────────────────────────────────────────────────
//   id, label, configured(), send({ to, subject, text }), health(heartbeats)
import { beat } from "../heartbeat.js";
import { CannotDeliver, VerificationFailed, InvalidSignature } from "./errors.js";
import * as birdWhatsApp from "./phone/bird-whatsapp.js";
import * as phoneLog from "./phone/log.js";
import * as emailLog from "./email/log.js";

export { CannotDeliver, VerificationFailed, InvalidSignature };

const PHONE_PROVIDERS = { "bird-whatsapp": birdWhatsApp, log: phoneLog };
const EMAIL_PROVIDERS = { log: emailLog };

const none = (kind) => ({
  id: "none", label: kind === "phone" ? "text message" : "email",
  capabilities: { buttons: false, replyWindowHours: null },
  configured: () => false,
  async send() { throw new CannotDeliver(`No ${kind} provider is configured.`); },
  async startVerification() { throw new VerificationFailed("Phone reminders aren't set up on this server yet."); },
  async checkVerification() { return { success: false, reason: "not_found" }; },
  async inbound() { return null; },
  chatLink: () => null,
  async registerWebhook() { throw new Error(`Set ${kind.toUpperCase()}_PROVIDER first.`); },
  async health() {
    return [{
      id: `${kind}_provider`, name: kind === "phone" ? "Phone messaging" : "Email sending", status: "missing",
      detail: `No ${kind} provider is selected (${kind.toUpperCase()}_PROVIDER), so ${kind === "phone" ? "phone reminders are off" : "the site can't send email"}.`,
      fix: `Pick a provider in lib/messaging/${kind}/ and set ${kind.toUpperCase()}_PROVIDER (see lib/messaging/index.js).`,
    }];
  },
});

// An unknown id (e.g. a typo in the env var) behaves like "none" so the site keeps working,
// and the admin dashboard's health check names the problem.
function pick(kind, registry, fallback) {
  const id = process.env[`${kind.toUpperCase()}_PROVIDER`] || fallback;
  if (!id || id === "none") return none(kind);
  if (registry[id]) return registry[id];
  const VAR = `${kind.toUpperCase()}_PROVIDER`;
  return {
    ...none(kind),
    async health() {
      return [{ id: `${kind}_provider`, name: kind === "phone" ? "Phone messaging" : "Email sending", status: "missing",
        detail: `${VAR} is "${id}", which isn't a known provider, so nothing is sent.`,
        fix: `Use one of: ${Object.keys(registry).join(", ")}, none (see lib/messaging/index.js).` }];
    },
  };
}

const phoneProvider = () => pick("phone", PHONE_PROVIDERS, process.env.BIRD_API_KEY ? "bird-whatsapp" : "none");
const emailProvider = () => pick("email", EMAIL_PROVIDERS, "none");

// Records each send for the admin dashboard's "is it actually working" checks.
async function tracked(kind, fn) {
  try {
    const r = await fn();
    await beat(`${kind}_send`, { via: typeof r === "string" ? r : null });
    return r;
  } catch (e) {
    if (!(e instanceof CannotDeliver)) {
      await beat(`${kind}_send_error`, { status: e.status ?? null, message: String(e.message).slice(0, 300) });
    }
    throw e;
  }
}

export const phone = {
  get id() { return phoneProvider().id; },
  get label() { return phoneProvider().label; },
  get capabilities() { return phoneProvider().capabilities; },
  configured: () => phoneProvider().configured(),
  send: (to, text, opts = {}) => tracked("phone", () => phoneProvider().send(to, text, opts)),
  startVerification: (to) => phoneProvider().startVerification(to),
  checkVerification: (to, code) => phoneProvider().checkVerification(to, code),
  inbound: (request) => phoneProvider().inbound(request),
  chatLink: () => phoneProvider().chatLink(),
  contactLink: (to) => phoneProvider().contactLink?.(to) ?? `sms:${to}`,
  registerWebhook: (url) => phoneProvider().registerWebhook(url),
  health: (hb) => phoneProvider().health(hb),
  // Can we send free-form right now, given when they last messaged us?
  replyWindowOpen(lastInboundAt) {
    const h = phoneProvider().capabilities.replyWindowHours;
    if (h == null) return true;
    return Boolean(lastInboundAt) && Date.now() - new Date(lastInboundAt).getTime() < h * 3600e3 - 10 * 60e3;
  },
};

export const email = {
  get id() { return emailProvider().id; },
  get label() { return emailProvider().label; },
  configured: () => emailProvider().configured(),
  send: (msg) => tracked("email", () => emailProvider().send(msg)),
  health: (hb) => emailProvider().health(hb),
};

// "(555) 123-4567" → "+15551234567". Bare 10-digit numbers are taken as US/Canada.
export function toE164(input) {
  const s = String(input ?? "").trim();
  const digits = s.replace(/\D/g, "");
  if (s.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === "1") return `+${digits}`;
  return null;
}
