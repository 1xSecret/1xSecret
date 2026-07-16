"use client";

import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Check, Clock, Flame, HelpCircle, Trash2 } from "lucide-react";

import { api } from "@/lib/client/api";
import {
  listHistory,
  removeHistoryEntry,
  updateHistoryLabel,
  type HistoryEntry,
} from "@/lib/client/local-history";
import { Link } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

type RemoteStatus = {
  status: "pending" | "retrieved" | "expired" | "unknown";
  retrievedAt: string | null;
  expiresAt: string | null;
};

async function loadHistoryWithStatuses(): Promise<{
  local: HistoryEntry[];
  remote: Map<string, RemoteStatus>;
}> {
  const local = listHistory();
  let remote = new Map<string, RemoteStatus>();
  if (local.length > 0) {
    try {
      const { secrets } = await api.batchStatus(local.map((e) => e.id));
      remote = new Map(secrets.map((s) => [s.id, s]));
    } catch {
      // Status stays unknown; the local list still renders.
    }
  }
  return { local, remote };
}

export function MySecrets() {
  const t = useTranslations("MySecrets");
  const format = useFormatter();
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [statuses, setStatuses] = useState<Map<string, RemoteStatus>>(
    new Map(),
  );

  useEffect(() => {
    let cancelled = false;
    loadHistoryWithStatuses().then(({ local, remote }) => {
      if (cancelled) return;
      setEntries(local);
      setStatuses(remote);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (entries === null) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-start gap-3">
          <p className="text-muted-foreground">{t("empty")}</p>
          <Button render={<Link href="/" />} nativeButton={false}>
            {t("createFirst")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  function statusBadge(entry: HistoryEntry) {
    const remote = statuses.get(entry.id);
    const status = remote?.status;
    switch (status) {
      case "retrieved":
        return (
          <Badge variant="secondary" className="gap-1">
            <Check className="size-3" aria-hidden />
            {t("statusRetrieved")}
          </Badge>
        );
      case "pending":
        return (
          <Badge variant="outline" className="gap-1">
            <Clock className="size-3" aria-hidden />
            {t("statusPending")}
          </Badge>
        );
      case "expired":
        return (
          <Badge variant="outline" className="gap-1 text-muted-foreground">
            <Flame className="size-3" aria-hidden />
            {t("statusExpired")}
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="gap-1 text-muted-foreground">
            <HelpCircle className="size-3" aria-hidden />
            {t("statusUnknown")}
          </Badge>
        );
    }
  }

  function formatDate(iso: string | null | undefined) {
    if (!iso) return "—";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "—";
    return format.dateTime(date, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{t("intro")}</p>
      {entries.map((entry) => {
        const remote = statuses.get(entry.id);
        return (
          <Card key={entry.id}>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Input
                  aria-label={t("labelPlaceholder")}
                  defaultValue={entry.label}
                  placeholder={t("labelPlaceholder")}
                  maxLength={80}
                  className="max-w-64 border-transparent px-1 font-medium shadow-none focus-visible:border-input dark:bg-transparent"
                  onBlur={(event) =>
                    updateHistoryLabel(entry.id, event.target.value.trim())
                  }
                />
                {statusBadge(entry)}
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t("createdLabel")}
                  </dt>
                  <dd>{formatDate(entry.createdAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t("expiresLabel")}
                  </dt>
                  <dd>{formatDate(remote?.expiresAt ?? entry.expiresAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t("retrievedLabel")}
                  </dt>
                  <dd>{formatDate(remote?.retrievedAt)}</dd>
                </div>
                <div className="flex items-end justify-start sm:justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    title={t("removeNote")}
                    onClick={() => {
                      removeHistoryEntry(entry.id);
                      setEntries(listHistory());
                    }}
                  >
                    <Trash2 className="size-4" aria-hidden />
                    {t("remove")}
                  </Button>
                </div>
              </dl>
            </CardContent>
          </Card>
        );
      })}
      <p className="text-xs text-muted-foreground">{t("localOnly")}</p>
    </div>
  );
}
