import { notFound } from "next/navigation";

/** Catch-all: renders the locale-aware not-found page for unknown routes. */
export default function CatchAllPage() {
  notFound();
}
