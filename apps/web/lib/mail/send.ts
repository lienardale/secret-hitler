/**
 * Outgoing e-mail. Two transports (MAIL_TRANSPORT):
 *
 * - `log` (default): the dev sink. Nothing is sent. Outside production the
 *   whole mail is printed to the server log; in production only the subject
 *   (a verification link is a credential). With MAIL_SINK_FILE set, each mail
 *   is also appended there as one JSON line — the e2e tests read their links
 *   from it.
 * - `resend`: the Resend HTTP API (needs RESEND_API_KEY and MAIL_FROM on a
 *   verified domain). Turned on once the site has a domain (M6).
 *
 * Failures are reported, never thrown to the visitor: an e-mail is a side
 * effect of an action that has already succeeded.
 */
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { getEnv, type Env } from "@/lib/env";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export type MailEnv = Pick<
  Env,
  "MAIL_TRANSPORT" | "RESEND_API_KEY" | "MAIL_FROM" | "MAIL_SINK_FILE"
>;

const RESEND_URL = "https://api.resend.com/emails";

export async function sendMail(
  mail: Mail,
  env: MailEnv = getEnv(),
  fetcher: typeof fetch = fetch,
): Promise<{ ok: boolean }> {
  if (env.MAIL_TRANSPORT === "resend") {
    try {
      const response = await fetcher(RESEND_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.RESEND_API_KEY ?? ""}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: env.MAIL_FROM,
          to: [mail.to],
          subject: mail.subject,
          text: mail.text,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) console.error(`[mail] resend answered ${response.status}`);
      return { ok: response.ok };
    } catch (error) {
      console.error(
        `[mail] resend failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { ok: false };
    }
  }

  if (process.env.NODE_ENV === "production") {
    console.info(`[mail] (log transport, not sent) ${mail.subject}`);
  } else {
    console.info(`[mail] (log transport, not sent) to ${mail.to}: ${mail.subject}\n${mail.text}`);
  }
  if (env.MAIL_SINK_FILE) {
    const file = resolve(env.MAIL_SINK_FILE);
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, `${JSON.stringify({ ...mail, at: new Date().toISOString() })}\n`, {
      mode: 0o600,
    });
  }
  return { ok: true };
}
