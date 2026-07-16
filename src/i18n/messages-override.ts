import { readFile } from "node:fs/promises";
import path from "node:path";

import { messagesOverrideDir } from "@/lib/server/branding";

type MessageTree = { [key: string]: string | MessageTree };

function isPlainObject(value: unknown): value is MessageTree {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value)
  );
}

/** Recursively merge `override` onto `base`; override wins on scalar keys. */
function deepMerge(base: MessageTree, override: MessageTree): MessageTree {
  const result: MessageTree = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = result[key];
    if (isPlainObject(value) && isPlainObject(existing)) {
      result[key] = deepMerge(existing, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Apply operator message overrides. When MESSAGES_OVERRIDE_DIR is set and
 * contains `<locale>.json`, its (partial) keys are deep-merged over the
 * built-in messages — so a self-hoster can retitle the hero, replace the FAQ,
 * or change any single string without forking. Malformed/missing files are
 * ignored (the built-in messages are used).
 */
export async function applyMessageOverrides(
  locale: string,
  base: MessageTree,
): Promise<MessageTree> {
  const dir = messagesOverrideDir();
  if (!dir) return base;
  try {
    const raw = await readFile(path.join(dir, `${locale}.json`), "utf8");
    const override = JSON.parse(raw) as unknown;
    if (!isPlainObject(override)) return base;
    return deepMerge(base, override);
  } catch {
    return base;
  }
}
