import { readFile } from "node:fs/promises";
import path from "node:path";

import type { Locale } from "./config";
import { defaultLanguageEnv, legalDirEnv } from "./runtime-env";

/**
 * Operator-provided legal pages. Markdown files are mounted into LEGAL_DIR:
 *
 *   legal-notice-en.md, legal-notice-de.md   -> /{locale}/legal-notice
 *   tos-en.md,          tos-de.md            -> /{locale}/terms
 *   privacy-en.md,      privacy-de.md        -> /{locale}/privacy
 *
 * A page (route + footer link) exists iff the file for the instance's DEFAULT
 * language exists. Missing translations fall back to the default-language
 * file, with a note about the displayed language. Each page is optional.
 */

export const LEGAL_SLUGS = ["legal-notice", "terms", "privacy"] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];

const FILE_PREFIX: Record<LegalSlug, string> = {
  "legal-notice": "legal-notice",
  terms: "tos",
  privacy: "privacy",
};

async function readLegalFile(
  slug: LegalSlug,
  locale: Locale,
): Promise<string | null> {
  const filename = `${FILE_PREFIX[slug]}-${locale}.md`;
  const filePath = path.join(legalDirEnv(), filename);
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

export interface LegalDocument {
  content: string;
  /** Locale the content is actually in (fallback may differ from requested). */
  contentLocale: Locale;
}

export async function getLegalDocument(
  slug: LegalSlug,
  locale: Locale,
): Promise<LegalDocument | null> {
  const defaultLocale = defaultLanguageEnv();

  // The default-language file controls whether the page exists at all.
  const defaultContent = await readLegalFile(slug, defaultLocale);
  if (defaultContent === null) return null;

  if (locale !== defaultLocale) {
    const translated = await readLegalFile(slug, locale);
    if (translated !== null) {
      return { content: translated, contentLocale: locale };
    }
  }
  return { content: defaultContent, contentLocale: defaultLocale };
}

export async function availableLegalSlugs(): Promise<LegalSlug[]> {
  const defaultLocale = defaultLanguageEnv();
  const results = await Promise.all(
    LEGAL_SLUGS.map(async (slug) =>
      (await readLegalFile(slug, defaultLocale)) !== null ? slug : null,
    ),
  );
  return results.filter((slug): slug is LegalSlug => slug !== null);
}
