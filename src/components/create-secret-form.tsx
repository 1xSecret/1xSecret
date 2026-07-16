"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Eye, EyeOff, Info, Loader2, Sparkles, TriangleAlert } from "lucide-react";

import { generatePassword, MAX_SECRET_LENGTH } from "@/lib/crypto";
import { api, ApiError, type InstanceConfig } from "@/lib/client/api";
import { sealFlow } from "@/lib/client/flows";
import { addHistoryEntry, updateHistoryLabel } from "@/lib/client/local-history";
import type { ExpiresIn } from "@/lib/server/config";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CopyButton } from "@/components/copy-button";

const EXPIRY_OPTIONS: ExpiresIn[] = ["10m", "1h", "1d", "7d", "30d"];

const RESULT_STORAGE_KEY = "1xsecret.result.v1";
// Set by the language switcher right before a locale change on the create page.
// Its presence tells the remounting form to keep the result view; any other
// navigation (which never sets it) resets the form.
export const PRESERVE_RESULT_KEY = "1xsecret.preserveResult";

/** Serializable snapshot of a completed seal, shown in the result view. */
interface ResultOutcome {
  id: string;
  link: string;
  password: string | null;
  /** Whether the password was auto-generated (shown) vs. user-chosen (hidden). */
  passwordGenerated: boolean;
  restrictedRetrieval: boolean;
  label: string;
}

