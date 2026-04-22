export const dynamic = "force-dynamic";

import { type NextRequest, NextResponse } from "next/server";
import { handleRouteError, readJsonBody } from "@/server/http/api";
import { requireAdmin } from "@/server/middleware/admin";
import {
  createAdminDropDraft,
  listAdminDrops,
  previewAdminDropComposition,
  type AdminDropMutationInput,
  type AdminDropStatus
} from "@/server/services/admin-drop.service";

function parseOptionalLimit(value: string | null): number | undefined {
  if (value === null || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return parsed;
}

function parseStatus(value: string | null): AdminDropStatus | "all" | undefined {
  if (!value || value.trim().length === 0) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  const allowed = new Set(["all", "draft", "upcoming", "active", "completed", "cancelled"]);
  if (!allowed.has(normalized)) {
    return undefined;
  }

  return normalized as AdminDropStatus | "all";
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin(request);

    const result = await listAdminDrops({
      cursor: request.nextUrl.searchParams.get("cursor"),
      limit: parseOptionalLimit(request.nextUrl.searchParams.get("limit")),
      status: parseStatus(request.nextUrl.searchParams.get("status"))
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin(request);
    const payload = await readJsonBody<AdminDropMutationInput>(request);
    const drop = await createAdminDropDraft(payload);

    return NextResponse.json({ drop }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin(request);
    const payload = await readJsonBody<AdminDropMutationInput>(request);
    const preview = await previewAdminDropComposition(payload);

    return NextResponse.json({ preview }, { status: 200 });
  } catch (error) {
    return handleRouteError(error);
  }
}
