import * as React from "react";
import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Label + control + help or error. Pass the control's id as `htmlFor` and the
 * control gets `aria-describedby` wiring through `describedBy`.
 */
export function Field({
  label,
  htmlFor,
  aside,
  help,
  error,
  className,
  children,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  aside?: React.ReactNode;
  help?: React.ReactNode;
  error?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const noteId = htmlFor ? `${htmlFor}-note` : undefined;
  return (
    <div className={cn("oa-field", className)}>
      <span className="oa-field-label">
        <label htmlFor={htmlFor}>{label}</label>
        {aside}
      </span>
      {children}
      {error ? (
        <span id={noteId} className="oa-field-error" role="alert">
          <CircleAlert aria-hidden className="size-3.5" />
          {error}
        </span>
      ) : help ? (
        <span id={noteId} className="oa-field-help">
          {help}
        </span>
      ) : null}
    </div>
  );
}

export function describedBy(htmlFor: string, hasNote: boolean) {
  return hasNote ? `${htmlFor}-note` : undefined;
}
