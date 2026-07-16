import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  Archive,
  Braces,
  Eye,
  KeyRound,
  Lock,
  Network,
  Send,
} from "lucide-react";

import type { Locale } from "@/lib/server/config";
import { appName, isDefaultAppName, landingMode } from "@/lib/server/branding";
import { pageMetadata } from "@/lib/server/seo";
import { CreateSecretForm } from "@/components/create-secret-form";
import { Card, CardContent } from "@/components/ui/card";

const GITHUB_URL = "https://github.com/1xSecret/1xSecret";
const SECURITY_DOC_URL = `${GITHUB_URL}/blob/main/docs/SECURITY.md`;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return pageMetadata({
    locale,
    path: "",
    // A rebranded instance uses its plain name as the home title; the default
    // instance keeps the full marketing title. Either can be overridden via
    // MESSAGES_OVERRIDE_DIR (Metadata.title).
    title: isDefaultAppName() ? t("title") : appName(),
    description: t("description"),
  });
}

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("HomePage");
  const minimal = landingMode() === "minimal";

  const howSteps = [
    { icon: Lock, title: t("how1Title"), text: t("how1Text") },
    { icon: Send, title: t("how2Title"), text: t("how2Text") },
    { icon: Eye, title: t("how3Title"), text: t("how3Text") },
  ];

  const useCases = [
    { icon: KeyRound, title: t("useCase1Title"), text: t("useCase1Text") },
    { icon: Braces, title: t("useCase2Title"), text: t("useCase2Text") },
    { icon: Network, title: t("useCase3Title"), text: t("useCase3Text") },
    { icon: Archive, title: t("useCase4Title"), text: t("useCase4Text") },
  ];

  const faqIndices = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-16 px-4 py-10 sm:py-14">
      {/* Hero: the tool itself, above the fold. In minimal mode the headline
          and subtext are neutral (no marketing) and the sections below are
          hidden entirely. */}
      <section className="flex flex-col gap-8">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            {minimal ? t("minimalTitle") : t("heroTitle")}
          </h1>
          <p className="text-muted-foreground text-balance">
            {minimal ? t("minimalSubtitle") : t("heroSubtitle")}
          </p>
        </div>
        <div className="mx-auto w-full max-w-2xl">
          <CreateSecretForm />
        </div>
      </section>

      {!minimal && (
        <>
          <section aria-labelledby="how-title" className="flex flex-col gap-6">
        <h2 id="how-title" className="text-2xl font-semibold tracking-tight">
          {t("howTitle")}
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {howSteps.map((step, index) => (
            <Card key={step.title}>
              <CardContent className="flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                    {index + 1}
                  </span>
                  <step.icon className="size-5 text-primary" aria-hidden />
                </div>
                <h3 className="font-semibold">{step.title}</h3>
                <p className="text-sm text-muted-foreground">{step.text}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="why-title" className="flex flex-col gap-4">
        <h2 id="why-title" className="text-2xl font-semibold tracking-tight">
          {t("whyTitle")}
        </h2>
        <div className="grid gap-4 text-muted-foreground sm:grid-cols-2">
          <p>{t("whyText1")}</p>
          <p>{t("whyText2")}</p>
        </div>
      </section>

      <section
        aria-labelledby="security-title"
        className="flex flex-col gap-4 rounded-xl border bg-muted/30 p-6"
      >
        <h2
          id="security-title"
          className="text-2xl font-semibold tracking-tight"
        >
          {t("securityTitle")}
        </h2>
        <div className="flex flex-col gap-3 text-muted-foreground">
          <p>{t("securityText1")}</p>
          <p>{t("securityText2")}</p>
          <p>{t("securityText3")}</p>
        </div>
        <a
          href={SECURITY_DOC_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-primary hover:underline"
        >
          {t("securityLink")} →
        </a>
      </section>

      <section aria-labelledby="use-cases-title" className="flex flex-col gap-6">
        <h2
          id="use-cases-title"
          className="text-2xl font-semibold tracking-tight"
        >
          {t("useCasesTitle")}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {useCases.map((useCase) => (
            <Card key={useCase.title}>
              <CardContent className="flex flex-col gap-2">
                <useCase.icon className="size-5 text-primary" aria-hidden />
                <h3 className="font-semibold">{useCase.title}</h3>
                <p className="text-sm text-muted-foreground">{useCase.text}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="selfhost-title" className="flex flex-col gap-4">
        <h2
          id="selfhost-title"
          className="text-2xl font-semibold tracking-tight"
        >
          {t("selfHostTitle")}
        </h2>
        <div className="flex flex-col gap-3 text-muted-foreground">
          <p>{t("selfHostText1")}</p>
          <p>{t("selfHostText2")}</p>
        </div>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-primary hover:underline"
        >
          {t("selfHostCta")} →
        </a>
      </section>

      {/* FAQ as plain HTML — visible to crawlers and answer engines. */}
      <section aria-labelledby="faq-title" className="flex flex-col gap-6">
        <h2 id="faq-title" className="text-2xl font-semibold tracking-tight">
          {t("faqTitle")}
        </h2>
        <div className="flex flex-col divide-y">
          {faqIndices.map((index) => (
            <div key={index} className="flex flex-col gap-2 py-4">
              <h3 className="font-semibold">
                {t(`faq${index}Q` as Parameters<typeof t>[0])}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t(`faq${index}A` as Parameters<typeof t>[0])}
              </p>
            </div>
          ))}
        </div>
      </section>
        </>
      )}
    </div>
  );
}
