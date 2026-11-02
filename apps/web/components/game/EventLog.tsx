"use client";

import type { GameEvent } from "@sh/engine";
import { useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { PrivateIcon } from "./art";
import { describeEvent, type LogLine } from "./log-text";
import type { SeatNames } from "./names";

const TONE: Record<NonNullable<LogLine["tone"]>, string> = {
  liberal: "border-liberal",
  fascist: "border-fascist",
  danger: "border-fascist",
};

/**
 * The game log, oldest first, scrolled to the newest line. New lines are
 * announced politely to screen readers (the first batch on mount is not).
 */
export function EventLog({ log, names }: { log: readonly GameEvent[]; names: SeatNames }) {
  const t = useTranslations("game");
  const headingId = useId();
  const listRef = useRef<HTMLOListElement>(null);
  const lines = useMemo(
    () =>
      log.flatMap((event, index) => {
        const line = describeEvent(event, names, t);
        return line ? [{ ...line, index }] : [];
      }),
    [log, names, t],
  );

  // Announce only what arrived since the last render (storing the previous length in state).
  const [seen, setSeen] = useState(log.length);
  const [announcement, setAnnouncement] = useState("");
  if (seen !== log.length) {
    setSeen(log.length);
    setAnnouncement(
      log.length > seen
        ? log
            .slice(seen)
            .map((event) => describeEvent(event, names, t))
            .filter((line) => line !== null && !line.round)
            .map((line) => line?.text)
            .join(" ")
        : "",
    );
  }

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [lines.length]);

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-xl border-2 border-rule bg-paper-raised p-3 shadow-sm"
    >
      <h2 id={headingId} className="font-display text-lg tracking-wide">
        {t("log.heading")}
      </h2>
      {lines.length === 0 ? (
        <p className="mt-1 text-sm text-ink-muted">{t("log.empty")}</p>
      ) : (
        <ol
          ref={listRef}
          tabIndex={0}
          aria-labelledby={headingId}
          className="mt-2 max-h-72 space-y-1 overflow-y-auto pr-1 text-sm focus-visible:outline-2 focus-visible:outline-ink xl:max-h-[26rem]"
        >
          {lines.map((line) =>
            line.round ? (
              <li
                key={line.index}
                className="flex items-center gap-2 pt-2 font-display text-xs tracking-wide text-ink-muted uppercase first:pt-0"
              >
                <span aria-hidden className="h-px flex-1 bg-rule" />
                <span>{line.text}</span>
                <span aria-hidden className="h-px flex-1 bg-rule" />
              </li>
            ) : (
              <li
                key={line.index}
                className={`border-l-2 pl-2 leading-snug ${line.tone ? TONE[line.tone] : "border-transparent"} ${line.tone === "danger" ? "font-medium" : ""}`}
              >
                {line.private ? (
                  <span className="mr-1 inline-flex items-center gap-0.5 rounded-sm bg-ink px-1 align-[0.1em] text-[0.6rem] tracking-wide text-paper uppercase">
                    <PrivateIcon className="size-2.5" />
                    {t("log.private")}
                  </span>
                ) : null}
                {line.text}
                {line.detail ? (
                  <span className="block text-xs text-ink-muted">{line.detail}</span>
                ) : null}
              </li>
            ),
          )}
        </ol>
      )}
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </section>
  );
}
