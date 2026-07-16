/**
 * The creator's private history, stored exclusively in localStorage.
 * Contains ONLY references (id, label, timestamps) — never keys, passwords or
 * plaintext. Labels never leave the device.
 */

const STORAGE_KEY = "1xsecret.history.v1";
const MAX_ENTRIES = 200;

export interface HistoryEntry {
  id: string;
  label: string;
  createdAt: string;
  expiresAt: string;
  hasPassword: boolean;
}

function readAll(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is HistoryEntry =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as HistoryEntry).id === "string",
    );
  } catch {
    return [];
  }
}

function writeAll(entries: HistoryEntry[]): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(entries.slice(0, MAX_ENTRIES)),
    );
  } catch {
    // Storage full or unavailable — history is best-effort.
  }
}

export function listHistory(): HistoryEntry[] {
  return readAll();
}

export function addHistoryEntry(entry: HistoryEntry): void {
  writeAll([entry, ...readAll().filter((e) => e.id !== entry.id)]);
}

export function updateHistoryLabel(id: string, label: string): void {
  writeAll(
    readAll().map((entry) => (entry.id === id ? { ...entry, label } : entry)),
  );
}

export function removeHistoryEntry(id: string): void {
  writeAll(readAll().filter((entry) => entry.id !== id));
}
