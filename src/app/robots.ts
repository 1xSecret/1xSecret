import type { MetadataRoute } from "next";
import { headers } from "next/headers";

import { appBaseUrl, indexingAllowedEnv } from "@/lib/server/runtime-env";

/**
 * Indexing is opt-in per instance (ALLOW_INDEXING). Reading request headers
 * (below) forces request-time evaluation — without it the env var and host
 * would be baked in at image build time. Secret links are excluded in every
 * configuration. The sitemap URL derives from APP_URL or the request host, so
 * it is correct even when APP_URL is unset.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const requestHeaders = await headers();

  if (!indexingAllowedEnv()) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/en/s/", "/de/s/", "/en/secrets", "/de/secrets"],
    },
    sitemap: `${appBaseUrl(requestHeaders)}/sitemap.xml`,
  };
}
