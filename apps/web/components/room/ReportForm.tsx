"use client";

/**
 * Reporting a member to the moderators: a reason, optional details, and what
 * the moderators receive with it. Submitted with `reportPlayerAction`; the
 * inputs are controlled and the form is never reset, so a refusal keeps what
 * was typed (`.debug/007`).
 */
import { useId, useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { REPORT_DETAILS_MAX, REPORT_EVIDENCE_CHAT, REPORT_REASONS } from "@sh/protocol";

import { reportPlayerAction, type MemberActionError } from "@/app/[locale]/salle/[code]/actions";
import { Button, buttonClass } from "@/components/ui/Button";
import { Link } from "@/lib/i18n/navigation";

import type { MemberView } from "./PlayerMenu";

type FormError = MemberActionError | "failed" | "reasonRequired";

export function ReportForm({
  member,
  code,
  titleId,
  onSent,
  onBack,
}: {
  member: MemberView;
  code: string;
  titleId: string;
  onSent: () => void;
  onBack: () => void;
}) {
  const t = useTranslations("room");
  const id = useId();
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [error, setError] = useState<FormError | null>(null);
  const [pending, startSending] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (!reason) {
      setError("reasonRequired");
      event.currentTarget.querySelector<HTMLInputElement>('input[type="radio"]')?.focus();
      return;
    }
    setError(null);
    startSending(async () => {
      try {
        const result = await reportPlayerAction(code, member.pid, reason, details);
        if (result.ok) onSent();
        else setError(result.error);
      } catch {
        setError("failed");
      }
    });
  }

  const errorText =
    error === null
      ? null
      : error === "reasonRequired"
        ? t("report.reasonRequired")
        : t(`member.errors.${error}`);

  return (
    <form onSubmit={submit} noValidate aria-busy={pending || undefined}>
      <h2
        data-autofocus
        id={titleId}
        tabIndex={-1}
        className="font-display text-2xl break-words focus:outline-none"
      >
        {t("report.title", { name: member.name })}
      </h2>

      <fieldset
        className="mt-4"
        aria-describedby={error === "reasonRequired" ? `${id}-error` : undefined}
      >
        <legend className="font-display text-lg">{t("report.reason")}</legend>
        <div className="mt-1 space-y-1">
          {REPORT_REASONS.map((value) => (
            <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3">
              <input
                type="radio"
                name={`${id}-reason`}
                value={value}
                checked={reason === value}
                onChange={() => {
                  setReason(value);
                  if (error === "reasonRequired") setError(null);
                }}
                className="size-5 accent-ink"
              />
              <span>{t(`report.reasons.${value}`)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label htmlFor={`${id}-details`} className="mt-4 block font-display text-lg">
        {t("report.details")}
      </label>
      <textarea
        id={`${id}-details`}
        value={details}
        onChange={(event) => setDetails(event.target.value)}
        maxLength={REPORT_DETAILS_MAX}
        rows={3}
        aria-describedby={`${id}-details-hint`}
        className="mt-1 w-full rounded-md border-2 border-field bg-paper px-3 py-2 focus:border-ink focus:outline-none"
      />
      <p id={`${id}-details-hint`} className="text-sm text-ink-muted">
        {t("report.detailsHint", { max: REPORT_DETAILS_MAX })}
      </p>

      <p className="mt-4 text-sm">
        {t("report.evidence", { count: REPORT_EVIDENCE_CHAT })}{" "}
        <Link
          href="/conduite"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-4"
        >
          {t("report.conduct")}
        </Link>
      </p>

      {errorText && (
        <p id={`${id}-error`} role="alert" className="mt-3 text-fascist">
          {errorText}
        </p>
      )}

      <div className="mt-5 flex flex-wrap justify-end gap-3">
        <button type="button" className={buttonClass("quiet")} onClick={onBack}>
          {t("report.back")}
        </button>
        <Button type="submit" variant="danger" disabled={pending}>
          {t("report.submit")}
        </Button>
      </div>
    </form>
  );
}
