/**
 * Who a player is, across the website and the rooms Worker. An identity key
 * is `u:<user id>` for accounts and `g:<guest id>` for guests; it is used for
 * blocks, kicks and game results, and never shown to other players (rooms show
 * a room-scoped `pid` instead).
 */
import { z } from "zod";

import { IDENTITY_KINDS, type IdentityKind } from "./constants";
import { displayNameSchema, subjectSchema } from "./primitives";

export function identityKey(kind: IdentityKind, sub: string): string {
  return `${kind === "user" ? "u" : "g"}:${sub}`;
}

export const identitySchema = z.strictObject({
  kind: z.enum(IDENTITY_KINDS),
  sub: subjectSchema,
  name: displayNameSchema,
});
export type Identity = z.infer<typeof identitySchema>;
