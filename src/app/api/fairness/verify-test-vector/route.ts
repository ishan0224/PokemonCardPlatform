import { NextResponse } from "next/server";
import vector from "@/lib/fairness/__fixtures__/test-vector.json";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ vector }, { status: 200 });
}
