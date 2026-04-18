import { type NextRequest, NextResponse } from "next/server";
import { RATE_LIMITS } from "@/server/config/constants";
import { enforceRateLimit } from "@/server/middleware/rate-limit";
import { ApiRouteError, getClientIp, handleRouteError, readJsonBody } from "@/server/http/api";
import {
  createSupabaseAnonClient,
  setAuthSessionCookies
} from "@/server/supabase/client";
import { upsertAppUserProfile } from "@/server/services/user.service";

type LoginBody = {
  email: string;
  password: string;
};

function validateLoginBody(payload: LoginBody): LoginBody {
  if (!payload || typeof payload !== "object") {
    throw new ApiRouteError("Body is required.", 400, "INVALID_BODY");
  }

  const email = payload.email?.trim().toLowerCase();
  const password = payload.password;

  if (!email || !email.includes("@")) {
    throw new ApiRouteError("A valid email is required.", 400, "INVALID_EMAIL");
  }

  if (!password) {
    throw new ApiRouteError("Password is required.", 400, "INVALID_PASSWORD");
  }

  return { email, password };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await enforceRateLimit({
      key: `auth:login:${getClientIp(request)}`,
      ...RATE_LIMITS.login
    });

    const body = validateLoginBody(await readJsonBody<LoginBody>(request));

    const supabase = createSupabaseAnonClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: body.email,
      password: body.password
    });

    if (error || !data.user || !data.session) {
      throw new ApiRouteError("Invalid email or password.", 401, "INVALID_CREDENTIALS");
    }

    const appUser = await upsertAppUserProfile({
      id: data.user.id,
      email: data.user.email ?? body.email,
      username: typeof data.user.user_metadata?.username === "string" ? data.user.user_metadata.username : undefined
    });

    const response = NextResponse.json(
      {
        user: {
          id: appUser.id,
          username: appUser.username,
          email: appUser.email,
          role: appUser.role
        }
      },
      { status: 200 }
    );

    setAuthSessionCookies(response, data.session);
    return response;
  } catch (error) {
    return handleRouteError(error);
  }
}
