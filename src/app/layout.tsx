import type { ReactNode } from "react";
import { headers } from "next/headers";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import { hasLocale } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";

import { routing, runtimeDefaultLocale } from "@/i18n/routing";
import { appName } from "@/lib/server/branding";
import { appBaseUrl } from "@/lib/server/runtime-env";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";

import "./globals.css";

const GITHUB_URL = "https://github.com/1xSecret/1xSecret";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Root layout. Owns <html>/<body> and the theme provider so next-themes' no-
 * flash <script> is rendered exactly once at SSR and never re-rendered on a
 * client-side locale switch (which would otherwise trip Next.js's
 * "script tag while rendering on the client" error). The [locale] layout
 * nested below provides the i18n context and updates <html lang> on the client.
 */
export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  let locale: string;
  try {
    locale = await getLocale();
  } catch {
    locale = runtimeDefaultLocale();
  }

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-svh flex-col bg-background text-foreground">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
        {await renderJsonLd(locale)}
      </body>
    </html>
  );
}

/**
 * Site-level WebApplication JSON-LD. Rendered in the root layout (once, never
 * client-re-rendered) so its <script> never trips the client-render warning;
 * crawlers read it from the initial per-locale SSR HTML.
 */
async function renderJsonLd(locale: string) {
  const base = appBaseUrl(await headers());
  const safeLocale = hasLocale(routing.locales, locale) ? locale : "en";
  const t = await getTranslations({ locale: safeLocale, namespace: "Metadata" });
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: appName(),
    url: `${base}/${locale}`,
    description: t("description"),
    applicationCategory: "SecurityApplication",
    operatingSystem: "Any",
    browserRequirements: "Requires JavaScript and Web Crypto API",
    offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
    isAccessibleForFree: true,
    inLanguage: locale,
    license: `${GITHUB_URL}/blob/main/LICENSE`,
  };
  // next/script (not a raw <script>) so React never client-renders the tag —
  // which triggers the "script tag while rendering" error — while still
  // emitting it into the initial SSR HTML for crawlers.
  return (
    <Script
      id="jsonld-webapplication"
      type="application/ld+json"
      strategy="beforeInteractive"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
      }}
    />
  );
}
