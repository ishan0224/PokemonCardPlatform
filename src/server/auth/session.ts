import { cookies } from "next/headers";
import { getAppUserById, upsertAppUserProfile } from "@/server/services/user.service";
import { ACCESS_TOKEN_COOKIE, validateSupabaseAccessToken } from "@/server/supabase/client";

export type ServerSessionUser = {
  id: string;
  username: string;
  email: string;
  role: "user" | "admin";
};

export type ServerSession = {
  user: ServerSessionUser | null;
  isAuthenticated: boolean;
};

type SessionErrorReason = "invalid_token" | "profile_lookup_failed";

function isInvalidTokenError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "Unknown error";
  const normalizedMessage = message.toLowerCase();
  return (
    normalizedMessage.includes("invalid") ||
    normalizedMessage.includes("expired") ||
    normalizedMessage.includes("jwt") ||
    normalizedMessage.includes("token") ||
    normalizedMessage.includes("unauthorized")
  );
}

function getErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.length > 0 ? code.toUpperCase() : null;
}

function isProfileLookupFailedError(error: unknown): boolean {
  const errorCode = getErrorCode(error);
  if (errorCode) {
    const transientCodes = new Set([
      "ENOTFOUND",
      "EAI_AGAIN",
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "57P01",
      "57P02",
      "57P03"
    ]);

    if (transientCodes.has(errorCode)) {
      return true;
    }
  }

  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return (
    message.includes("enotfound") ||
    message.includes("getaddrinfo") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("connection terminated") ||
    message.includes("network")
  );
}

function mapAppUserToSessionUser(appUser: Awaited<ReturnType<typeof upsertAppUserProfile>>): ServerSessionUser {
  return {
    id: appUser.id,
    username: appUser.username,
    email: appUser.email,
    role: appUser.role
  };
}

async function resolveAppUserOrSoftGuest(
  authUser: Awaited<ReturnType<typeof validateSupabaseAccessToken>>
): Promise<ServerSessionUser | null> {
  try {
    let appUser = await getAppUserById(authUser.userId);
    if (!appUser) {
      appUser = await upsertAppUserProfile({
        id: authUser.userId,
        email: authUser.email,
        username: authUser.username
      });
    }

    return mapAppUserToSessionUser(appUser);
  } catch (error) {
    if (isProfileLookupFailedError(error)) {
      console.warn("[auth-session] profile lookup failed", {
        reason: "profile_lookup_failed" satisfies SessionErrorReason,
        code: getErrorCode(error)
      });
      return null;
    }

    throw error;
  }
}

const readServerSession = async (): Promise<ServerSession> => {
  const accessToken = cookies().get(ACCESS_TOKEN_COOKIE)?.value;

  if (!accessToken) {
    return {
      user: null,
      isAuthenticated: false
    };
  }

  let authUser: Awaited<ReturnType<typeof validateSupabaseAccessToken>>;
  try {
    authUser = await validateSupabaseAccessToken(accessToken);
  } catch (error) {
    if (!isInvalidTokenError(error)) {
      throw error;
    }

    console.warn("[auth-session] token validation failed", {
      reason: "invalid_token" satisfies SessionErrorReason
    });
    return {
      user: null,
      isAuthenticated: false
    };
  }

  const user = await resolveAppUserOrSoftGuest(authUser);
  if (!user) {
    return {
      user: null,
      isAuthenticated: false
    };
  }

  return {
    user,
    isAuthenticated: true
  };
};

export async function useSession(): Promise<ServerSession> {
  return readServerSession();
}
