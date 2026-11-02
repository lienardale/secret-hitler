/** Message catalogues: one JSON file per namespace in messages/{fr,en}/. */
export const NAMESPACES = [
  "common",
  "room",
  "game",
  "auth",
  "lobby",
  "profile",
  "conduct",
  "admin",
] as const;

export type Namespace = (typeof NAMESPACES)[number];
