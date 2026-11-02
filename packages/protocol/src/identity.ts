/**
 * Who a player is, across the website and the rooms Worker. An identity key
 * is `u:<user id>` for accounts and `g:<guest id>` for guests; it is used for
 * blocks, kicks and game results, and never shown to other players (rooms show
 * a room-scoped `pid` instead).
 */
import { z } from "zod";

import { displayNameSchema } from "./names";

export const IDENTITY_KINDS = ["user", "guest"] as const;
export type IdentityKind = (typeof IDENTITY_KINDS)[number];

/** Account ids (cuid/uuid) and guest ids: URL-safe, at most 64 characters. */
export const subjectSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

export const identityKeySchema = z.string().regex(/^[ug]:[A-Za-z0-9_-]{1,64}$/);

export function identityKey(kind: IdentityKind, sub: string): string {
  return `${kind === "user" ? "u" : "g"}:${sub}`;
}

export const identitySchema = z.strictObject({
  kind: z.enum(IDENTITY_KINDS),
  sub: subjectSchema,
  name: displayNameSchema,
});
export type Identity = z.infer<typeof identitySchema>;
