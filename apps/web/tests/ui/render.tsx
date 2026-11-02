/** Renders a component with the French or English catalogues, like the app does. */
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";

import enCommon from "../../messages/en/common.json";
import enGame from "../../messages/en/game.json";
import enRoom from "../../messages/en/room.json";
import frCommon from "../../messages/fr/common.json";
import frGame from "../../messages/fr/game.json";
import frRoom from "../../messages/fr/room.json";

const MESSAGES = {
  fr: { common: frCommon, room: frRoom, game: frGame },
  en: { common: enCommon, room: enRoom, game: enGame },
};

export function renderWithIntl(ui: ReactElement, locale: "fr" | "en" = "fr") {
  return render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="Europe/Paris">
      {ui}
    </NextIntlClientProvider>,
  );
}
