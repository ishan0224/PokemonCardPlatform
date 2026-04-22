import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  clearAuthSessionCookies,
  refreshSupabaseSession,
  setAuthSessionCookies
} from "@/server/supabase/client";

const ACCESS_TOKEN_SAFETY_WINDOW_SECONDS = 30;
const REFRESH_DEDUPE_WINDOW_MS = 60_000;
const AUTH_REFRESH_EXCLUDED_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/logout",
  "/api/auth/refresh"
]);

type RefreshTokenPair = {
  access_token: string;
  refresh_token: string;
};

type RefreshCacheEntry = {
  expiresAt: number;
  promise: Promise<RefreshTokenPair>;
};

const inFlightRefreshByTokenHash = new Map<string, RefreshCacheEntry>();

function buildRequestHeaders(request: NextRequest): Headers {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);
  return requestHeaders;
}

function decodeJwtExp(accessToken: string): number | null {
  const payload = decodeJwtPayload(accessToken);
  if (!payload) {
    return null;
  }

  const exp = Number(payload.exp);
  return Number.isFinite(exp) ? exp : null;
}

function decodeJwtPayload(accessToken: string): Record<string, unknown> | null {
  const segments = accessToken.split(".");
  if (segments.length < 2) {
    return null;
  }

  try {
    const payload = segments[1].replace(/-/g, "+").replace(/_/g, "/");
    const paddedPayload = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "=");
    return JSON.parse(atob(paddedPayload)) as Record<string, unknown>;
  } catch (_error) {
    return null;
  }
}

function isAccessTokenStale(accessToken: string, nowSeconds: number): boolean {
  const exp = decodeJwtExp(accessToken);
  if (!exp) {
    return true;
  }

  return exp - nowSeconds < ACCESS_TOKEN_SAFETY_WINDOW_SECONDS;
}

function hashToken(rawToken: string): string {
  let hash = 5381;
  for (let index = 0; index < rawToken.length; index += 1) {
    hash = (hash * 33) ^ rawToken.charCodeAt(index);
  }
  return (hash >>> 0).toString(16);
}

function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}

function clearRequestAuthCookies(request: NextRequest): void {
  request.cookies.set(ACCESS_TOKEN_COOKIE, "");
  request.cookies.set(REFRESH_TOKEN_COOKIE, "");
}

async function refreshSessionWithDedupe(refreshToken: string): Promise<RefreshTokenPair> {
  const tokenHash = hashToken(refreshToken);
  const now = Date.now();
  const cached = inFlightRefreshByTokenHash.get(tokenHash);

  if (cached && cached.expiresAt > now) {
    return cached.promise;
  }

  if (cached) {
    inFlightRefreshByTokenHash.delete(tokenHash);
  }

  const refreshPromise = refreshSupabaseSession(refreshToken);
  inFlightRefreshByTokenHash.set(tokenHash, {
    expiresAt: now + REFRESH_DEDUPE_WINDOW_MS,
    promise: refreshPromise
  });

  return refreshPromise;
}

function nextResponseWithHeaders(requestHeaders: Headers): NextResponse {
  return NextResponse.next({
    request: {
      headers: requestHeaders
    }
  });
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const requestHeaders = buildRequestHeaders(request);
  try {
    const pathname = request.nextUrl.pathname;

    if (AUTH_REFRESH_EXCLUDED_PATHS.has(pathname)) {
      return nextResponseWithHeaders(requestHeaders);
    }

    const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
    if (!accessToken) {
      return nextResponseWithHeaders(requestHeaders);
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (!isAccessTokenStale(accessToken, nowSeconds)) {
      return nextResponseWithHeaders(requestHeaders);
    }

    const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
    if (!refreshToken) {
      console.warn("[auth-middleware] refresh failed", { reason: "missing_refresh_token" });
      clearRequestAuthCookies(request);
      const response = nextResponseWithHeaders(requestHeaders);
      clearAuthSessionCookies(response);
      return response;
    }

    const session = await refreshSessionWithDedupe(refreshToken);
    request.cookies.set(ACCESS_TOKEN_COOKIE, session.access_token);
    request.cookies.set(REFRESH_TOKEN_COOKIE, session.refresh_token);

    const response = nextResponseWithHeaders(requestHeaders);
    setAuthSessionCookies(response, session);
    return response;
  } catch (error) {
    console.warn("[auth-middleware] refresh failed", {
      reason: "supabase_refresh_failed",
      message: sanitizeErrorMessage(error)
    });
    clearRequestAuthCookies(request);
    const response = nextResponseWithHeaders(requestHeaders);
    clearAuthSessionCookies(response);
    return response;
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map)$).*)"]
};
