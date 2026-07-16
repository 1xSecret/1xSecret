import type { Metadata } from "next";
import { headers } from "next/headers";

import { appName } from "./branding";
import type { Locale } from "./config";
import { appBaseUrl } from "./runtime-env";

/**
 * Per-page metadata with self-referencing canonical and bidirectional
 * hreflang (en, de, x-default). Everything derives from the runtime base URL
 * (APP_URL or request host), so one image serves every domain — including
 * both official domains (1xsecret.com / 1x-geheimnis.de) and self-hosters.
 */
export async function pageMetadata({
  locale,
  path,
  title,
  description,
  index = true,
}: {
  locale: Locale;
  path: string;
  title?: string;
  description?: string;
  index?: boolean;
}): Promise<Metadata> {
  const base = appBaseUrl(await headers());
  const url = `${base}/${locale}${path}`;

  return {
    metadataBase: new URL(base),
    ...(title !== undefined && { title }),
    ...(description !== undefined && { description }),
    alternates: {
      canonical: url,
      languages: {
        en: `${base}/en${path}`,
        de: `${base}/de${path}`,
        // The unprefixed URL locale-negotiates at request time.
        "x-default": `${base}${path === "" ? "/" : path}`,
      },
    },
    openGraph: {
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description }),
      url,
      siteName: appName(),
      locale: locale === "de" ? "de_DE" : "en_US",
      type: "website",
    },
    twitter: { card: "summary_large_image" },
    ...(index ? {} : { robots: { index: false, follow: false } }),
  };
}
