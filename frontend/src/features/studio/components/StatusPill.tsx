"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender
// Status is always icon + words + colour.

import { Check, CircleAlert, Clock, LoaderCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const META = {
  idle: { tone: "neutral", Icon: Clock },
  working: { tone: "info", Icon: LoaderCircle },
  error: { tone: "danger", Icon: CircleAlert },
  ok: { tone: "success", Icon: Check },
} as const;

export function StatusPill({
  status,
  message,
  className,
}: {
  status: "idle" | "working" | "error" | "ok";
  message: string;
  className?: string;
}) {
  const { tone, Icon } = META[status];
  return (
    <Badge tone={tone} className={className}>
      <Icon aria-hidden className={status === "working" ? "animate-spin" : undefined} />
      {message}
    </Badge>
  );
}
