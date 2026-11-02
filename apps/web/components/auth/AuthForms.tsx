"use client";

import { useActionState, useId } from "react";
import { useLocale, useTranslations } from "next-intl";
import { DISPLAY_NAME_MAX } from "@sh/protocol";

import {
  completeOnboardingAction,
  googleSignInAction,
  resendVerificationAction,
  signInAction,
  signUpAction,
  verifyEmailAction,
  type AuthFormState,
} from "@/app/[locale]/(auth)/actions";
import { Button } from "@/components/ui/Button";

export const inputClass =
  "w-full rounded-md border-2 border-field bg-paper px-3 py-2 text-lg focus:border-ink focus:outline-none";
const labelClass = "block font-display text-lg";

type Field = "email" | "password" | "displayName" | "age";

function fieldError(state: AuthFormState, field: Field): string | undefined {
  return state && !state.ok ? state.fields?.[field] : undefined;
}

/** What the visitor typed before a refusal (the form is reset after each action). */
function typed(state: AuthFormState, field: "email" | "displayName"): string | undefined {
  return state && !state.ok ? state.values?.[field] : undefined;
}

/** The form-level error, translated (`rateLimited` carries a wait). */
export function FormError({ state }: { state: AuthFormState }) {
  const t = useTranslations("auth");
  if (!state || state.ok || !state.error) return null;
  const message =
    state.error === "rateLimited"
      ? t("errors.rateLimited", {
          minutes: Math.max(1, Math.ceil((state.retryAfterSec ?? 60) / 60)),
        })
      : t(`errors.${state.error}` as "errors.authFailed");
  return (
    <p role="alert" className="text-fascist">
      {message}
    </p>
  );
}

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  const t = useTranslations("auth");
  if (!message) return null;
  return (
    <p id={id} className="text-sm text-fascist">
      {t(message as "errors.authFailed")}
    </p>
  );
}

function Hidden({ callbackUrl }: { callbackUrl?: string }) {
  const locale = useLocale();
  return (
    <>
      <input type="hidden" name="locale" value={locale} />
      {callbackUrl && <input type="hidden" name="callbackUrl" value={callbackUrl} />}
    </>
  );
}

function DisplayNameInput({ id, state }: { id: string; state: AuthFormState }) {
  const t = useTranslations("auth");
  const error = fieldError(state, "displayName");
  return (
    <div className="space-y-1">
      <label htmlFor={`${id}-name`} className={labelClass}>
        {t("signUp.displayName")}
      </label>
      <input
        id={`${id}-name`}
        name="displayName"
        required
        minLength={2}
        maxLength={DISPLAY_NAME_MAX}
        autoComplete="nickname"
        defaultValue={typed(state, "displayName")}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-name-error` : `${id}-name-hint`}
        className={inputClass}
      />
      <p id={`${id}-name-hint`} className="text-sm text-ink-muted">
        {t("signUp.displayNameHint")}
      </p>
      <FieldError id={`${id}-name-error`} message={error} />
    </div>
  );
}

function AgeCheckbox({ id, state }: { id: string; state: AuthFormState }) {
  const t = useTranslations("auth");
  const error = fieldError(state, "age");
  return (
    <div className="space-y-1">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          name="age"
          required
          className="mt-1 size-5 accent-ink"
          aria-describedby={error ? `${id}-age-error` : undefined}
        />
        <span>{t("signUp.age")}</span>
      </label>
      <FieldError id={`${id}-age-error`} message={error} />
    </div>
  );
}

export function SignInForm({ callbackUrl }: { callbackUrl?: string }) {
  const t = useTranslations("auth");
  const id = useId();
  const [state, action, pending] = useActionState<AuthFormState, FormData>(signInAction, null);
  return (
    <form action={action} className="space-y-4" noValidate={false}>
      <Hidden callbackUrl={callbackUrl} />
      <div className="space-y-1">
        <label htmlFor={`${id}-email`} className={labelClass}>
          {t("signIn.email")}
        </label>
        <input
          id={`${id}-email`}
          name="email"
          type="email"
          required
          autoComplete="email"
          defaultValue={typed(state, "email")}
          className={inputClass}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-password`} className={labelClass}>
          {t("signIn.password")}
        </label>
        <input
          id={`${id}-password`}
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className={inputClass}
        />
      </div>
      <FormError state={state} />
      <Button type="submit" disabled={pending} className="w-full">
        {t("signIn.submit")}
      </Button>
    </form>
  );
}