export function CreateSecretForm() {
  const t = useTranslations("CreateForm");
  const tResult = useTranslations("CreateResult");
  const tSafeguard = useTranslations("SafeguardNotice");
  const tCommon = useTranslations("Common");
  const locale = useLocale();

  const [instance, setInstance] = useState<InstanceConfig | null>(null);
  const [secret, setSecret] = useState("");
  const [password, setPassword] = useState("");
  const [passwordGenerated, setPasswordGenerated] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [expiresIn, setExpiresIn] = useState<ExpiresIn>("7d");
  const [sealing, setSealing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcomeState] = useState<ResultOutcome | null>(null);
  const [label, setLabel] = useState("");
  // Reveal toggle for the retrieval-password reminder on the result view.
  const [showResultPassword, setShowResultPassword] = useState(false);

  // Persist the seal result for the lifetime of the result view so a remount
  // (most notably a header language switch) cannot lose the one-time link —
  // which holds the only copy of the master key. Scoped to this browser tab,
  // cleared on "Create another". Rehydrated on mount.
  function setOutcome(next: ResultOutcome | null) {
    setOutcomeState(next);
    try {
      if (next) {
        window.sessionStorage.setItem(RESULT_STORAGE_KEY, JSON.stringify(next));
      } else {
        window.sessionStorage.removeItem(RESULT_STORAGE_KEY);
      }
    } catch {
      // sessionStorage unavailable — the in-memory state still works within a
      // single mount; only the cross-remount recovery is lost.
    }
  }

  useEffect(() => {
    api.getConfig().then(setInstance).catch(() => setInstance(null));
    // Rehydrate the result view ONLY when the language switcher flagged an
    // in-place locale change; any other way of arriving here (navigating back
    // to the create page, a reload) starts with a fresh form. Deferred to a
    // microtask so it is not a synchronous setState in the effect body, and
    // client-only so it never runs during SSR (avoiding a hydration mismatch).
    Promise.resolve().then(() => {
      try {
        const preserve =
          window.sessionStorage.getItem(PRESERVE_RESULT_KEY) === "1";
        window.sessionStorage.removeItem(PRESERVE_RESULT_KEY);
        if (!preserve) {
          window.sessionStorage.removeItem(RESULT_STORAGE_KEY);
          return;
        }
        const stored = window.sessionStorage.getItem(RESULT_STORAGE_KEY);
        if (!stored) return;
        const parsed = JSON.parse(stored) as ResultOutcome;
        if (parsed?.link && parsed?.id) {
          setOutcomeState(parsed);
          setLabel(parsed.label ?? "");
        }
      } catch {
        // ignore malformed/blocked storage
      }
    });
  }, []);

  const remaining = MAX_SECRET_LENGTH - secret.length;
  const safeguarded = instance?.mode === "SAFEGUARDED";

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const trimmed = secret;
    if (trimmed.trim().length === 0) {
      setError(t("errorEmpty"));
      return;
    }
    if (trimmed.length > MAX_SECRET_LENGTH) {
      setError(t("errorTooLong", { max: MAX_SECRET_LENGTH }));
      return;
    }

    setSealing(true);
    try {
      const pw = password.length > 0 ? password : null;
      const result = await sealFlow(trimmed, pw, expiresIn);
      const link = `${window.location.origin}/${locale}/s/${result.id}#${result.fragment}`;

      addHistoryEntry({
        id: result.id,
        label: "",
        createdAt: new Date().toISOString(),
        expiresAt: result.expiresAt.toISOString(),
        hasPassword: pw !== null,
      });

      setOutcome({
        id: result.id,
        link,
        password: pw,
        passwordGenerated: pw !== null && passwordGenerated,
        restrictedRetrieval: result.restrictedRetrieval,
        label: "",
      });
      // A generated password is shown so the creator can transcribe it; a
      // self-chosen one stays hidden — they already know it.
      setShowResultPassword(pw !== null && passwordGenerated);
      setLabel("");
      setSecret("");
      setPassword("");
      setPasswordGenerated(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === "RATE_LIMITED") {
        setError(t("errorRateLimited"));
      } else {
        setError(t("errorGeneric"));
      }
    } finally {
      setSealing(false);
    }
  }

  function onLabelChange(value: string) {
    setLabel(value);
    if (outcome) {
      updateHistoryLabel(outcome.id, value.trim());
      setOutcome({ ...outcome, label: value });
    }
  }

  function reset() {
    setOutcome(null);
    setLabel("");
    setError(null);
  }

  if (outcome) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-5">
          <h2 className="text-lg font-semibold">{tResult("heading")}</h2>

          <div className="flex flex-col gap-2">
            <Label htmlFor="one-time-link">{tResult("linkLabel")}</Label>
            <div className="flex gap-2">
              <Input
                id="one-time-link"
                readOnly
                value={outcome.link}
                className="font-mono text-xs"
                onFocus={(event) => event.currentTarget.select()}
              />
              <CopyButton
                value={outcome.link}
                label={tResult("copyLink")}
                copiedLabel={tResult("copied")}
                failedMessage={tResult("copyFailed")}
                variant="default"
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {tResult("onceNote")}
            </p>
          </div>

          {outcome.password && (
            <Alert>
              <Info aria-hidden />
              <AlertTitle>{tResult("passwordReminderTitle")}</AlertTitle>
              <AlertDescription>
                <p>{tResult("passwordReminder")}</p>
                <div className="mt-2 flex items-center gap-2">
                  <code className="rounded bg-muted px-2 py-1 font-mono text-xs">
                    {/* Fixed-width mask: never reveals the password length. */}
                    {showResultPassword ? outcome.password : "••••••••••••"}
                  </code>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={
                      showResultPassword
                        ? t("passwordHide")
                        : t("passwordShow")
                    }
                    onClick={() => setShowResultPassword((v) => !v)}
                  >
                    {showResultPassword ? (
                      <EyeOff className="size-4" aria-hidden />
                    ) : (
                      <Eye className="size-4" aria-hidden />
                    )}
                  </Button>
                  <CopyButton
                    value={outcome.password}
                    label={tResult("copyPassword")}
                    copiedLabel={tResult("copied")}
                    failedMessage={tResult("copyFailed")}
                    size="sm"
                  />
                </div>
              </AlertDescription>
            </Alert>
          )}

          {outcome.restrictedRetrieval && (
            <Alert>
              <TriangleAlert aria-hidden />
              <AlertTitle>{tResult("restrictedTitle")}</AlertTitle>
              <AlertDescription>{tResult("restrictedNote")}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="secret-label">{tResult("labelLabel")}</Label>
            <Input
              id="secret-label"
              value={label}
              maxLength={80}
              placeholder={tResult("labelPlaceholder")}
              onChange={(event) => onLabelChange(event.target.value)}
            />
          </div>

          <div>
            <Button type="button" variant="outline" onClick={reset}>
              {tResult("createAnother")}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          {safeguarded && instance && (
            <Alert>
              {instance.clientIsSafe ? (
                <Info aria-hidden />
              ) : (
                <TriangleAlert aria-hidden />
              )}
              <AlertTitle>{tSafeguard("titleInfo")}</AlertTitle>
              <AlertDescription>
                {instance.clientIsSafe
                  ? tSafeguard("safeCreator")
                  : tSafeguard("unsafeCreator")}
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="secret-input">{t("secretLabel")}</Label>
            <Textarea
              id="secret-input"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              placeholder={t("secretPlaceholder")}
              maxLength={MAX_SECRET_LENGTH}
              rows={4}
              required
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
            <p
              className="text-right text-xs text-muted-foreground"
              aria-live="polite"
            >
              {t("charactersLeft", { count: remaining })}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="retrieval-password">{t("passwordLabel")}</Label>
            <div className="flex gap-2">
              <Input
                id="retrieval-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setPasswordGenerated(false);
                }}
                placeholder={t("passwordPlaceholder")}
                autoComplete="off"
                className="font-mono"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={showPassword ? t("passwordHide") : t("passwordShow")}
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? (
                  <EyeOff className="size-4" aria-hidden />
                ) : (
                  <Eye className="size-4" aria-hidden />
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setPassword(generatePassword());
                  setPasswordGenerated(true);
                  setShowPassword(true);
                }}
              >
                <Sparkles className="size-4" aria-hidden />
                {t("passwordGenerate")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("passwordHint")}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>{t("expiryBefore")}</span>
            <Select
              value={expiresIn}
              items={Object.fromEntries(
                EXPIRY_OPTIONS.map((option) => [
                  option,
                  t(`expiry${option}` as Parameters<typeof t>[0]),
                ]),
              )}
              onValueChange={(value) => {
                if (value) setExpiresIn(value as ExpiresIn);
              }}
            >
              <SelectTrigger size="sm" aria-label={t("expiryBefore")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPIRY_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {t(`expiry${option}` as Parameters<typeof t>[0])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span>{t("expiryAfter")}</span>
          </div>

          {error && (
            <Alert variant="destructive">
              <TriangleAlert aria-hidden />
              <AlertTitle>{tCommon("error")}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div>
            <Button type="submit" disabled={sealing || remaining < 0}>
              {sealing && (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              )}
              {sealing ? t("sealing") : t("submit")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
