import type { Metadata, Viewport } from "next";
import { Germania_One, Jost } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ServiceWorker } from "@/components/pwa/ServiceWorker";
import { routing } from "@/lib/i18n/routing";
import { APPLE_TOUCH_ICON, PNG_FAVICON, appIconUrl } from "@/lib/pwa/icons";

import "@/styles/globals.css";

const display = Germania_One({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});
const body = Jost({ subsets: ["latin"], variable: "--font-body", display: "swap" });

interface LocaleLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export function generateStaticParams(): Array<{ locale: string }> {
  return routing.locales.map((locale) => ({ locale }));
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3e3c3" },
    { media: "(prefers-color-scheme: dark)", color: "#1d1a17" },
  ],
};

export async function generateMetadata({ params }: LocaleLayoutProps): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "common" });
  return {
    title: { default: t("site.name"), template: `%s · ${t("site.name")}` },
    description: t("site.description"),
    applicationName: t("site.name"),
    // Installable web app (app/manifest.ts, public/sw.js). Icons are listed here
    // because the PNGs are not file-convention icons (see app/app-icons/[file]/route.tsx).
    manifest: "/manifest.webmanifest",
    icons: {
      icon: [
        { url: "/icon.svg", type: "image/svg+xml" },
        { url: appIconUrl(PNG_FAVICON), type: "image/png", sizes: sizes(PNG_FAVICON) },
      ],
      apple: [
        { url: appIconUrl(APPLE_TOUCH_ICON), type: "image/png", sizes: sizes(APPLE_TOUCH_ICON) },
      ],
    },
    appleWebApp: { capable: true, title: t("site.name"), statusBarStyle: "default" },
  };
}

function sizes(icon: { size: number }): string {
  return `${icon.size}x${icon.size}`;
}

/** Root layout of every page (there is no app/layout.tsx). */
export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <html lang={locale} className={`${display.variable} ${body.variable}`}>
      <body className="min-h-dvh bg-paper text-ink antialiased">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
