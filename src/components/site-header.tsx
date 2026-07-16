import { getTranslations } from "next-intl/server";
import { Lock } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { appName, brandLogoPath, isDefaultAppName } from "@/lib/server/branding";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";

export async function SiteHeader() {
  const t = await getTranslations("Header");
  const name = appName();
  const hasLogo = brandLogoPath() !== null;

  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4">
        <Link
          href="/"
          className="flex items-center gap-2 font-semibold tracking-tight"
        >
          {hasLogo ? (
            // eslint-disable-next-line @next/next/no-img-element -- operator-mounted logo served at runtime; next/image can't optimize an arbitrary runtime path
            <img
              src="/api/brand/logo"
              alt={name}
              className="h-6 w-auto max-w-40 object-contain"
            />
          ) : isDefaultAppName() ? (
            <>
              <Lock className="size-4" aria-hidden />
              <span>
                1x<span className="text-primary">Secret</span>
              </span>
            </>
          ) : (
            <>
              <Lock className="size-4" aria-hidden />
              <span>{name}</span>
            </>
          )}
        </Link>
        <nav className="flex items-center gap-1">
          <Button
            render={<Link href="/secrets" />}
            nativeButton={false}
            variant="ghost"
            size="sm"
          >
            {t("mySecrets")}
          </Button>
          <LanguageSwitcher label={t("language")} />
          <ThemeToggle
            label={t("theme")}
            labels={{
              light: t("themeLight"),
              dark: t("themeDark"),
              system: t("themeSystem"),
            }}
          />
        </nav>
      </div>
    </header>
  );
}
