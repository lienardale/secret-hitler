# 005 — Why the website never calls Auth.js's `auth()`

## Observed (in velo-atelier, same author; recorded in its `.debug/003`)

With JWT sessions, Auth.js re-encodes the session and writes the cookie on **every** `auth()`
call made in a route handler, a server action or the proxy (and deletes it when the token no
longer matches). A background request that left with an old token and answered after a
sign-out wrote the cookie back: 10 of 16 parallel sign-outs were undone by Next router
prefetches. velo-atelier fixed it with a cookie-write policy in its proxy, a wrapper around
`/api/auth/session`, and an `/api/session-expired` route for the loop between a proxy that still
believes a session and a page that rejects it.

## Decision here

The website uses Auth.js only to **sign in and out** (`signIn`, `signOut`, the OAuth endpoints).
Everything else reads the account with `getCurrentUser()` (`apps/web/lib/auth/current-user.ts`):
it decodes the session cookie with `next-auth/jwt`'s `decode` (same secret, same salt = cookie
name) and loads the row. Nothing but sign-in and sign-out ever writes the cookie, and the proxy
never looks at the session, so:

- no request can re-create a cookie after sign-out;
- the proxy and a page can never disagree (no redirect loop, no session-expired route);
- the token carries only `id` and `sv` (sessionVersion); display name, role, verified e-mail are
  read from Postgres per request (one indexed query, memoised per request with React `cache`),
  so a rename, a role change or a deleted account applies at once.

Cost: no rolling refresh — a session lasts 30 days from sign-in. `/api/auth/session` still exists
(Auth.js serves it) and is wrapped so it never writes or deletes the cookie.

## How to check

`tests/unit/auth.test.ts` (token round trip, salts, `withoutSessionWrites`) and
`tests/e2e/accounts.spec.ts` (sign out, then the header shows "Sign in" on the next page).
