import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import type { Locale } from "@/lib/server/config";
import { RevealSecret } from "@/components/reveal-secret";

/**
 * Reveal page. Never indexable (also enforced via X-Robots-Tag in proxy.ts
 * and the robots.txt Disallow), and rendering it never consumes the secret —
 * only the explicit reveal action does.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return {
    title: t("revealTitle"),
    robots: { index: false, follow: false },
  };
}

export default async function RevealPage({
  params,
}: {
  params: Promise<{ locale: Locale; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("RevealPage");

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10 sm:py-14">
      <h1 className="text-2xl font-bold tracking-tight text-balance sm:text-3xl">
        {t("title")}
      </h1>
      <RevealSecret id={id} />
    </div>
  );
}
