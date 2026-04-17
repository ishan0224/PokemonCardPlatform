import { type NextRequest, NextResponse } from "next/server";
import { RATE_LIMITS } from "@/server/config/constants";
import { enforceRateLimit } from "@/server/middleware/rate-limit";
import { ApiRouteError, getClientIp, handleRouteError, readJsonBody } from "@/server/http/api";
import {
  createSupabaseAnonClient,
  setAuthSessionCookies
} from "@/server/supabase/client";
import { upsertAppUserProfile } from "@/server/services/user.service";

type RegisterBody = {
  username: string;
  email: string;
  password: string;
};

type AuthProviderError = {
  message: string;
  status?: number;
};

function validateRegisterBody(payload: RegisterBody): RegisterBody {
  if (!payload || typeof payload !== "object") {
    throw new ApiRouteError("Body is required.", 400, "INVALID_BODY");
  }

  const username = payload.username?.trim();
  const email = payload.email?.trim().toLowerCase();
  const password = payload.password;

  if (!username || username.length < 3 || username.length > 32) {
    throw new ApiRouteError("Username must be 3-32 characters.", 400, "INVALID_USERNAME");
  }

  if (!email || !email.includes("@")) {
    throw new ApiRouteError("A valid email is required.", 400, "INVALID_EMAIL");
  }

  if (!password || password.length < 8) {
    throw new ApiRouteError("Password must be at least 8 characters.", 400, "INVALID_PASSWORD");
  }

  return { username, email, password };
}

function mapRegisterProviderError(error: AuthProviderError): ApiRouteError {
  const normalizedMessage = error.message.toLowerCase();
  const isRateLimited = error.status === 429 || normalizedMessage.includes("rate limit");

  if (isRateLimited) {
    return new ApiRouteError("Registration rate limit reached. Please retry shortly.", 429, "AUTH_RATE_LIMITED");
  }

  return new ApiRouteError(error.message, 400, "AUTH_REGISTER_FAILED");
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    if (process.env.NODE_ENV === "production") {
      await enforceRateLimit({
        key: `auth:register:${getClientIp(request)}`,
        ...RATE_LIMITS.register
      });
    }

    const body = validateRegisterBody(await readJsonBody<RegisterBody>(request));

    const supabase = createSupabaseAnonClient();
    const { data, error } = await supabase.auth.signUp({
      email: body.email,
      password: body.password,
      options: {
        data: {
          username: body.username
        }
      }
    });

    if (error) {
      throw mapRegisterProviderError({
        message: error.message,
        status: (error as { status?: number }).status
      });
    }

    if (!data.user) {
      throw new ApiRouteError("Supabase did not return a user.", 500, "AUTH_USER_MISSING");
    }

    const appUser = await upsertAppUserProfile({
      id: data.user.id,
      username: body.username,
      email: body.email
    });

    const response = NextResponse.json(
      {
        user: {
          id: appUser.id,
          username: appUser.username,
          email: appUser.email
        },
        requiresEmailConfirmation: !data.session
      },
      { status: 201 }
    );

    if (data.session) {
      setAuthSessionCookies(response, data.session);
    }

    return response;
  } catch (error) {
    return handleRouteError(error);
  }
}
