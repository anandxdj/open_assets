"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert } from "lucide-react";

const Toaster = ({ ...props }: ToasterProps) => {
  const { resolvedTheme } = useTheme();

  return (
    <Sonner
      theme={(resolvedTheme ?? "system") as ToasterProps["theme"]}
      // Top centre, below the 48px top bar: bottom-right would cover sticky
      // run/download buttons and top-right would cover page actions.
      position="top-center"
      offset={56}
      mobileOffset={56}
      icons={{
        success: <CircleCheck className="size-4 text-success" />,
        info: <Info className="size-4 text-info" />,
        warning: <TriangleAlert className="size-4 text-warning" />,
        error: <CircleAlert className="size-4 text-danger" />,
        loading: <LoaderCircle className="size-4 animate-spin" />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: "oa-toast",
          title: "text-[11px] font-bold uppercase leading-4 tracking-[0.06em]",
          description: "text-xs leading-[18px] text-ink-2",
          actionButton: "oa-btn oa-btn-secondary oa-btn-sm ml-auto",
          cancelButton: "oa-btn oa-btn-ghost oa-btn-sm",
          closeButton: "oa-btn oa-btn-ghost oa-btn-sm oa-btn-icon",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
