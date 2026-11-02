"use server";

/**
 * Moderator actions of the admin pages: ban (from a report or by display
 * name), lift a ban, force a rename, dismiss a report, add a note. Thin: the
 * rules live in lib/moderation/admin.ts.
 *
 * Order in each: same origin → moderator from the session (never from the
 * form) → the data function → `refresh()` so the page shows the change.
 * Expected failures come back as `admin.errors.*` keys, never thrown, with
 * what was typed (`values`) so the form is filled again after React resets it
 * (`.debug/007`).
 */
import { refresh } from "next/cache";
import { headers } from "next/headers";

import { prisma } from "@/lib/db/prisma";
import { moderatorForAction, type ModeratorUser } from "@/lib/moderation/access";
import {
  addNote,
  banUser,
  dismissReport,
  findUserByName,
  forceRename,
  unbanUser,
  type BanError,
  type DismissError,
  type ForceRenameError,
  type LiveOutcome,
  type NoteError,
  type UnbanError,
} from "@/lib/moderation/admin";
import { isSameOrigin } from "@/lib/security/origin";

export type AdminError =
  | "signInRequired"
  | "playerNotFound"
  | BanError
  | UnbanError
  | ForceRenameError
  | DismissError
  | NoteError;

/** Text fields sent back on a refusal. */
export interface AdminValues {
  name?: string;
  reason?: string;
  note?: string;
  duration?: string;
}

/** How many live rooms the Worker applied the action to, or that it could not be reached. */
export type LiveSummary = { reached: true; count: number } | { reached: false };

export type AdminState =
  | null
  | {
      ok: true;
      notice: "banned";
      name: string;
      /** Epoch ms; null: permanent. */
      expiresAt: number | null;
      live: LiveSummary;
    }
  | { ok: true; notice: "renamed"; from: string; to: string; live: LiveSummary }
  | { ok: true; notice: "dismissed" | "noted" }
  | { ok: true; notice: "unbanned"; name: string }
  | { ok: false; error: AdminError; values?: AdminValues };

/** Longest text kept from a field (the data functions refuse anything over their limits). */
const MAX_INPUT = 4000;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.slice(0, MAX_INPUT) : "";
}

function summary(live: LiveOutcome): LiveSummary {
  return live.reached ? { reached: true, count: live.applied.length } : { reached: false };
}

/** The moderator sending a same-origin request, or the refusal to return. */
async function caller(): Promise<{ moderator: ModeratorUser } | { error: AdminError }> {
  if (!isSameOrigin(await headers())) return { error: "forbidden" };
  const verdict = await moderatorForAction();
  if (!verdict.ok) return { error: verdict.error };
  return { moderator: verdict.moderator };
}

/** The "Ban the player" form of a report (or any form naming the account by id). */
export async function banAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const values: AdminValues = {
    reason: text(formData, "reason"),
    note: text(formData, "note"),
    duration: text(formData, "duration"),
  };
  const who = await caller();
  if ("error" in who) return { ok: false, error: who.error, values };
  const result = await banUser(prisma, {
    moderator: who.moderator,
    userId: text(formData, "userId"),
    reportId: text(formData, "reportId") || undefined,
    reason: values.reason ?? "",
    note: values.note,
    duration: values.duration ?? "",
  });
  if (!result.ok) return { ok: false, error: result.error, values };
  refresh();
  return {
    ok: true,
    notice: "banned",
    name: result.name ?? "",
    expiresAt: result.expiresAt?.getTime() ?? null,
    live: summary(result.live),
  };
}

/** "Ban by display name" on the bans page, for notices that arrive by e-mail. */
export async function banByNameAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const values: AdminValues = {
    name: text(formData, "name"),
    reason: text(formData, "reason"),
    note: text(formData, "note"),
    duration: text(formData, "duration"),
  };
  const who = await caller();
  if ("error" in who) return { ok: false, error: who.error, values };
  const user = await findUserByName(prisma, values.name ?? "");
  if (!user) return { ok: false, error: "playerNotFound", values };
  const result = await banUser(prisma, {
    moderator: who.moderator,
    userId: user.id,
    reason: values.reason ?? "",
    note: values.note,
    duration: values.duration ?? "",
  });
  if (!result.ok) return { ok: false, error: result.error, values };
  refresh();
  return {
    ok: true,
    notice: "banned",
    name: result.name ?? user.displayName,
    expiresAt: result.expiresAt?.getTime() ?? null,
    live: summary(result.live),
  };
}

export async function unbanAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const values: AdminValues = { note: text(formData, "note") };
  const who = await caller();
  if ("error" in who) return { ok: false, error: who.error, values };
  const result = await unbanUser(prisma, {
    moderator: who.moderator,
    banId: text(formData, "banId"),
    note: values.note,
  });
  if (!result.ok) return { ok: false, error: result.error, values };
  refresh();
  return { ok: true, notice: "unbanned", name: result.name ?? "" };
}

export async function forceRenameAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const values: AdminValues = { note: text(formData, "note") };
  const who = await caller();
  if ("error" in who) return { ok: false, error: who.error, values };
  const result = await forceRename(prisma, {
    moderator: who.moderator,
    userId: text(formData, "userId"),
    reportId: text(formData, "reportId") || undefined,
    note: values.note,
  });
  if (!result.ok) return { ok: false, error: result.error, values };
  refresh();
  return {
    ok: true,
    notice: "renamed",
    from: result.from,
    to: result.to,
    live: summary(result.live),
  };
}

export async function dismissAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const values: AdminValues = { note: text(formData, "note") };
  const who = await caller();
  if ("error" in who) return { ok: false, error: who.error, values };
  const result = await dismissReport(prisma, {
    moderator: who.moderator,
    reportId: text(formData, "reportId"),
    note: values.note,
  });
  if (!result.ok) return { ok: false, error: result.error, values };
  refresh();
  return { ok: true, notice: "dismissed" };
}

export async function noteAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const values: AdminValues = { note: text(formData, "note") };
  const who = await caller();
  if ("error" in who) return { ok: false, error: who.error, values };
  const result = await addNote(prisma, {
    moderator: who.moderator,
    reportId: text(formData, "reportId") || undefined,
    userId: text(formData, "userId") || undefined,
    note: values.note ?? "",
  });
  if (!result.ok) return { ok: false, error: result.error, values };
  refresh();
  return { ok: true, notice: "noted" };
}
