import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { Locale } from "@/lib/server/config";
import { getLegalDocument, type LegalSlug } from "@/lib/server/legal";

/** Name of `named` locale, written in the reader's `display` locale. */
function localeName(named: Locale, display: Locale): string {
  return (
    new Intl.DisplayNames([display], { type: "language" }).of(named) ?? named
  );
}

/**
 * Renders an operator-provided markdown document. react-markdown emits no raw
 * HTML by default, so mounted files cannot inject script into the page.
 */
export async function LegalPageContent({
  slug,
  locale,
}: {
  slug: LegalSlug;
  locale: Locale;
}) {
  const document = await getLegalDocument(slug, locale);
  if (!document) notFound();

  const t = await getTranslations("LegalPage");

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-10 sm:py-14">
      {document.contentLocale !== locale && (
        <p className="rounded-lg border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          {t("fallbackNote", {
            locale: localeName(document.contentLocale, locale),
          })}
        </p>
      )}
      <article
        lang={document.contentLocale}
        className="prose-sm flex max-w-none flex-col gap-3 [&_a]:text-primary [&_a]:underline-offset-4 hover:[&_a]:underline [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:tracking-tight [&_h2]:mt-4 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:font-semibold [&_li]:ml-5 [&_ul]:list-disc [&_ol]:list-decimal [&_table]:text-sm"
      >
        <Markdown remarkPlugins={[remarkGfm]}>{document.content}</Markdown>
      </article>
    </div>
  );
}
