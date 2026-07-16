/**
 * Client-side generator for retrieval passwords ("Generate" button).
 * Alphabet excludes visually ambiguous characters (0/O, 1/l/I) so the password
 * survives being read aloud or retyped from paper.
 */

const ALPHABET =
  "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789-_!?*+#";

export const GENERATED_PASSWORD_LENGTH = 20;

export function generatePassword(
  length: number = GENERATED_PASSWORD_LENGTH,
): string {
  const chars: string[] = [];
  // Rejection sampling keeps the distribution uniform across the alphabet.
  const limit = 256 - (256 % ALPHABET.length);
  while (chars.length < length) {
    const buf = new Uint8Array(length * 2);
    crypto.getRandomValues(buf);
    for (const byte of buf) {
      if (byte < limit && chars.length < length) {
        chars.push(ALPHABET[byte % ALPHABET.length]);
      }
    }
  }
  return chars.join("");
}
