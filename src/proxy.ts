import createIntlMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";

import { routing, runtimeDefaultLocale } from "./i18n/routing";

/**
 * Request proxy (Next.js 16 successor of middleware.ts, Node.js runtime):
 *
 * 1. next-intl locale routing with the RUNTIME default locale — the env var is
 *    read per request, so one prebuilt image serves DEFAULT_LANGUAGE=de and =en
 *    deployments alike (a visitor's NEXT_LOCALE cookie still wins).
 * 2. X-Robots-Tag: indexing is opt-in per instance (ALLOW_INDEXING), and
 *    secret links are never indexable regardless of configuration. The header
 *    is authoritative at request time — unlike meta tags, it cannot be baked
 *    into prerendered HTML at image build time.
 */
export default function proxy(request: NextRequest) {
  const handleI18nRouting = createIntlMiddleware({
    ...routing,
    defaultLocale: runtimeDefaultLocale(),
  });

  const response = handleI18nRouting(request);

  const indexingAllowed = ["true", "1", "yes"].includes(
    process.env.ALLOW_INDEXING ?? "",
  );
  const isSecretPage = /^\/(en|de)\/s\//.test(request.nextUrl.pathname);
  if (!indexingAllowed || isSecretPage) {
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }

  return response;
}

export const config = {
  // Everything except API routes, Next internals and files with extensions.
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
