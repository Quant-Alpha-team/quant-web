import { NextResponse, type NextRequest } from "next/server";
import { logWarning } from "@/lib/logger";
import { checkRequest, parseAllowedHosts } from "@/lib/request-guard";

const allowedHosts = parseAllowedHosts(process.env.WEB_ALLOWED_HOSTS);
const trustProxyHeaders = process.env.WEB_TRUST_PROXY_HEADERS === "true";

export function proxy(request: NextRequest) {
  const result = checkRequest(request, allowedHosts, trustProxyHeaders);
  if (result.ok) return NextResponse.next();

  const { pathname } = request.nextUrl;
  logWarning("Rejected request", {
    code: result.code,
    method: request.method,
    path: pathname,
    host: request.headers.get("host"),
    forwarded_host: request.headers.get("x-forwarded-host"),
    origin: request.headers.get("origin"),
  });
  if (pathname.startsWith("/api/")) {
    return Response.json({ ok: false, error: { code: result.code, message: result.message } }, { status: 403 });
  }
  return new Response(result.message, { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
}

// Build output carries no data; everything else, including public files and
// /_next/image (disabled in next.config.mjs), is guarded.
export const config = {
  matcher: ["/((?!_next/static/).*)"],
};
