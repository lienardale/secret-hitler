/**
 * Auth.js endpoints (OAuth callback, sign-in/out, csrf, providers, session).
 * `/api/auth/session` never writes or deletes the session cookie: a late
 * answer must not undo a sign-out (nothing in this app calls it anyway).
 */
import type { NextRequest } from "next/server";

import { handlers } from "@/auth";
import { withoutSessionWrites } from "@/lib/auth/session-token";

function isSessionRead(request: NextRequest): boolean {
  return new URL(request.url).pathname.endsWith("/api/auth/session");
}

export async function GET(request: NextRequest): Promise<Response> {
  const response = await handlers.GET(request);
  return isSessionRead(request) ? withoutSessionWrites(response) : response;
}

export async function POST(request: NextRequest): Promise<Response> {
  const response = await handlers.POST(request);
  return isSessionRead(request) ? withoutSessionWrites(response) : response;
}
