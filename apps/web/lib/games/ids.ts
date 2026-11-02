/**
 * Account ids are Postgres `uuid`s. A string that is not one must never reach
 * a `uuid` column in a query (Postgres refuses the whole statement), so ids
 * from outside (a room's `sub`, a caller's argument) are checked first.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}
