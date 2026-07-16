"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

/**
 * Copy-to-clipboard with graceful degradation: navigator.clipboard requires a
 * secure context (https / localhost), which self-hosted plain-http intranet
 * deployments may lack — on failure we surface a hint instead of failing
 * silently.
 */
export function CopyButton({
  value,
  label,
  copiedLabel,
  failedMessage,
  variant = "outline",
  size = "sm",
}: {
  value: string;
  label: string;
  copiedLabel: string;
  failedMessage: string;
  variant?: "outline" | "default" | "ghost" | "secondary";
  size?: "sm" | "default" | "icon-sm";
}) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(failedMessage);
    }
  }

  return (
    <Button type="button" variant={variant} size={size} onClick={copy}>
      {copied ? (
        <Check className="size-4" aria-hidden />
      ) : (
        <Copy className="size-4" aria-hidden />
      )}
      {copied ? copiedLabel : label}
    </Button>
  );
}
