import { cache } from "react";
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

const readServerSession = cache(async (): Promise<ServerSession> => {
  const accessToken = cookies().get(ACCESS_TOKEN_COOKIE)?.value;

  if (!accessToken) {
    return {
      user: null,
      isAuthenticated: false
    };
  }

  try {
    const authUser = await validateSupabaseAccessToken(accessToken);
    let appUser = await getAppUserById(authUser.userId);

    if (!appUser) {
      appUser = await upsertAppUserProfile({
        id: authUser.userId,
        email: authUser.email,
        username: authUser.username
      });
    }

    return {
      user: {
        id: appUser.id,
        username: appUser.username,
        email: appUser.email,
        role: appUser.role
      },
      isAuthenticated: true
    };
  } catch (_error) {
    return {
      user: null,
      isAuthenticated: false
    };
  }
});

export async function useSession(): Promise<ServerSession> {
  return readServerSession();
}
