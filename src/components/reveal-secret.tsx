"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Eye,
  EyeOff,
  Flame,
  Loader2,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";

import { api, ApiError } from "@/lib/client/api";
import {
  InvalidFragmentError,
  parseRevealFragment,
  revealFlow,
} from "@/lib/client/flows";
import { Link } from "@/i18n/navigation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyButton } from "@/components/copy-button";

type ViewState =
  | { kind: "checking" }
  | { kind: "ready"; passwordProtected: boolean }
  | { kind: "revealing"; passwordProtected: boolean }
  | { kind: "revealed"; plaintext: string }
  | { kind: "restricted" }
  | { kind: "unavailable" }
  | { kind: "invalid-link" };

export function RevealSecret({ id }: { id: string }) {
  const t = useTranslations("RevealPage");
  const [state, setState] = useState<ViewState>({ kind: "checking" });
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Captured only after a successful reveal scrubs the fragment; before that we
  // always read window.location.hash live, so a transient hash loss during a
  // locale switch (the language switcher restores it a frame later) cannot make
  // an available secret look "corrupted".
  const scrubbedHashRef = useRef("");

  function currentHash(): string {
    return scrubbedHashRef.current || window.location.hash;
  }

  useEffect(() => {
    let cancelled = false;

    // A locale switch briefly clears the URL fragment before the language
    // switcher restores it, so a single read can transiently miss the key.
    // Poll for a parseable fragment for a short grace period before concluding
    // the link is corrupted; a genuinely keyless link just resolves ~0.6s
    // slower.
    async function resolveFragment() {
      for (let i = 0; i < 15; i++) {
        try {
          return parseRevealFragment(currentHash());
        } catch {
          await new Promise((r) => setTimeout(r, 40));
        }
      }
      return null;
    }

    (async () => {
      const [result, fragment] = await Promise.all([
        api.getRevealStatus(id).catch(() => null),
        resolveFragment(),
      ]);
      if (cancelled) return;

      if (!fragment) {
        setState({ kind: "invalid-link" });
        return;
      }
      if (!result || result.status === "unavailable") {
        setState({ kind: "unavailable" });
      } else if (result.status === "restricted") {
        setState({ kind: "restricted" });
      } else {
        setState({ kind: "ready", passwordProtected: fragment.passwordProtected });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  async function reveal(passwordProtected: boolean) {
    setError(null);
    // Snapshot the fragment before the reveal so scrubbing it on success can
    // never race a re-read.
    const hash = currentHash();
    scrubbedHashRef.current = hash;
    setState({ kind: "revealing", passwordProtected });
    try {
      const plaintext = await revealFlow(
        id,
        hash,
        passwordProtected && password.length > 0 ? password : null,
      );
      // Scrub the key material from the address bar and browser history.
      window.history.replaceState(null, "", window.location.pathname);
      setState({ kind: "revealed", plaintext });
    } catch (err) {
      if (err instanceof InvalidFragmentError) {
        setState({ kind: "invalid-link" });
        return;
      }
      if (err instanceof ApiError) {
        switch (err.code) {
          case "INVALID_SIGNATURE": {
            if (passwordProtected) {
              setError(
                err.retryAfterSeconds
                  ? t("invalidPasswordLocked", {
                      seconds: err.retryAfterSeconds,
                    })
                  : t("invalidPassword"),
              );
            } else {
              // No password: a wrong signature means the link key itself is
              // damaged, not a guess.
              setState({ kind: "invalid-link" });
              return;
            }
            setState({ kind: "ready", passwordProtected });
            return;
          }
          case "TOO_MANY_ATTEMPTS":
            setError(
              t("lockedOut", { seconds: err.retryAfterSeconds ?? 30 }),
            );
            setState({ kind: "ready", passwordProtected });
            return;
          case "RETRIEVAL_RESTRICTED":
            setState({ kind: "restricted" });
            return;
          case "SECRET_UNAVAILABLE":
            setState({ kind: "unavailable" });
            return;
          case "RATE_LIMITED":
            setError(t("errorRateLimited"));
            setState({ kind: "ready", passwordProtected });
            return;
        }
      }
      // Decryption failures land here: the payload was already burned, so the
      // most honest message is "corrupted link" (extremely unlikely given the
      // signature check binds the same key material).
      setError(t("decryptFailed"));
      setState({ kind: "ready", passwordProtected });
    }
  }

  if (state.kind === "checking") {
    return (
      <Card>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{t("checking")}</p>
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-40" />
        </CardContent>
      </Card>
    );
  }

  if (state.kind === "invalid-link") {
    return (
      <Alert variant="destructive">
        <TriangleAlert aria-hidden />
        <AlertTitle>{t("unavailableTitle")}</AlertTitle>
        <AlertDescription>{t("invalidLink")}</AlertDescription>
      </Alert>
    );
  }

  if (state.kind === "unavailable") {
    return (
      <Alert>
        <Flame aria-hidden />
        <AlertTitle>{t("unavailableTitle")}</AlertTitle>
        <AlertDescription>{t("unavailableText")}</AlertDescription>
      </Alert>
    );
  }

  if (state.kind === "restricted") {
    return (
      <Alert>
        <ShieldAlert aria-hidden />
        <AlertTitle>{t("restrictedTitle")}</AlertTitle>
        <AlertDescription>{t("restrictedText")}</AlertDescription>
      </Alert>
    );
  }

  if (state.kind === "revealed") {
    return (
      <Card>
        <CardContent className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">{t("revealedHeading")}</h2>
          <pre className="overflow-x-auto rounded-lg border bg-muted p-4 font-mono text-sm whitespace-pre-wrap break-all">
            {state.plaintext}
          </pre>
          <div className="flex items-center gap-2">
            <CopyButton
              value={state.plaintext}
              label={t("copySecret")}
              copiedLabel={t("copied")}
              failedMessage={t("errorGeneric")}
              variant="default"
            />
          </div>
          <Alert>
            <Flame aria-hidden />
            <AlertDescription>{t("destroyedNote")}</AlertDescription>
          </Alert>
          <p className="text-sm text-muted-foreground">
            {t("replyHint")}{" "}
            <Link href="/" className="font-medium text-primary hover:underline">
              {t("replyCta")}
            </Link>
          </p>
        </CardContent>
      </Card>
    );
  }

  const revealing = state.kind === "revealing";
  const passwordProtected = state.passwordProtected;

  return (
    <Card>
      <CardContent>
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!revealing && !(passwordProtected && password.length === 0)) {
              void reveal(passwordProtected);
            }
          }}
        >
          <p className="text-sm text-muted-foreground">{t("introAvailable")}</p>

          {passwordProtected && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="reveal-password">{t("passwordLabel")}</Label>
              <div className="flex gap-2">
                <Input
                  id="reveal-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={t("passwordPlaceholder")}
                  autoComplete="off"
                  className="font-mono"
                  disabled={revealing}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={showPassword ? "hide" : "show"}
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? (
                    <EyeOff className="size-4" aria-hidden />
                  ) : (
                    <Eye className="size-4" aria-hidden />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("passwordRequired")}
              </p>
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <TriangleAlert aria-hidden />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-2">
            <div>
              <Button
                type="submit"
                disabled={
                  revealing || (passwordProtected && password.length === 0)
                }
              >
                {revealing ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Eye className="size-4" aria-hidden />
                )}
                {revealing ? t("revealing") : t("cta")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("onceWarning")}</p>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
