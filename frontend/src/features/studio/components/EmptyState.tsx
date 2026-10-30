"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender
// Empty workspace that takes an image: click to browse or drop a file.

import { useState } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function UploadDropZone({
  title,
  description,
  onPickFile,
  onDropFile,
  className,
}: {
  title: string;
  description: string;
  onPickFile: () => void;
  onDropFile: (file: File) => void;
  className?: string;
}) {
  const [over, setOver] = useState(false);
  return (
    <button
      type="button"
      onClick={onPickFile}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const file = e.dataTransfer.files?.[0];
        if (!file) return;
        if (file.type.startsWith("image/")) onDropFile(file);
        else toast.error("That file is not an image. Use a PNG, JPG or WEBP.");
      }}
      data-over={over}
      className={cn("oa-drop w-full cursor-pointer", !over && "hover:bg-hover", className)}
    >
      <span className="oa-icon-box">
        <Upload aria-hidden className="size-5" />
      </span>
      <span className="flex flex-col gap-1">
        <span className="oa-h3">{title}</span>
        <span className="text-xs leading-[18px] text-ink-2">{description}</span>
      </span>
    </button>
  );
}
