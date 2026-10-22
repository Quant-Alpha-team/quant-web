// The dashboard has no login and the server holds the backend token, so any
// request that reaches it can read trading data or start a reconciliation.
// Binding to loopback keeps other machines out, but not pages open in the
// user's own browser:
// - DNS rebinding points a foreign hostname at 127.0.0.1, so every request's
//   Host must be on an allowlist.
// - Cross-site forms and fetches carry a foreign Origin, so unsafe methods
//   must come from the dashboard's own origin.
// X-Forwarded-* headers are client-controlled (a rebound page can set them on
// a same-origin fetch), so they are honored only behind a trusted proxy that
// overwrites them.

export type RequestGuardResult =
  | { ok: true }
  | { ok: false; code: "forbidden_host" | "forbidden_origin"; message: string };

type GuardedRequest = {
  method: string;
  headers: Pick<Headers, "get">;
};

export const DEFAULT_ALLOWED_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const firstValue = (value: string | null) => value?.split(",")[0].trim() || null;

// WHATWG URL parsing lowercases names, normalizes IPv6 spelling and drops
// default ports, so equivalent spellings compare equal on both sides.
function parseAuthority(authority: string | null, protocol = "http:") {
  if (!authority) return null;
  try {
    const url = new URL(`${protocol}//${authority}`);
    const bare = url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password;
    return bare && url.hostname ? url : null;
  } catch {
    return null;
  }
}

function canonicalHostname(entry: string) {
  const value = entry.trim();
  const bracketed = value.includes(":") && !value.startsWith("[") && value.split(":").length > 2
    ? `[${value}]`
    : value;
  return parseAuthority(bracketed)?.hostname ?? null;
}

export function parseAllowedHosts(value: string | undefined) {
  const entries = value?.trim() ? value.split(",") : DEFAULT_ALLOWED_HOSTS;
  return new Set(entries.map(canonicalHostname).filter((host): host is string => host !== null));
}

export function checkRequest(
  request: GuardedRequest,
  allowedHosts: ReadonlySet<string>,
  trustProxyHeaders = false,
): RequestGuardResult {
  const { headers } = request;
  const forwarded = (name: string) => (trustProxyHeaders ? firstValue(headers.get(name)) : null);
  const protocol = forwarded("x-forwarded-proto") === "https" ? "https:" : "http:";
  const target = parseAuthority(forwarded("x-forwarded-host") ?? headers.get("host"), protocol);
  if (!target || !allowedHosts.has(target.hostname)) {
    return { ok: false, code: "forbidden_host", message: "Requests must use an allowed host name." };
  }
  if (SAFE_METHODS.has(request.method.toUpperCase())) return { ok: true };

  // Current browsers send Origin on every cross-origin POST, so a missing
  // Origin means a non-browser client rather than another site.
  const origin = headers.get("origin");
  if (origin === null) return { ok: true };
  let source: URL;
  try {
    source = new URL(origin);
  } catch {
    return { ok: false, code: "forbidden_origin", message: "Cross-origin requests are not allowed." };
  }
  if (source.origin !== target.origin) {
    return { ok: false, code: "forbidden_origin", message: "Cross-origin requests are not allowed." };
  }
  return { ok: true };
}
