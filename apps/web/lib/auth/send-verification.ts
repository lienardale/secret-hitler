/** Sends an account its e-mail verification link, in its language. */
import "server-only";

import { getTranslations } from "next-intl/server";

import { prisma } from "@/lib/db/prisma";
import { getPathname } from "@/lib/i18n/navigation";
import type { Locale } from "@/lib/i18n/routing";
import { sendMail } from "@/lib/mail/send";

import { createVerificationToken } from "./verification";

export async function sendVerificationMail(
  user: { id: string; email: string; displayName: string | null; locale: Locale },
  origin: string,
): Promise<boolean> {
  const token = await createVerificationToken(prisma, user.id);
  const path = getPathname({ locale: user.locale, href: "/verifier-email" });
  const link = `${origin}${path}?token=${encodeURIComponent(token)}`;
  const t = await getTranslations({ locale: user.locale, namespace: "auth" });
  const result = await sendMail({
    to: user.email,
    subject: t("mail.verifySubject"),
    text: t("mail.verifyBody", { name: user.displayName ?? user.email, link }),
  });
  return result.ok;
}
