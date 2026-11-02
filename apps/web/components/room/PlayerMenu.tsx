"use client";

/**
 * The menu of another member of the room (player or spectator, in the lobby
 * and during or after a game): a "⋯" button named "Actions for <name>" that
 * opens a dialog with
 *  - mute / unmute (anyone, guests included): this browser hides their chat
 *    messages, nothing is sent (lib/room-client/mute.ts);
 *  - block and report, only when the viewer is an account and the member is
 *    not a guest (server actions in app/[locale]/salle/[code]/actions.ts).
 *
 * A native <dialog> opened with showModal() (focus kept inside, Escape and
 * the Android back gesture close it); where showModal is missing (jsdom) it
 * falls back to the `open` attribute.
 */
import {
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import type { RoomView } from "@sh/protocol";

import { blockFromRoomAction, type MemberActionError } from "@/app/[locale]/salle/[code]/actions";
import { Button, buttonClass } from "@/components/ui/Button";
import { Link } from "@/lib/i18n/navigation";
import { useMuted, useRoomActions, useRoomState } from "@/lib/room-client/store";

import { ReportForm } from "./ReportForm";

export type MemberView = RoomView["spectators"][number];

/** True when the viewer plays with an account (their own member entry is not a guest). */
export function useViewerIsAccount(): boolean {
  return useRoomState((s) => {
    const pid = s.you?.pid;
    const room = s.room;
    if (!pid || !room) return false;
    const me =
      room.players.find((m) => m.pid === pid) ?? room.spectators.find((m) => m.pid === pid);
    return me ? !me.guest : false;
  });
}

/** "muted" next to a member's name, while this browser hides their messages. */
export function MutedTag({ pid }: { pid: string }) {
  const t = useTranslations("room");
  const { muted } = useMuted();
  if (!muted.has(pid)) return null;
  return (
    <span className="ml-2 whitespace-nowrap rounded-sm border border-ink-muted px-1.5 text-xs text-ink-muted">
      {t("member.mutedTag")}
    </span>
  );
}

export function PlayerMenu({ member }: { member: MemberView }) {
  const t = useTranslations("room");
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // Back to the button once the dialog is gone (it made the page inert while open).
  useEffect(() => {
    if (open) wasOpen.current = true;
    else if (wasOpen.current) {
      wasOpen.current = false;
      trigger.current?.focus();
    }
  }, [open]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-label={t("member.open", { name: member.name })}
        onClick={() => setOpen(true)}
        data-testid="member-menu"
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-2xl leading-none text-ink-muted transition hover:bg-paper hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        <span aria-hidden>⋯</span>
      </button>
      {open && <PlayerDialog member={member} onClose={() => setOpen(false)} />}
    </>
  );
}

type View = "menu" | "report" | "sent";
type BlockState =
  | { status: "idle" }
  | { status: "done"; already: boolean }
  | { status: "error"; error: MemberActionError | "failed" };

function PlayerDialog({ member, onClose }: { member: MemberView; onClose: () => void }) {
  const t = useTranslations("room");
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState<View>("menu");
  const code = useRoomState((s) => s.room?.code ?? "");
  const canModerate = useViewerIsAccount() && !member.guest;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (typeof element.showModal === "function") {
      if (!element.open) element.showModal();
    } else {
      element.setAttribute("open", "");
    }
    return () => {
      if (typeof element.close === "function" && element.open) element.close();
    };
  }, []);

  // Each view starts at its heading (or the confirmation), so screen readers say where they are.
  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, [view]);

  function closeOnBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === dialog.current) onClose();
  }

  const titleId = `${id}-title`;
  let body: ReactNode;
  if (view === "report") {
    body = (
      <ReportForm
        member={member}
        code={code}
        titleId={titleId}
        onSent={() => setView("sent")}
        onBack={() => setView("menu")}
      />
    );
  } else if (view === "sent") {
    body = (
      <>
        <h2 id={titleId} className="font-display text-2xl">
          {t("report.title", { name: member.name })}
        </h2>
        <p data-autofocus tabIndex={-1} role="status" className="mt-3 focus:outline-none">
          {t("report.sent")}
        </p>
        <div className="mt-5 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            {t("member.close")}
          </Button>
        </div>
      </>
    );
  } else {
    body = (
      <MenuView
        member={member}
        code={code}
        canModerate={canModerate}
        titleId={titleId}
        onReport={() => setView("report")}
        onClose={onClose}
      />
    );
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      data-testid="member-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
      onClick={closeOnBackdrop}
      // Rendered inside a seat row or a chip: reset what those set on their text.
      className="m-auto w-[min(28rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto whitespace-normal rounded-lg border-2 border-ink bg-paper-raised p-0 text-left text-base font-normal text-ink shadow-xl backdrop:bg-ink/40"
    >
      <div className="p-5">{body}</div>
    </dialog>
  );
}

