import type { routing } from "@/lib/i18n/routing";
import type admin from "./messages/fr/admin.json";
import type auth from "./messages/fr/auth.json";
import type common from "./messages/fr/common.json";
import type conduct from "./messages/fr/conduct.json";
import type credits from "./messages/fr/credits.json";
import type game from "./messages/fr/game.json";
import type legal from "./messages/fr/legal.json";
import type lobby from "./messages/fr/lobby.json";
import type profile from "./messages/fr/profile.json";
import type room from "./messages/fr/room.json";
import type rules from "./messages/fr/rules.json";

declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
    Messages: {
      common: typeof common;
      room: typeof room;
      game: typeof game;
      auth: typeof auth;
      lobby: typeof lobby;
      profile: typeof profile;
      conduct: typeof conduct;
      admin: typeof admin;
      rules: typeof rules;
      credits: typeof credits;
      legal: typeof legal;
    };
  }
}
