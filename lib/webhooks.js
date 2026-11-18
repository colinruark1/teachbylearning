// Standard Webhooks signature check (https://www.standardwebhooks.com), used by Bird:
// HMAC-SHA256 over "{webhook-id}.{webhook-timestamp}.{raw body}" with the base64-decoded
// `whsec_` secret, sent as "v1,<base64>" (possibly several, space-separated, while rotating).
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyStandardWebhook(headers, rawBody, secret, now = Date.now()) {
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
