// Linq Partner API v3 client (iMessage → RCS → SMS, picked by Linq per recipient).
// Docs: https://docs.linqapp.com/channel/imessage/
// Env: LINQ_API_KEY (dashboard.linqapp.com → API → Overview → Generate new token),
//      LINQ_WEBHOOK_SECRET (the `whsec_…` signing secret; see scripts/linq-webhook.js),
//      LINQ_DRY_RUN=1 to log outgoing texts instead of sending them (local dev).
import { createHmac, timingSafeEqual } from "node:crypto";
import { beat } from "./heartbeat.js";

const API = "https://api.linqapp.com/api/partner/v3";

export const linqConfigured = () => Boolean(process.env.LINQ_API_KEY || process.env.LINQ_DRY_RUN);

export class LinqError extends Error {
  constructor(status, body) {
    super(`Linq API ${status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
  // The recipient replied STOP; Linq blocks further sends (403, code 2024).
  get optedOut() { return this.status === 403 && /2024|opt/i.test(JSON.stringify(this.body)); }
}

export async function linq(path, body, method = "POST") {
  const res = await fetch(API + path, {
    method,
    headers: { authorization: `Bearer ${process.env.LINQ_API_KEY}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new LinqError(res.status, data);
  return data;
}

// Text a phone number (E.164). Linq reuses the existing chat with that number, if any.
// Note: the first message in a new chat must not contain a link (error 1005).
export async function sendText(to, text) {
  if (process.env.LINQ_DRY_RUN) {
    console.log(`[linq dry run] → ${to}\n${text}\n`);
    return { dryRun: true };
  }
  try {
    const res = await linq("/messages", { to: [to], message: { parts: [{ type: "text", value: text }] } });
    await beat("linq_send", { service: res?.service ?? null });
    return res;
  } catch (e) {
    await beat("linq_send_error", { status: e.status ?? null, message: String(e.message).slice(0, 300) });
    throw e;
  }
}

// Verifies a Standard Webhooks signature: HMAC-SHA256 over "{id}.{timestamp}.{raw body}"
// with the base64-decoded `whsec_` secret, sent as "v1,<base64>" (possibly several, space-separated).
export function verifyWebhook(headers, rawBody, secret = process.env.LINQ_WEBHOOK_SECRET, now = Date.now()) {
  if (!secret) return false;
  const id = headers.get("webhook-id");
  const ts = headers.get("webhook-timestamp");
  const sigs = headers.get("webhook-signature");
  if (!id || !ts || !sigs) return false;
  if (Math.abs(now / 1000 - Number(ts)) > 5 * 60) return false; // replay window
  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  const expected = createHmac("sha256", key).update(`${id}.${ts}.${rawBody}`).digest();
  return sigs.split(" ").some((s) => {
    if (!s.startsWith("v1,")) return false;
    const got = Buffer.from(s.slice(3), "base64");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

// Pulls { eventId, from, text, inbound } out of a message.received event, for both the
// 2026-02-03 payload (sender_handle + parts) and the older 2025-01-01 one (from + message.parts).
export function parseInbound(event) {
  const d = event?.data ?? {};
  const parts = d.parts ?? d.message?.parts ?? [];
  return {
    eventId: event?.event_id,
    inbound: event?.event_type === "message.received"
      && d.direction !== "outbound" && d.is_from_me !== true && d.sender_handle?.is_me !== true
      && !d.chat?.is_group && !d.is_group,
    from: d.sender_handle?.handle ?? d.from ?? d.from_handle?.handle ?? "",
    text: parts.filter((p) => p.type === "text").map((p) => p.value).join(" ").trim(),
  };
}

// "(555) 123-4567" → "+15551234567". Bare 10-digit numbers are taken as US/Canada.
export function toE164(input) {
  const s = String(input ?? "").trim();
  const digits = s.replace(/\D/g, "");
  if (s.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === "1") return `+${digits}`;
  return null;
}
