export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { clearAuthSessionCookies, REFRESH_TOKEN_COOKIE, refreshSupabaseSession, setAuthSessionCookies } from "@/server/supabase/client";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;

  if (!refreshToken) {
    const response = NextResponse.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "Refresh token is missing."
        }
      },
      { status: 401 }
    );
    clearAuthSessionCookies(response);
    return response;
  }

  try {
    const session = await refreshSupabaseSession(refreshToken);
    const response = NextResponse.json({ refreshed: true }, { status: 200 });
    setAuthSessionCookies(response, session);
    return response;
  } catch (_error) {
    const response = NextResponse.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "Refresh token is invalid or expired."
        }
      },
      { status: 401 }
    );
    clearAuthSessionCookies(response);
    return response;
  }
}
