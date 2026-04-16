import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/server/middleware/auth";
import { handleRouteError } from "@/server/http/api";
import { getUserBalance } from "@/server/services/balance.service";
import { getAppUserById, upsertAppUserProfile } from "@/server/services/user.service";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const authUser = await requireAuth(request);

    let appUser = await getAppUserById(authUser.userId);

    if (!appUser) {
      appUser = await upsertAppUserProfile({
        id: authUser.userId,
        email: authUser.email,
        username: authUser.username
      });
    }

    const balance = await getUserBalance(authUser.userId);

    return NextResponse.json(
      {
        user: {
          id: appUser.id,
          username: appUser.username,
          email: appUser.email
        },
        balance
      },
      { status: 200 }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
