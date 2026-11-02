"use server";

/**
 * Account actions: sign in (password or Google), sign up, sign out, onboarding
 * (display name + 15 or older) and e-mail verification.
 *
 * Expected failures come back as `auth.errors.*` / `auth.password.*` keys,
 * never thrown. `signIn()` succeeds by throwing NEXT_REDIRECT, so each call
 * sits in a try whose catch starts with `unstable_rethrow`.
 *
 * Unknown e-mail and wrong password give the same answer (no account
 * enumeration on sign-in). Sign-up does say "this address has an account":
 * accepted (velo-atelier made the same call), limited to 5 sign-ups per hour
 * per address.
 */
import { redirect as nextRedirect, unstable_rethrow } from "next/navigation";
import { cookies, headers } from "next/headers";

import { signIn, signOut } from "@/auth";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isDisplayNameTaken, validateDisplayName } from "@/lib/auth/display-name";
import { emailSchema, normalizeEmail } from "@/lib/auth/email";
import { signInFailure } from "@/lib/auth/errors";
import { hashPassword } from "@/lib/auth/password";
import { checkPassword, type PasswordProblem } from "@/lib/auth/password-policy";
import { safeCallbackUrl } from "@/lib/auth/safe-callback-url";
import { sendVerificationMail } from "@/lib/auth/send-verification";
import { consumeVerificationToken } from "@/lib/auth/verification";
import { isUniqueViolation } from "@/lib/db/errors";
import { prisma } from "@/lib/db/prisma";
import { isLocale, routing, type Locale } from "@/lib/i18n/routing";
import { clientIp, LOCAL_CLIENT } from "@/lib/security/client-ip";
import {
  allowAllRateLimiter,
  createDbRateLimiter,
  DB_RATE_LIMITS,
  rateLimitKey,
} from "@/lib/security/db-rate-limit";
import { isSameOrigin } from "@/lib/security/origin";
import { siteOrigin } from "@/lib/site-url";

type Field = "email" | "password" | "displayName" | "age";

export type AuthFormState =
  | null
  | { ok: true; notice?: "verificationSent" | "verified" }
  | {
      ok: false;
      /** `auth.errors.*` key for the form. */
      error?: string;
      /** `auth.errors.*` or `auth.password.*` keys per input. */
      fields?: Partial<Record<Field, string>>;
      retryAfterSec?: number;
      /**
       * What was typed (never the password): React resets a form after its
       * action, so the inputs take these back as their default values.
       */
      values?: { email?: string; displayName?: string };
    };

function formLocale(value: unknown): Locale {
  return isLocale(value) ? value : routing.defaultLocale;
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

const passwordKey = (problem: PasswordProblem) => `password.${problem}`;

async function sameOrigin(): Promise<Headers | null> {
  const h = await headers();
  return isSameOrigin(h) ? h : null;
}

/** The per-IP sign-up bucket (none for `next dev` without a proxy header). */
function ipLimiter(ip: string) {
  return ip === LOCAL_CLIENT && process.env.NODE_ENV !== "production"
    ? allowAllRateLimiter
    : createDbRateLimiter(prisma);
}

export async function signInAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await sameOrigin())) return { ok: false, error: "forbidden" };
  const locale = formLocale(formData.get("locale"));
  const email = text(formData, "email").trim();
  const password = text(formData, "password");
  const values = { email: email.slice(0, 254) };
  if (!email || !password || email.length > 254) {
    return { ok: false, error: "invalidCredentials", values };
  }
  const redirectTo = safeCallbackUrl(formData.get("callbackUrl"), locale);
  try {
    await signIn("credentials", { email, password, redirectTo });
  } catch (error) {
    unstable_rethrow(error);
    const failure = signInFailure(error);
    if (!failure) throw error;
    if (failure.kind === "rate_limited") {
      return { ok: false, error: "rateLimited", retryAfterSec: failure.retryAfterSec, values };
    }
    return { ok: false, error: "invalidCredentials", values };
  }
  return { ok: false, error: "authFailed", values };
}

