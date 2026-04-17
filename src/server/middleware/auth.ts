import type { NextRequest } from "next/server";
import type { Socket } from "socket.io";
import {
  ACCESS_TOKEN_COOKIE,
  type AuthenticatedUser,
  validateSupabaseAccessToken
} from "../supabase/client";

export class AuthError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode = 401, code = "UNAUTHORIZED") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function normalizeBearerToken(token: string): string {
  return token.startsWith("Bearer ") ? token.slice("Bearer ".length).trim() : token;
}

function parseCookieHeader(rawCookie: string): Record<string, string> {
  return rawCookie
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, pair) => {
      const separatorIndex = pair.indexOf("=");

      if (separatorIndex === -1) {
        return acc;
      }

      const key = pair.slice(0, separatorIndex).trim();
      const value = pair.slice(separatorIndex + 1).trim();
      acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
}

function getTokenFromAuthorizationHeader(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = normalizeBearerToken(value.trim());
  return normalized.length > 0 ? normalized : null;
}

export function getAccessTokenFromRequest(request: NextRequest): string | null {
  const fromCookie = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;

  if (fromCookie) {
    return fromCookie;
  }

  return getTokenFromAuthorizationHeader(request.headers.get("authorization"));
}

export async function requireAuth(request: NextRequest): Promise<AuthenticatedUser> {
  const accessToken = getAccessTokenFromRequest(request);

  if (!accessToken) {
    throw new AuthError("Authentication token is missing.");
  }

  try {
    return await validateSupabaseAccessToken(accessToken);
  } catch (_error) {
    throw new AuthError("Invalid or expired authentication token.");
  }
}

export async function authenticateSocket(
  socket: Socket,
  next: (error?: Error) => void
): Promise<void> {
  try {
    const accessToken = getAccessTokenFromSocketHandshake(socket);

    if (!accessToken) {
      return next(new AuthError("Authentication token is missing."));
    }

    const user = await validateSupabaseAccessToken(accessToken);
    socket.data.userId = user.userId;
    socket.data.email = user.email;
    socket.data.username = user.username;

    return next();
  } catch (_error) {
    return next(new AuthError("Socket authentication failed."));
  }
}

function getAccessTokenFromSocketHandshake(socket: Socket): string | null {
  const authToken =
    typeof socket.handshake.auth?.token === "string"
      ? normalizeBearerToken(socket.handshake.auth.token)
      : null;

  const cookieHeader = socket.handshake.headers.cookie;
  const parsedCookies = typeof cookieHeader === "string" ? parseCookieHeader(cookieHeader) : {};
  const cookieToken = parsedCookies[ACCESS_TOKEN_COOKIE];

  return authToken || cookieToken || null;
}

export async function authenticateSocketIfPresent(socket: Socket): Promise<void> {
  const accessToken = getAccessTokenFromSocketHandshake(socket);

  if (!accessToken) {
    return;
  }

  try {
    const user = await validateSupabaseAccessToken(accessToken);
    socket.data.userId = user.userId;
    socket.data.email = user.email;
    socket.data.username = user.username;
  } catch (_error) {
    // Invalid tokens are ignored for public-room access.
  }
}
