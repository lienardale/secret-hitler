import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";

import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  const common = (await import(`../../messages/${locale}/common.json`)) as { default: unknown };
  return { locale, messages: { common: common.default as Record<string, unknown> } };
});
