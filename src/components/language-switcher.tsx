"use client";

import { useLocale } from "next-intl";
import { useParams } from "next/navigation";
import { Languages } from "lucide-react";

import { routing } from "@/i18n/routing";
import { usePathname, useRouter } from "@/i18n/navigation";
import { PRESERVE_RESULT_KEY } from "@/components/create-secret-form";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const LOCALE_NAMES: Record<string, string> = {
  en: "English",
  de: "Deutsch",
};

export function LanguageSwitcher({ label }: { label: string }) {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();

  function switchTo(nextLocale: (typeof routing.locales)[number]) {
    // Preserve the URL fragment across the switch. next-intl's router.replace
    // drops the hash, but the fragment carries the decryption key on the
    // reveal page (/s/[id]#v1.<key>) — losing it would make the recipient's
    // link look "corrupted". Capture it now and re-apply once the client
    // navigation to the new locale has landed (router.replace is async and
    // gives us no hash option, so we poll a bounded number of frames rather
    // than racing the navigation).
    const hash = window.location.hash;

    // On the create page, flag this as an in-place locale change so the
    // remounting form keeps its result view (the one-time link). Any other
    // navigation leaves the flag unset and resets the form.
    if (pathname === "/") {
      try {
        window.sessionStorage.setItem(PRESERVE_RESULT_KEY, "1");
      } catch {
        // storage unavailable; the result view simply resets on switch
      }
    }

    router.replace(
      // @ts-expect-error params are compatible with the current pathname
      { pathname, params },
      { locale: nextLocale },
    );
    if (!hash) return;

    // setTimeout (not requestAnimationFrame) so the restore still fires when
    // the tab is backgrounded, where rAF is paused.
    let attempts = 0;
    const restoreHash = () => {
      const onNewLocale =
        window.location.pathname === `/${nextLocale}` ||
        window.location.pathname.startsWith(`/${nextLocale}/`);
      if (onNewLocale) {
        if (window.location.hash !== hash) {
          window.history.replaceState(
            null,
            "",
            window.location.pathname + window.location.search + hash,
          );
        }
      } else if (attempts++ < 100) {
        setTimeout(restoreHash, 16);
      }
    };
    setTimeout(restoreHash, 0);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="sm" aria-label={label}>
            <Languages className="size-4" aria-hidden />
            <span className="uppercase">{locale}</span>
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        {routing.locales.map((availableLocale) => (
          <DropdownMenuItem
            key={availableLocale}
            onClick={() => switchTo(availableLocale)}
            data-active={availableLocale === locale || undefined}
          >
            {LOCALE_NAMES[availableLocale]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
