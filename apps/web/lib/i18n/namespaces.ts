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
  // Content pages (M6): rules, credits, legal notice + privacy policy.
  "rules",
  "credits",
  "legal",
] as const;

export type Namespace = (typeof NAMESPACES)[number];

/**
 * Namespaces only server components read (the text pages). The root layout
 * leaves them out of the messages it hands to client components, so their
 * text is not shipped with every page.
 */
export const SERVER_ONLY_NAMESPACES: readonly Namespace[] = ["rules", "credits", "legal"];
