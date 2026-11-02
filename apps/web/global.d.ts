import type { routing } from "@/lib/i18n/routing";
import type common from "./messages/fr/common.json";

declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
    Messages: { common: typeof common };
  }
}
