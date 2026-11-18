// Who counts as an admin: accounts whose email is in ADMIN_EMAILS (comma-separated),
// defaulting to the site owner. Admins must also have 2FA on, like every account.
// Note: email addresses aren't verified at sign-up yet, so make sure the owner's account
// exists. Better Auth emails are unique, so nobody else can register the same address.
const DEFAULT_ADMINS = "colinruark1@gmail.com";

const adminEmails = () =>
  (process.env.ADMIN_EMAILS || DEFAULT_ADMINS).split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);

export const isAdmin = (user) =>
  Boolean(user?.twoFactorEnabled && user.email && adminEmails().includes(user.email.toLowerCase()));
