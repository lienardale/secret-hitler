import type { Adapter, AdapterAccount } from "@auth/core/adapters";

/**
 * Linked accounts keep who the account is (provider + its id) and nothing else:
 * no access/refresh token (we never call Google's APIs) and no id_token, which
 * holds Google's name and picture.
 */
export function minimalAccounts(adapter: Adapter): Adapter {
  const link = adapter.linkAccount;
  if (!link) return adapter;
  return {
    ...adapter,
    linkAccount: (account: AdapterAccount) =>
      link({
        userId: account.userId,
        type: account.type,
        provider: account.provider,
        providerAccountId: account.providerAccountId,
      }),
  };
}