export async function signUpAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const h = await sameOrigin();
  if (!h) return { ok: false, error: "forbidden" };
  const locale = formLocale(formData.get("locale"));

  const ip = clientIp(h);
  const verdict = await ipLimiter(ip).consume(
    rateLimitKey("signup", ip),
    DB_RATE_LIMITS.signupPerIp,
  );
  if (!verdict.ok) {
    return {
      ok: false,
      error: "rateLimited",
      retryAfterSec: Math.ceil(verdict.retryAfterMs / 1000),
    };
  }

  const values = {
    email: text(formData, "email").trim().slice(0, 254),
    displayName: text(formData, "displayName").slice(0, 40),
  };
  const fields: Partial<Record<Field, string>> = {};
  const parsedEmail = emailSchema.safeParse(values.email);
  if (!parsedEmail.success) fields.email = "errors.emailInvalid";
  const email = parsedEmail.success ? normalizeEmail(parsedEmail.data) : "";
  const password = text(formData, "password");
  const passwordProblem = checkPassword(password, { email });
  if (passwordProblem) fields.password = passwordKey(passwordProblem);
  const name = validateDisplayName(formData.get("displayName"));
  if (!name.ok) fields.displayName = `errors.${name.error}`;
  if (formData.get("age") !== "on") fields.age = "errors.ageRequired";
  if (Object.keys(fields).length > 0 || !name.ok) return { ok: false, fields, values };

  const now = new Date();
  let user: { id: string; email: string; displayName: string | null; locale: Locale };
  try {
    user = await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(password),
        displayName: name.name,
        displayNameKey: name.key,
        ageConfirmedAt: now,
        locale,
      },
      select: { id: true, email: true, displayName: true, locale: true },
    });
  } catch (error) {
    if (isUniqueViolation(error, "email")) {
      return { ok: false, fields: { email: "errors.emailTaken" }, values };
    }
    if (isDisplayNameTaken(error)) {
      return { ok: false, fields: { displayName: "errors.nameTaken" }, values };
    }
    throw error;
  }

  await sendVerificationMail(user, siteOrigin(h)).catch((error: unknown) => {
    console.error(
      `[auth] verification mail failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  });

  const redirectTo = safeCallbackUrl(formData.get("callbackUrl"), locale);
  try {
    await signIn("credentials", { email, password, redirectTo });
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: "authFailed" };
  }
  return { ok: false, error: "authFailed" };
}

/**
 * Starts the Google round trip. The locale cookie is written first: the
 * callback URL carries no locale, and new accounts take it from the cookie.
 */
export async function googleSignInAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await sameOrigin())) return { ok: false, error: "forbidden" };
  const locale = formLocale(formData.get("locale"));
  const redirectTo = safeCallbackUrl(formData.get("callbackUrl"), locale);
  (await cookies()).set("NEXT_LOCALE", locale, {
    path: "/",
    sameSite: "lax",
    maxAge: 365 * 24 * 3600,
  });
  try {
    await signIn("google", { redirectTo });
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: "oauthFailed" };
  }
  return { ok: true };
}

export async function signOutAction(formData: FormData): Promise<void> {
  if (!(await sameOrigin())) return;
  const locale = formLocale(formData.get("locale"));
  await signOut({ redirectTo: `/${locale}` });
}

/** Onboarding: display name + 15 or older (accounts created through Google). */
export async function completeOnboardingAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await sameOrigin())) return { ok: false, error: "forbidden" };
  const locale = formLocale(formData.get("locale"));
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "signInRequired" };

  const values = { displayName: text(formData, "displayName").slice(0, 40) };
  const fields: Partial<Record<Field, string>> = {};
  const name = validateDisplayName(formData.get("displayName"));
  if (!name.ok) fields.displayName = `errors.${name.error}`;
  if (formData.get("age") !== "on") fields.age = "errors.ageRequired";
  if (Object.keys(fields).length > 0 || !name.ok) return { ok: false, fields, values };

  if (!user.onboarded) {
    try {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          // A name chosen at onboarding stays; onboarding never renames.
          ...(user.displayName === null
            ? { displayName: name.name, displayNameKey: name.key }
            : {}),
          ageConfirmedAt: new Date(),
        },
      });
    } catch (error) {
      if (isDisplayNameTaken(error)) {
        return { ok: false, fields: { displayName: "errors.nameTaken" }, values };
      }
      throw error;
    }
  }
  // Already locale-prefixed (`/fr/…`): Next's own redirect, not next-intl's.
  nextRedirect(safeCallbackUrl(formData.get("callbackUrl"), locale));
}

export async function verifyEmailAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await sameOrigin())) return { ok: false, error: "forbidden" };
  const userId = await consumeVerificationToken(prisma, text(formData, "token"));
  return userId ? { ok: true, notice: "verified" } : { ok: false, error: "invalidLink" };
}

/** Takes no input (called as a form action: `useActionState` passes arguments it ignores). */
export async function resendVerificationAction(): Promise<AuthFormState> {
  const h = await sameOrigin();
  if (!h) return { ok: false, error: "forbidden" };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "signInRequired" };
  if (user.emailVerified) return { ok: false, error: "alreadyDone" };
  const verdict = await createDbRateLimiter(prisma).consume(
    rateLimitKey("verify-email", user.id),
    DB_RATE_LIMITS.verifyEmailPerUser,
  );
  if (!verdict.ok) {
    return {
      ok: false,
      error: "rateLimited",
      retryAfterSec: Math.ceil(verdict.retryAfterMs / 1000),
    };
  }
  await sendVerificationMail(user, siteOrigin(h));
  return { ok: true, notice: "verificationSent" };
}
