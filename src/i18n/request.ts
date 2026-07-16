import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";

import { applyMessageOverrides } from "./messages-override";
import { routing, runtimeDefaultLocale } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : runtimeDefaultLocale();

  const base = (await import(`../../messages/${locale}.json`)).default;

  return {
    locale,
    messages: await applyMessageOverrides(locale, base),
  };
});
