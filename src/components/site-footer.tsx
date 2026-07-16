import { getLocale, getTranslations } from "next-intl/server";
import { ShieldCheck } from "lucide-react";

import { Link } from "@/i18n/navigation";
import {
  showSourceLink,
  sourceUrl,
  UPSTREAM_PROJECT_NAME,
} from "@/lib/server/branding";
import { availableLegalSlugs } from "@/lib/server/legal";

export async function SiteFooter() {
  const t = await getTranslations("Footer");
  const locale = await getLocale();
  const legalSlugs = await availableLegalSlugs();
  const source = sourceUrl();

  return (
    <footer className="border-t">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2">
          <ShieldCheck className="size-4 shrink-0" aria-hidden />
          {t("tagline")}
        </p>
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {showSourceLink() && (
            <a
              href={source}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground"
            >
              {t("github")}
            </a>
          )}
          {legalSlugs.includes("legal-notice") && (
            <Link href="/legal-notice" className="hover:text-foreground">
              {t("legalNotice")}
            </Link>
          )}
          {legalSlugs.includes("terms") && (
            <Link href="/terms" className="hover:text-foreground">
              {t("terms")}
            </Link>
          )}
          {legalSlugs.includes("privacy") && (
            <Link href="/privacy" className="hover:text-foreground">
              {t("privacy")}
            </Link>
          )}
          <span aria-hidden className="hidden sm:inline">
            ·
          </span>
          {/* Always present: attribution to the upstream open-source project. */}
          <span lang={locale}>
            {t("basedOn")}{" "}
            <a
              href={source}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground"
            >
              {UPSTREAM_PROJECT_NAME}
            </a>
          </span>
        </nav>
      </div>
    </footer>
  );
}
