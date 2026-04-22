export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { clearAuthSessionCookies } from "@/server/supabase/client";

export async function POST(): Promise<NextResponse> {
  const response = NextResponse.json({ success: true }, { status: 200 });
  clearAuthSessionCookies(response);
  return response;
}
