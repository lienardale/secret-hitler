import type { Adapter, AdapterAccount } from "@auth/core/adapters";
import { describe, expect, it, vi } from "vitest";

import { minimalAccounts } from "@/lib/auth/minimal-accounts";

describe("minimalAccounts", () => {
  it("links a Google account without any OAuth token (the id_token holds the name and picture)", async () => {
    const linkAccount = vi.fn(async (account: AdapterAccount) => account);
    const adapter = minimalAccounts({ linkAccount } as Adapter);
    await adapter.linkAccount?.({
      userId: "u1",
      type: "oidc",
      provider: "google",
      providerAccountId: "123",
      access_token: "ci-dummy-access-token",
      refresh_token: "ci-dummy-refresh-token",
      id_token: "ci-dummy-id-token-with-name-and-picture",
      expires_at: 1,
      token_type: "bearer",
      scope: "openid email profile",
    });
    expect(linkAccount).toHaveBeenCalledWith({
      userId: "u1",
      type: "oidc",
      provider: "google",
      providerAccountId: "123",
    });
  });

  it("leaves an adapter without linkAccount unchanged", () => {
    const adapter = {} as Adapter;
    expect(minimalAccounts(adapter)).toBe(adapter);
  });
});
