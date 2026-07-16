import { defineRouting } from "next-intl/routing";

/**
 * The build-time defaultLocale below is only a placeholder for static tooling:
 * because localePrefix is "always", it never influences link generation, and
 * the request-time redirect of unprefixed URLs uses the runtime
 * DEFAULT_LANGUAGE env var instead (see proxy.ts and request.ts).
 */
export const routing = defineRouting({
  locales: ["en", "de"],
  defaultLocale: "en",
  localePrefix: "always",
  alternateLinks: false, // hreflang is emitted via page metadata instead
});

export type AppLocale = (typeof routing.locales)[number];

export function runtimeDefaultLocale(): AppLocale {
  return process.env.DEFAULT_LANGUAGE === "de" ? "de" : "en";
}
