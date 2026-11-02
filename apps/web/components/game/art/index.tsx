/**
 * Game art in one place. Emblems and icons are original SVG drawn in code;
 * swap any export for real artwork without touching the components.
 */
import type { Party, Policy, Power, Role } from "@sh/engine";

import { FascistEmblem, HitlerEmblem, LiberalEmblem, type ArtProps } from "./emblems";
import { ExecuteIcon, InvestigateIcon, PeekIcon, SpecialElectionIcon } from "./icons";

export * from "./emblems";
export * from "./icons";

export function PartyEmblem({ party, ...props }: ArtProps & { party: Party }) {
  return party === "liberal" ? <LiberalEmblem {...props} /> : <FascistEmblem {...props} />;
}

export function PolicyEmblem({ policy, ...props }: ArtProps & { policy: Policy }) {
  return policy === "L" ? <LiberalEmblem {...props} /> : <FascistEmblem {...props} />;
}

export function RoleEmblem({ role, ...props }: ArtProps & { role: Role }) {
  if (role === "hitler") return <HitlerEmblem {...props} />;
  return <PartyEmblem party={role} {...props} />;
}

export function PowerIcon({ power, ...props }: ArtProps & { power: Power }) {
  switch (power) {
    case "investigate":
      return <InvestigateIcon {...props} />;
    case "peek":
      return <PeekIcon {...props} />;
    case "specialElection":
      return <SpecialElectionIcon {...props} />;
    case "execute":
      return <ExecuteIcon {...props} />;
  }
}
