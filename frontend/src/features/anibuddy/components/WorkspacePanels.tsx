import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Building blocks for the AniBuddy workspace row: a dotted stage in the middle
 * and a 288px inspector on the right. Below lg both stack under the step list.
 */
export function StageArea({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <main
      aria-label={label}
      className={cn("oa-stage flex min-h-[420px] shrink-0 flex-col lg:min-h-0 lg:min-w-0 lg:flex-1 lg:shrink", className)}
    >
      {children}
    </main>
  );
}

export function Inspector({
  title,
  footer,
  children,
}: {
  title: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const id = React.useId();
  return (
    <aside
      aria-labelledby={id}
      className="flex flex-none flex-col border-t-[1.5px] border-line bg-surface lg:w-[288px] lg:border-l-[1.5px] lg:border-t-0"
    >
      <h2 id={id} className="oa-panel-head">
        {title}
      </h2>
      <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">{children}</div>
      {footer && (
        <div className="flex flex-none flex-col gap-2 border-t-[1.5px] border-line bg-surface px-3.5 py-3">{footer}</div>
      )}
    </aside>
  );
}

export function PanelSection({
  title,
  aside,
  className,
  children,
}: {
  title?: React.ReactNode;
  aside?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("oa-panel-sec", className)}>
      {title && (
        <h3 className="oa-panel-title">
          <span>{title}</span>
          {aside}
        </h3>
      )}
      {children}
    </section>
  );
}

/** Label on the left, control on the right: the inspector's property row. */
export function Prop({
  label,
  htmlFor,
  children,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  const Label = htmlFor ? "label" : "span";
  return (
    <div className="grid grid-cols-[76px_minmax(0,1fr)] items-center gap-2 text-xs text-ink-2">
      <Label htmlFor={htmlFor} className="text-[10.5px] font-bold uppercase tracking-[0.06em]">
        {label}
      </Label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Muted helper copy under a control or section. */
export function Hint({ className, children }: { className?: string; children: React.ReactNode }) {
  return <p className={cn("text-[11px] leading-4 text-ink-3", className)}>{children}</p>;
}
