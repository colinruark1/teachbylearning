// Vercel function serving every Better Auth route under /api/auth/*.
// vercel.json rewrites /api/auth/<path> here as /api/auth?__path=<path>; we rebuild
// the original URL so Better Auth can route on its pathname. If the function
// already sees the original path, it is used as-is.
import { auth } from "../lib/auth.js";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const rest = url.searchParams.get("__path");
    if (rest !== null && !url.pathname.startsWith("/api/auth/")) {
      url.pathname = `/api/auth/${rest}`;
    }
    url.searchParams.delete("__path");

    const hasBody = !["GET", "HEAD"].includes(request.method);
    return auth.handler(new Request(url, {
      method: request.method,
      headers: request.headers,
      body: hasBody ? request.body : undefined,
      duplex: hasBody ? "half" : undefined,
    }));
  },
};
