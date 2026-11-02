import { getTranslations } from "next-intl/server";

import { buttonClass } from "@/components/ui/Button";
import { Link } from "@/lib/i18n/navigation";

export default async function RoomNotFound() {
  const t = await getTranslations("room");
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10 text-center">
      <h1 className="font-display text-4xl">{t("notFound.title")}</h1>
      <p className="mt-4">{t("notFound.lead")}</p>
      <p className="mt-8">
        <Link href="/" className={buttonClass("primary")}>
          {t("notFound.home")}
        </Link>
      </p>
    </main>
  );
}
