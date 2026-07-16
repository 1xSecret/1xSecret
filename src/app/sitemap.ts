import type { MetadataRoute } from "next";
import { headers } from "next/headers";

import { availableLegalSlugs } from "@/lib/server/legal";
import { appBaseUrl, indexingAllowedEnv } from "@/lib/server/runtime-env";

/**
 * Marketing routes only — secret links are ephemeral and never listed.
 * Reading request headers forces per-request evaluation so ALLOW_INDEXING,
 * APP_URL / request host and the mounted legal pages reflect the running
 * instance, not the build environment.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const requestHeaders = await headers();

  if (!indexingAllowedEnv()) {
    return [];
  }

  const base = appBaseUrl(requestHeaders);
  const legalSlugs = await availableLegalSlugs();
  const paths = ["", ...legalSlugs.map((slug) => `/${slug}`)];

  return paths.map((path) => ({
    url: `${base}/en${path}`,
    alternates: {
      languages: {
        en: `${base}/en${path}`,
        de: `${base}/de${path}`,
      },
    },
  }));
}
