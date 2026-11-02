import { useTranslations } from "next-intl";

import { Link } from "@/lib/i18n/navigation";

/** Reports | Bans, at the top of every admin page. The current page is marked in words too. */
export function AdminNav({ current }: { current: "reports" | "bans" }) {
  const t = useTranslations("admin");
  const linkClass = (active: boolean) =>
    `rounded-md px-3 py-1.5 font-display text-lg tracking-wide underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
      active ? "bg-ink text-paper" : "border-2 border-ink"
    }`;
  return (
    <nav aria-label={t("nav.label")} className="flex flex-wrap gap-2">
      <Link
        href="/admin/signalements"
        aria-current={current === "reports" ? "page" : undefined}
        className={linkClass(current === "reports")}
      >
        {t("nav.reports")}
      </Link>
      <Link
        href="/admin/bannis"
        aria-current={current === "bans" ? "page" : undefined}
        className={linkClass(current === "bans")}
      >
        {t("nav.bans")}
      </Link>
    </nav>
  );
}
