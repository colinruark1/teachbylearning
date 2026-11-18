// Email provider for local development: prints emails to the server log instead of sending
// them. Implements the email contract in lib/messaging/index.js. Select it with EMAIL_PROVIDER=log.
//
// A real provider (Resend, Postmark, SES, …) is the same shape: send({ to, subject, text })
// makes one API call, and health() checks its key.
export const id = "log";
export const label = "email (dev log)";

export const configured = () => true;

export async function send({ to, subject, text }) {
  console.log(`[email → ${to}] ${subject}\n${text}\n`);
  return "message";
}

export async function health() {
  return [{
    id: "email_provider", name: "Email sending", status: process.env.VERCEL_ENV === "production" ? "missing" : "warn",
    detail: "EMAIL_PROVIDER=log: emails are printed to the server log, not sent.",
    fix: "Add a real provider in lib/messaging/email/ and set EMAIL_PROVIDER.",
  }];
}
