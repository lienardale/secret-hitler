/**
 * Reading and writing the guest cookie from server code (pages, server
 * actions, route handlers). Writing is only possible in actions and route
 * handlers.
 */
import { cookies } from "next/headers";

import { getEnv } from "../env";
import { GUEST_COOKIE, GUEST_TTL_SECONDS, signGuest, verifyGuest, type Guest } from "./cookie";

export async function readGuest(): Promise<Guest | null> {
  const store = await cookies();
  return verifyGuest(store.get(GUEST_COOKIE)?.value, getEnv().GUEST_SECRET);
}

export async function writeGuest(guest: Guest): Promise<void> {
  const store = await cookies();
  store.set(GUEST_COOKIE, await signGuest(guest, getEnv().GUEST_SECRET), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: GUEST_TTL_SECONDS,
  });
}
