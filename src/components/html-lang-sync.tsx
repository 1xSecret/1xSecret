"use client";

import { useEffect } from "react";

/**
 * Keeps <html lang> in sync with the active locale. The <html> element lives
 * in the root layout (so the theme provider's no-flash script is rendered once
 * and never re-rendered on a client-side locale switch); this effect updates
 * the lang attribute when the locale changes without a full reload.
 */
export function HtmlLangSync({ locale }: { locale: string }) {
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return null;
}
