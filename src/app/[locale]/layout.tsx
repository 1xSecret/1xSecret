import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { routing } from "@/i18n/routing";
import { appName, isDefaultAppName } from "@/lib/server/branding";
import { HtmlLangSync } from "@/components/html-lang-sync";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: requested } = await params;
  const locale = hasLocale(routing.locales, requested) ? requested : "en";
  const t = await getTranslations({ locale, namespace: "Metadata" });
  const name = appName();
  return {
    // Default app name keeps the full marketing title; a rebranded instance
    // defaults to its plain name (and can still override Metadata.* via
    // MESSAGES_OVERRIDE_DIR).
    title: {
      default: isDefaultAppName() ? t("title") : name,
      template: `%s | ${name}`,
    },
    description: t("description"),
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  // Rendering depends on runtime operator configuration (legal pages, APP_URL,
  // default language), so this tree is always rendered per request.
  await connection();

  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  return (
    <NextIntlClientProvider>
      <HtmlLangSync locale={locale} />
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </NextIntlClientProvider>
  );
}
