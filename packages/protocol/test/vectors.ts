/**
 * Fixed HMAC test vector. The rooms Worker's tests import the same values and
 * check them inside workerd, proving Node and workerd sign identically.
 * The secret is a test value, not used anywhere else.
 */
export const HMAC_VECTOR = {
  secret: "ci-dummy-hmac-secret-0123456789abcdef",
  parts: { method: "POST", path: "/internal/rooms", body: '{"visibility":"private"}' },
  now: 1_800_000_000_000,
  header: "t=1800000000,v1=dac19233efbccd686c6eb91688edef7272c7fe07887b7fe188918a563148e0e4",
} as const;
