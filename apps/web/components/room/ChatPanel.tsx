"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { CHAT_MAX_LENGTH, type ChatMessage } from "@sh/protocol";

import { Button } from "@/components/ui/Button";
import { useMuted, useRoomActions, useRoomState } from "@/lib/room-client/store";

import { chatBlockReason } from "./chat-rules";

function MessageLine({ message, youPid }: { message: ChatMessage; youPid: string | undefined }) {
  const t = useTranslations("room");
  if (message.kind === "system") {
    return (
      <li className="text-sm italic text-ink-muted">
        {t(`chat.system.${message.key}`, message.params as Record<string, string>)}
      </li>
    );
  }
  return (
    <li className="break-words">
      <span className={`font-semibold ${message.pid === youPid ? "text-liberal" : ""}`}>
        {message.name}
      </span>{" "}
      <span>{message.text}</span>
    </li>
  );
}

export function ChatPanel({ className = "" }: { className?: string }) {
  const t = useTranslations("room");
  const id = useId();
  const chat = useRoomState((s) => s.chat);
  const you = useRoomState((s) => s.you);
  const room = useRoomState((s) => s.room);
  const view = useRoomState((s) => s.game?.view ?? null);
  const { send } = useRoomActions();
  const { muted } = useMuted();
  const [text, setText] = useState("");
  const listRef = useRef<HTMLOListElement>(null);

  // Muted members (this browser's choice): their messages are not shown, history or live.
  const shown = useMemo(
    () => (muted.size === 0 ? chat : chat.filter((m) => m.kind !== "player" || !muted.has(m.pid))),
    [chat, muted],
  );
  const hidden = chat.length - shown.length;

  // Keep the newest message in view, unless the reader scrolled up.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    if (nearBottom) list.scrollTop = list.scrollHeight;
  }, [shown]);

  const blocked = chatBlockReason(room?.status ?? "lobby", view);

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value || blocked) return;
    if (send({ t: "chat", text: value })) setText("");
  }

  return (
    <section
      aria-labelledby={`${id}-title`}
      className={`flex min-h-0 flex-col rounded-lg border-2 border-rule bg-paper-raised ${className}`}
    >
      <h2 id={`${id}-title`} className="border-b border-rule px-4 py-2 font-display text-xl">
        {t("chat.title")}
      </h2>
      {hidden > 0 && (
        <p
          data-testid="chat-hidden"
          className="border-b border-rule px-4 py-1 text-sm text-ink-muted"
        >
          {t("chat.hidden", { count: hidden })}
        </p>
      )}
      <ol
        ref={listRef}
        aria-live="polite"
        aria-relevant="additions"
        className="min-h-24 flex-1 space-y-1.5 overflow-y-auto px-4 py-3"
      >
        {shown.length === 0 ? (
          <li className="text-sm text-ink-muted">{t("chat.empty")}</li>
        ) : (
          shown.map((message) => (
            <MessageLine key={message.id} message={message} youPid={you?.pid} />
          ))
        )}
      </ol>
      {blocked ? (
        <p className="border-t border-rule px-4 py-3 text-sm text-ink-muted">
          {t(`chat.${blocked}`)}
        </p>
      ) : (
        <form onSubmit={submit} className="flex gap-2 border-t border-rule p-2">
          <label htmlFor={`${id}-input`} className="sr-only">
            {t("chat.label")}
          </label>
          <input
            id={`${id}-input`}
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={CHAT_MAX_LENGTH}
            placeholder={t("chat.placeholder")}
            autoComplete="off"
            className="min-w-0 flex-1 rounded-md border-2 border-rule bg-paper px-3 py-2 focus:border-ink focus:outline-none"
          />
          <Button type="submit" variant="secondary" disabled={text.trim() === ""}>
            {t("chat.send")}
          </Button>
        </form>
      )}
    </section>
  );
}
