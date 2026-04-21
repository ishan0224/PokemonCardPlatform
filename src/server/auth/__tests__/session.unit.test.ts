import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCookie: vi.fn(),
  validateSupabaseAccessToken: vi.fn(),
  getAppUserById: vi.fn(),
  upsertAppUserProfile: vi.fn()
}));

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: mocks.getCookie
  })
}));

vi.mock("@/server/supabase/client", () => ({
  ACCESS_TOKEN_COOKIE: "pv_access_token",
  validateSupabaseAccessToken: mocks.validateSupabaseAccessToken
}));

vi.mock("@/server/services/user.service", () => ({
  getAppUserById: mocks.getAppUserById,
  upsertAppUserProfile: mocks.upsertAppUserProfile
}));

import { useSession } from "../session";

describe("readServerSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCookie.mockReturnValue({ value: "token" });
    mocks.validateSupabaseAccessToken.mockResolvedValue({
      userId: "user-1",
      email: "user@example.com",
      username: "trainer"
    });
  });

  it("soft-fails to guest when profile lookup throws transient network error", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const transientError = Object.assign(new Error("getaddrinfo ENOTFOUND aws-1-ap-south-1.pooler.supabase.com"), {
      code: "ENOTFOUND"
    });
    mocks.getAppUserById.mockRejectedValue(transientError);

    const session = await useSession();

    expect(session).toEqual({
      user: null,
      isAuthenticated: false
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith("[auth-session] profile lookup failed", {
      reason: "profile_lookup_failed",
      code: "ENOTFOUND"
    });

    warnSpy.mockRestore();
  });
});
