/**
 * Auth.js v5: Credentials (e-mail + password) always, Google when
 * AUTH_GOOGLE_ID/AUTH_GOOGLE_SECRET are set. JWT sessions.
 *
 * Used ONLY to sign in and out (and for the OAuth endpoints). Pages, actions
 * and route handlers read the account with `getCurrentUser()`
 * (lib/auth/current-user.ts), which decodes the cookie without writing it.
 * The token carries `id` and `sv` (sessionVersion) and nothing else: names
 * and roles are read from Postgres, so they are never stale.
 *
 * Google (from velo-atelier):
 * - `allowDangerousEmailAccountLinking` links a Google sign-in to the password
 *   account with the same address. Safe only because the `signIn` callback
 *   refuses a Google profile without `email_verified === true`, and the link
 *   guard refuses to attach a Google account to whoever a session cookie names
 *   unless it is provably theirs (lib/auth/oauth-link-guard.ts).
 * - Google's name and picture are never stored (`profile` keeps id + e-mail,
 *   and `linkAccount` keeps only the Google account id, none of the OAuth
 *   tokens: Google's id_token carries the name and picture): the only name
 *   other players see is the display name chosen at onboarding.
 *
 * The config is built per request (`NextAuth(() => …)`), so `next build`
 * needs no secret and the Google provider follows the environment.
 */
import { PrismaAdapter } from "@auth/prisma-adapter";
import { cookies } from "next/headers";
import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";

import { authorizeCredentials } from "@/lib/auth/authorize";
import { minimalAccounts } from "@/lib/auth/minimal-accounts";
import { isEmailBarred } from "@/lib/moderation/barred-emails";
import { guardedSignIn } from "@/lib/auth/oauth-link-guard";
import {
  decodeSessionToken,
  presentSessionCookie,
  SESSION_MAX_AGE_S,
} from "@/lib/auth/session-token";
import { prisma } from "@/lib/db/prisma";
import { isLocale, routing, type Locale } from "@/lib/i18n/routing";
import { clientIp } from "@/lib/security/client-ip";
import { createDbRateLimiter } from "@/lib/security/db-rate-limit";

const LOCALE_COOKIE = "NEXT_LOCALE";

async function requestLocale(): Promise<Locale> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : routing.defaultLocale;
}

/** Google's `email_verified`, read defensively (some providers send the string "true"). */
export function isEmailVerified(profile: unknown): boolean {
  const claim = (profile as { email_verified?: unknown } | undefined)?.email_verified;
  return claim === true || claim === "true";
}

/** The user id the request's session cookie names (decrypted only), as Auth.js would link to. */
async function sessionCookieUserId(): Promise<string | null> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  const jar = await cookies();
  const name = presentSessionCookie(jar.getAll().map((cookie) => cookie.name));
  const token = name ? jar.get(name)?.value : undefined;
  if (!name || !token) return null;
  return (await decodeSessionToken(token, { secret, cookieName: name }))?.id ?? null;
}

export function googleEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET);
}

function config(): NextAuthConfig {
  const providers: NextAuthConfig["providers"] = [
    Credentials({
      credentials: { email: { type: "email" }, password: { type: "password" } },
      authorize: (credentials, request) =>
        authorizeCredentials(credentials, {
          prisma,
          rateLimiter: createDbRateLimiter(prisma),
          ip: clientIp(request.headers),
          isProduction: process.env.NODE_ENV === "production",
        }),
    }),
  ];
  if (googleEnabled()) {
    providers.push(
      Google({
        allowDangerousEmailAccountLinking: true,
        profile: (profile) => ({ id: profile.sub, email: profile.email }),
      }),
    );
  }

  return {
    adapter: minimalAccounts(
      PrismaAdapter(prisma as unknown as Parameters<typeof PrismaAdapter>[0]),
    ),
    providers,
    session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_S },
    // Unprefixed: Auth.js builds these URLs itself; proxy.ts adds the locale.
    pages: { signIn: "/connexion", error: "/connexion" },
    callbacks: {
      signIn: guardedSignIn({
        baseSignIn: async ({ account, profile }) => {
          if (account?.provider !== "google") return true;
          if (!isEmailVerified(profile)) {
            return `/${await requestLocale()}/connexion?error=OAuthAccountNotLinked`;
          }
          // An account deleted while suspended: its address waits for the suspension's end.
          const email = typeof profile?.email === "string" ? profile.email : "";
          if (email !== "" && (await isEmailBarred(prisma, email))) {
            return `/${await requestLocale()}/connexion?error=EmailBarred`;
          }
          return true;
        },
        sessionUserId: sessionCookieUserId,
        lookups: {
          linkedUserId: async (providerAccountId) =>
            (
              await prisma.account.findUnique({
                where: { provider_providerAccountId: { provider: "google", providerAccountId } },
                select: { userId: true },
              })
            )?.userId ?? null,
          userEmail: async (id) =>
            (await prisma.user.findUnique({ where: { id }, select: { email: true } }))?.email ??
            null,
        },
        refusalUrl: async () => `/${await requestLocale()}/connexion?error=OAuthAccountNotLinked`,
      }) as NonNullable<NextAuthConfig["callbacks"]>["signIn"],

      /** Only `id` and `sv`: everything else is read from the row on each request. */
      jwt({ token, user }) {
        if (user) {
          const id = user.id ?? token.sub;
          if (!id) return null;
          return {
            sub: id,
            id,
            sv: (user as { sessionVersion?: number }).sessionVersion ?? 0,
          };
        }
        return token;
      },

      session({ session, token }) {
        // Never handed to a browser by this app; kept minimal for Auth.js's own endpoints.
        return { ...session, user: { id: String(token.id ?? token.sub ?? "") } } as typeof session;
      },

      redirect({ url, baseUrl }) {
        if (url.startsWith("/") && !url.startsWith("//")) return `${baseUrl}${url}`;
        try {
          return new URL(url).origin === baseUrl ? url : baseUrl;
        } catch {
          return baseUrl;
        }
      },
    },
    events: {
      /** Google has vouched for the address (the signIn callback checked email_verified). */
      async linkAccount({ user, account }) {
        if (account.provider !== "google" || !user.id) return;
        await prisma.user.update({ where: { id: user.id }, data: { emailVerified: new Date() } });
      },
      /** A new Google account starts in the language the visitor was browsing in. */
      async createUser({ user }) {
        if (!user.id) return;
        await prisma.user.update({
          where: { id: user.id },
          data: { locale: await requestLocale() },
        });
      },
    },
  };
}

export const { handlers, signIn, signOut } = NextAuth(() => config());