export function SignUpForm({ callbackUrl }: { callbackUrl?: string }) {
  const t = useTranslations("auth");
  const id = useId();
  const [state, action, pending] = useActionState<AuthFormState, FormData>(signUpAction, null);
  const emailError = fieldError(state, "email");
  const passwordError = fieldError(state, "password");
  return (
    <form action={action} className="space-y-4">
      <Hidden callbackUrl={callbackUrl} />
      <div className="space-y-1">
        <label htmlFor={`${id}-email`} className={labelClass}>
          {t("signUp.email")}
        </label>
        <input
          id={`${id}-email`}
          name="email"
          type="email"
          required
          autoComplete="email"
          defaultValue={typed(state, "email")}
          aria-invalid={emailError ? true : undefined}
          aria-describedby={emailError ? `${id}-email-error` : undefined}
          className={inputClass}
        />
        <FieldError id={`${id}-email-error`} message={emailError} />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-password`} className={labelClass}>
          {t("signUp.password")}
        </label>
        <input
          id={`${id}-password`}
          name="password"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
          aria-invalid={passwordError ? true : undefined}
          aria-describedby={passwordError ? `${id}-password-error` : `${id}-password-hint`}
          className={inputClass}
        />
        <p id={`${id}-password-hint`} className="text-sm text-ink-muted">
          {t("signUp.passwordHint")}
        </p>
        <FieldError id={`${id}-password-error`} message={passwordError} />
      </div>
      <DisplayNameInput id={id} state={state} />
      <AgeCheckbox id={id} state={state} />
      <p className="text-sm text-ink-muted">{t("signUp.conduct")}</p>
      <FormError state={state} />
      <Button type="submit" disabled={pending} className="w-full">
        {t("signUp.submit")}
      </Button>
    </form>
  );
}

export function GoogleButton({ callbackUrl }: { callbackUrl?: string }) {
  const t = useTranslations("auth");
  const [state, action, pending] = useActionState<AuthFormState, FormData>(
    googleSignInAction,
    null,
  );
  return (
    <form action={action} className="space-y-2">
      <Hidden callbackUrl={callbackUrl} />
      <Button type="submit" variant="secondary" disabled={pending} className="w-full">
        {t("signIn.google")}
      </Button>
      <FormError state={state} />
    </form>
  );
}

export function OnboardingForm({
  callbackUrl,
  currentName,
}: {
  callbackUrl?: string;
  currentName: string | null;
}) {
  const t = useTranslations("auth");
  const id = useId();
  const [state, action, pending] = useActionState<AuthFormState, FormData>(
    completeOnboardingAction,
    null,
  );
  return (
    <form action={action} className="space-y-4">
      <Hidden callbackUrl={callbackUrl} />
      {currentName === null ? (
        <DisplayNameInput id={id} state={state} />
      ) : (
        <input type="hidden" name="displayName" value={currentName} />
      )}
      <AgeCheckbox id={id} state={state} />
      <FormError state={state} />
      <Button type="submit" disabled={pending} className="w-full">
        {t("welcome.submit")}
      </Button>
    </form>
  );
}

export function VerifyEmailForm({ token }: { token: string }) {
  const t = useTranslations("auth");
  const [state, action, pending] = useActionState<AuthFormState, FormData>(verifyEmailAction, null);
  if (state?.ok) {
    return (
      <div role="status" className="space-y-2">
        <h2 className="font-display text-2xl">{t("verify.done")}</h2>
        <p>{t("verify.doneLead")}</p>
      </div>
    );
  }
  if (state && !state.ok && state.error === "invalidLink") {
    return (
      <div role="alert" className="space-y-2">
        <h2 className="font-display text-2xl">{t("verify.invalid")}</h2>
        <p>{t("verify.invalidLead")}</p>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <FormError state={state} />
      <Button type="submit" disabled={pending} className="w-full">
        {t("verify.submit")}
      </Button>
    </form>
  );
}

export function ResendVerificationButton({ email }: { email: string }) {
  const t = useTranslations("auth");
  const [state, action, pending] = useActionState<AuthFormState, FormData>(
    resendVerificationAction,
    null,
  );
  if (state?.ok) {
    return (
      <p role="status" className="text-sm">
        {t("verify.sent", { email })}
      </p>
    );
  }
  return (
    <form action={action} className="space-y-1">
      <Button type="submit" variant="quiet" disabled={pending}>
        {t("verify.resend")}
      </Button>
      <FormError state={state} />
    </form>
  );
}
