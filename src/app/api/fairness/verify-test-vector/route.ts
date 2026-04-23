// Static test vector — immutable data, safe to cache aggressively
export const revalidate = 3600;

import { NextResponse } from "next/server";
import vector from "@/lib/fairness/__fixtures__/test-vector.json";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ vector }, { status: 200 });
}
