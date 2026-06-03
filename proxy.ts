import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATH_PREFIXES = [
  "/outreach/confirm/",
  "/_next/",
];

const PUBLIC_EXACT_PATHS = new Set([
  "/api/leads/import",
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml",
]);

function scannerAccessCredentials(): { username: string; password: string } | null {
  const username =
    process.env.SCANNER_ACCESS_USERNAME?.trim() ||
    process.env.SCANNER_ADMIN_USERNAME?.trim() ||
    "";
  const password =
    process.env.SCANNER_ACCESS_PASSWORD?.trim() ||
    process.env.SCANNER_ADMIN_PASSWORD?.trim() ||
    "";

  if (!username || !password) return null;
  return { username, password };
}

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT_PATHS.has(pathname)) return true;
  return PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function unauthorized(): NextResponse {
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Sami Nouri Law Firm Scanner"',
    },
  });
}

function unavailable(): NextResponse {
  return new NextResponse("Scanner access credentials are not configured.", {
    status: 503,
  });
}

function isAuthorized(request: NextRequest, username: string, password: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  const [scheme, encoded] = header.split(" ");
  if (scheme?.toLowerCase() !== "basic" || !encoded) return false;

  let decoded = "";
  try {
    decoded = atob(encoded);
  } catch {
    return false;
  }

  const separator = decoded.indexOf(":");
  if (separator < 0) return false;

  const gotUsername = decoded.slice(0, separator);
  const gotPassword = decoded.slice(separator + 1);
  return gotUsername === username && gotPassword === password;
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const credentials = scannerAccessCredentials();
  if (!credentials) {
    return process.env.NODE_ENV === "production"
      ? unavailable()
      : NextResponse.next();
  }

  if (isAuthorized(request, credentials.username, credentials.password)) {
    return NextResponse.next();
  }

  return unauthorized();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