function MenuView({
  member,
  code,
  canModerate,
  titleId,
  onReport,
  onClose,
}: {
  member: MemberView;
  code: string;
  canModerate: boolean;
  titleId: string;
  onReport: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("room");
  const id = useId();
  const { muted, setMuted } = useMuted();
  const isMuted = muted.has(member.pid);
  const isAccount = useViewerIsAccount();
  const { reconnect } = useRoomActions();
  const [block, setBlock] = useState<BlockState>({ status: "idle" });
  const [blocking, startBlocking] = useTransition();

  function blockMember() {
    startBlocking(async () => {
      let result: Awaited<ReturnType<typeof blockFromRoomAction>>;
      try {
        result = await blockFromRoomAction(code, member.pid);
      } catch {
        setBlock({ status: "error", error: "failed" });
        return;
      }
      if (!result.ok) {
        setBlock({ status: "error", error: result.error });
        return;
      }
      setBlock({ status: "done", already: result.already });
      // A fresh ticket carries the block: the room then hides their messages from us.
      reconnect();
    });
  }

  return (
    <>
      <h2
        data-autofocus
        id={titleId}
        tabIndex={-1}
        className="font-display text-2xl break-words focus:outline-none"
      >
        {member.name}
        {member.guest && (
          <span className="ml-2 align-middle text-sm text-ink-muted">({t("member.guestTag")})</span>
        )}
        <MutedTag pid={member.pid} />
      </h2>

      <div className="mt-4 space-y-1">
        <Button
          variant="secondary"
          className="w-full"
          aria-describedby={`${id}-mute`}
          onClick={() => setMuted(member.pid, !isMuted)}
        >
          {t(isMuted ? "member.unmute" : "member.mute")}
        </Button>
        <p id={`${id}-mute`} className="text-sm text-ink-muted">
          {t("member.muteHelp")}
        </p>
      </div>

      {canModerate ? (
        <>
          <div className="mt-4 space-y-1">
            {block.status === "done" ? (
              <div role="status" className="rounded-md border border-rule bg-paper p-3">
                <p>
                  {t(block.already ? "member.alreadyBlocked" : "member.blocked", {
                    name: member.name,
                  })}
                </p>
                <p className="mt-1 text-sm text-ink-muted">
                  {t("member.unblockHint")}{" "}
                  <Link
                    href="/profil"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-4"
                  >
                    {t("member.profileLink")}
                  </Link>
                </p>
              </div>
            ) : (
              <>
                <Button
                  variant="secondary"
                  className="w-full"
                  disabled={blocking}
                  aria-describedby={`${id}-block`}
                  onClick={blockMember}
                >
                  {t("member.block", { name: member.name })}
                </Button>
                <p id={`${id}-block`} className="text-sm text-ink-muted">
                  {blocking ? t("member.pending") : t("member.blockHelp")}
                </p>
                {block.status === "error" && (
                  <p role="alert" className="text-fascist">
                    {t(`member.errors.${block.error}`)}
                  </p>
                )}
              </>
            )}
          </div>
          <div className="mt-4">
            <Button variant="danger" className="w-full" onClick={onReport}>
              {t("member.report", { name: member.name })}
            </Button>
          </div>
        </>
      ) : (
        <p className="mt-4 text-sm text-ink-muted">
          {t(isAccount ? "member.guestTarget" : "member.accountOnly")}
        </p>
      )}

      <div className="mt-5 flex justify-end">
        <button type="button" className={buttonClass("quiet")} onClick={onClose}>
          {t("member.close")}
        </button>
      </div>
    </>
  );
}
