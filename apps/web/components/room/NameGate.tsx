"use client";

import { useRouter } from "@/lib/i18n/navigation";

import { GuestNameForm } from "./GuestNameForm";

/** Shown by the room page to a visitor without a guest cookie; re-renders the page once named. */
export function NameGate() {
  const router = useRouter();
  return <GuestNameForm onSaved={() => router.refresh()} />;
}
