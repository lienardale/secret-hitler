/**
 * Card-shaped pieces: policy tiles and role cards. Every card says its name
 * in text as well as with colour and emblem.
 */
import type { Policy, Role } from "@sh/engine";

import { PolicyEmblem, RoleEmblem } from "./art";

const POLICY_SIZES = {
  /** Fills its grid cell (board tracks). */
  fluid: "w-full",
  sm: "w-10",
  md: "w-[4.5rem] sm:w-20",
} as const;

export function PolicyCard({
  policy,
  label,
  size = "md",
  className = "",
}: {
  policy: Policy;
  /** Visible name on the card ("Liberal" / "Fascist"). */
  label: string;
  size?: keyof typeof POLICY_SIZES;
  className?: string;
}) {
  const tone = policy === "L" ? "bg-liberal text-paper" : "bg-fascist text-paper";
  return (
    <span
      className={`sh-card @container relative flex aspect-[5/7] flex-col items-center justify-between overflow-hidden rounded-md border-2 border-ink/70 p-[6%] ${tone} ${POLICY_SIZES[size]} ${className}`}
    >
      <span className="sh-card-frame pointer-events-none absolute inset-[6%] rounded-sm border border-paper/60" />
      <PolicyEmblem policy={policy} className="mt-[12%] w-[62%] shrink-0" />
      <span className="relative w-full truncate text-center font-display text-[20cqw] leading-none tracking-tight uppercase">
        {label}
      </span>
    </span>
  );
}

const ROLE_TONE: Record<Role, string> = {
  liberal: "bg-liberal text-paper",
  fascist: "bg-fascist text-paper",
  hitler: "bg-fascist text-paper",
};

/** A role card face (used by the role reveal and the game-over list). */
export function RoleFace({
  role,
  label,
  partyLabel,
  className = "",
}: {
  role: Role;
  label: string;
  partyLabel?: string;
  className?: string;
}) {
  return (
    <span
      className={`sh-card @container relative flex aspect-[5/7] flex-col items-center justify-between overflow-hidden rounded-lg border-2 border-ink/70 p-[7%] ${ROLE_TONE[role]} ${className}`}
    >
      <span className="sh-card-frame pointer-events-none absolute inset-[5%] rounded-md border border-paper/60" />
      {partyLabel ? (
        <span className="relative text-center font-display text-[10.5cqw] leading-none uppercase opacity-90">
          {partyLabel}
        </span>
      ) : (
        <span />
      )}
      <RoleEmblem role={role} className="relative w-[58%]" />
      <span className="relative w-full truncate text-center font-display text-[20cqw] leading-none uppercase">
        {label}
      </span>
    </span>
  );
}

/** The back of a secret card. */
export function CardBack({ label, className = "" }: { label: string; className?: string }) {
  return (
    <span
      className={`sh-card sh-card-back @container relative flex aspect-[5/7] items-center justify-center overflow-hidden rounded-lg border-2 border-ink/70 bg-ink p-2 text-paper ${className}`}
    >
      <span className="pointer-events-none absolute inset-[5%] rounded-md border border-paper/40" />
      <span className="relative rounded-sm bg-ink px-1 text-center font-display text-[16cqw] leading-tight tracking-wide uppercase">
        {label}
      </span>
    </span>
  );
}
