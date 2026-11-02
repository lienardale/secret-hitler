/** Small zod schemas reused by the message and payload schemas. */
import { z } from "zod";

import { ROOM_CODE_PATTERN } from "./codes";
import { checkDisplayNameShape, normalizeDisplayName } from "./names";

export const roomCodeSchema = z.string().regex(ROOM_CODE_PATTERN);

/**
 * A display name that is already normalized and well formed. Shape only
 * (not reserved names or word lists): an account whose name a newer list
 * would refuse must still be able to join its rooms.
 */
export const displayNameSchema = z
  .string()
  .refine((name) => name === normalizeDisplayName(name) && checkDisplayNameShape(name) === null, {
    message: "invalid display name",
  });

/** Account ids (cuid/uuid) and guest ids: URL-safe, at most 64 characters. */
export const subjectSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

export const identityKeySchema = z.string().regex(/^[ug]:[A-Za-z0-9_-]{1,64}$/);
