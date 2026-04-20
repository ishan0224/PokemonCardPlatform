import { NextResponse, type NextRequest } from "next/server";

export type ApiErrorPayload = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export class ApiRouteError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(message: string, statusCode = 400, code = "BAD_REQUEST", details?: Record<string, unknown>) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function jsonError(error: ApiErrorPayload, statusCode = 400): NextResponse {
  return NextResponse.json(
    {
      error
    },
    { status: statusCode }
  );
}

export function jsonOk<T>(payload: T, statusCode = 200): NextResponse {
  return NextResponse.json(payload, { status: statusCode });
}

export async function readJsonBody<T>(request: NextRequest): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch (_error) {
    throw new ApiRouteError("Invalid JSON payload.", 400, "INVALID_JSON");
  }
}

export function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");

  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }

  const realIp = request.headers.get("x-real-ip");
  return realIp || "unknown";
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requireUuid(value: string | undefined | null, fieldName: string): string {
  const normalized = value?.trim();

  if (!normalized) {
    throw new ApiRouteError(`${fieldName} is required.`, 400, "INVALID_UUID", { field: fieldName });
  }

  if (!UUID_REGEX.test(normalized)) {
    throw new ApiRouteError(`${fieldName} must be a valid UUID.`, 400, "INVALID_UUID", { field: fieldName });
  }

  return normalized;
}

export function handleRouteError(error: unknown): NextResponse {
  if (error instanceof ApiRouteError) {
    return jsonError(
      {
        code: error.code,
        message: error.message,
        details: error.details
      },
      error.statusCode
    );
  }

  const typedError = error as { statusCode?: number; code?: string; message?: string; details?: Record<string, unknown> };

  if (typedError.statusCode && typedError.code) {
    return jsonError(
      {
        code: typedError.code,
        message: typedError.message || "Request failed.",
        details: typedError.details
      },
      typedError.statusCode
    );
  }

  console.error("[api] unhandled route error:", error);
  return jsonError(
    {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred."
    },
    500
  );
}
