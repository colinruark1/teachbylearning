// Phone provider for local development: prints messages to the server log instead of
// sending them. Verification codes are always 000000. Implements the phone contract in
// lib/messaging/index.js. Select it with PHONE_PROVIDER=log.
import { InvalidSignature } from "../errors.js";

export const id = "log";
export const label = "text message (dev log)";
export const capabilities = { buttons: true, replyWindowHours: null };
const CODE = "000000";

export const configured = () => true;

export async function send(to, text, { buttons } = {}) {
  const btns = buttons?.length ? `\n[${buttons.map((b) => `${b.text} → ${b.slug}`).join("] [")}]` : "";
  console.log(`[phone → ${to}]\n${text}${btns}\n`);
  return "message";
}

export async function startVerification(to) {
  console.log(`[phone → ${to}] verification code: ${CODE}`);
}

export async function checkVerification(_to, code) {
  return code === CODE ? { success: true } : { success: false, reason: "incorrect_code" };
}

// Lets you fake an incoming message locally:
//   curl -X POST localhost:3000/api/inbound -H 'x-dev-inbound: 1' -d '{"from":"+15551234567","text":"status"}'
// Only accepted outside production.
export async function inbound(request) {
  if (process.env.VERCEL_ENV === "production" || !request.headers.get("x-dev-inbound")) throw new InvalidSignature();
  const b = await request.json().catch(() => ({}));
  return { id: `dev-${Date.now()}-${Math.random()}`, from: b.from ?? "", text: String(b.text ?? ""), button: b.button ?? null };
}

export const chatLink = () => null;

export async function registerWebhook() {
  throw new Error("The log provider has no webhook. Fake inbound messages with the x-dev-inbound header (see lib/messaging/phone/log.js).");
}

export async function health() {
  return [{
    id: "phone_provider", name: "Phone messaging", status: process.env.VERCEL_ENV === "production" ? "missing" : "warn",
    detail: "PHONE_PROVIDER=log: messages are printed to the server log, not sent.",
    fix: "Set PHONE_PROVIDER to a real provider (see lib/messaging/index.js) before launch.",
  }];
}
