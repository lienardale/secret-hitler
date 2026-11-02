import type { routing } from "@/lib/i18n/routing";
import type common from "./messages/fr/common.json";
import type game from "./messages/fr/game.json";
import type room from "./messages/fr/room.json";

declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
    Messages: { common: typeof common; room: typeof room; game: typeof game };
  }
}
