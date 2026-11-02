"use client";

import { useTranslations } from "next-intl";

import { ChaosIcon, WarningIcon } from "./art";
import type { VoteWarning } from "./status";

/**
 * What is at stake in this vote (icon + text, never colour alone): Hitler in
 * the Hitler zone, or chaos if the vote fails. Not a live region: the vote
 * itself is announced, and these lines are read with the panel or banner.
 */
export function VoteWarnings({
  warnings,
  className = "",
}: {
  warnings: readonly VoteWarning[];
  className?: string;
}) {
  const t = useTranslations("game");
  if (warnings.length === 0) return null;
  return (
    <ul aria-label={t("warning.label")} className={`space-y-1 ${className}`}>
      {warnings.map((warning) => (
        <li
          key={warning}
          data-warning={warning}
          className="flex items-start gap-1.5 rounded-md border-l-4 border-fascist bg-paper px-2 py-1 text-sm leading-snug"
        >
          {warning === "chaos" ? (
            <ChaosIcon className="mt-0.5 size-4 shrink-0 text-fascist" />
          ) : (
            <WarningIcon className="mt-0.5 size-4 shrink-0 text-fascist" />
          )}
          <span>{t(`warning.${warning}`)}</span>
        </li>
      ))}
    </ul>
  );
}
