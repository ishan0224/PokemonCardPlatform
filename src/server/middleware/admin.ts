import type { NextRequest } from "next/server";
import { getAppUserById, type AppUser } from "../services/user.service";
import { AuthError, requireAuth } from "./auth";

export class AdminForbiddenError extends AuthError {
  constructor(message = "Admin access is required for this resource.") {
    super(message, 403, "FORBIDDEN");
  }
}

export function isAdminUser(user: Pick<AppUser, "role">): boolean {
  return user.role === "admin";
}

export async function requireAdmin(request: NextRequest): Promise<AppUser> {
  const authUser = await requireAuth(request);
  const appUser = await getAppUserById(authUser.userId);

  if (!appUser) {
    throw new AuthError("User profile is missing.", 401, "UNAUTHORIZED");
  }

  if (!isAdminUser(appUser)) {
    throw new AdminForbiddenError();
  }

  return appUser;
}
