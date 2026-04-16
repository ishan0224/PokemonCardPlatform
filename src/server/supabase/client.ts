import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { NextResponse } from "next/server";

export const ACCESS_TOKEN_COOKIE = "pv_access_token";
export const REFRESH_TOKEN_COOKIE = "pv_refresh_token";
export const AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not configured.`);
  }

  return value;
}

function createBaseClient(key: string): SupabaseClient {
  return createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

export function createSupabaseAnonClient(): SupabaseClient {
  return createBaseClient(requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"));
}

export function createSupabaseServiceClient(): SupabaseClient {
  return createBaseClient(requireEnv("SUPABASE_SERVICE_ROLE_KEY"));
}

function getAuthCookieOptions(maxAge: number): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge
  };
}

type SessionTokenPair = {
  access_token: string;
  refresh_token: string;
};

export function setAuthSessionCookies(response: NextResponse, session: SessionTokenPair): void {
  const options = getAuthCookieOptions(AUTH_COOKIE_MAX_AGE_SECONDS);
  response.cookies.set(ACCESS_TOKEN_COOKIE, session.access_token, options);
  response.cookies.set(REFRESH_TOKEN_COOKIE, session.refresh_token, options);
}

export function clearAuthSessionCookies(response: NextResponse): void {
  const options = getAuthCookieOptions(0);
  response.cookies.set(ACCESS_TOKEN_COOKIE, "", options);
  response.cookies.set(REFRESH_TOKEN_COOKIE, "", options);
}

export type AuthenticatedUser = {
  userId: string;
  email: string;
  username?: string;
  rawUser: User;
};

export async function validateSupabaseAccessToken(accessToken: string): Promise<AuthenticatedUser> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.auth.getUser(accessToken);

  if (error || !data.user) {
    throw new Error("Invalid or expired access token.");
  }

  return {
    userId: data.user.id,
    email: data.user.email ?? "",
    username:
      typeof data.user.user_metadata?.username === "string"
        ? data.user.user_metadata.username
        : undefined,
    rawUser: data.user
  };
}
