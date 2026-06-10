"use client";

/**
 * Image picker that works three ways — click, drag-and-drop, or paste —
 * with a visible preview so the agent always knows which label they're
 * about to verify.
 */

import Image from "next/image";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ImageUpIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ImageDropProps {
  file: File | null;
  onFileChange: (file: File | null) => void;
  disabled?: boolean;
}

export function ImageDrop({ file, onFileChange, disabled }: ImageDropProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const previewUrl = useMemo(
    () => (file ? URL.createObjectURL(file) : null),
    [file],
  );
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const accept = useCallback(
    (candidate: File | undefined | null) => {
      if (!candidate || !candidate.type.startsWith("image/")) return;
      onFileChange(candidate);
    },
    [onFileChange],
  );

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="sr-only"
        disabled={disabled}
        onChange={(e) => accept(e.target.files?.[0])}
      />
      {previewUrl && file ? (
        <div className="relative overflow-hidden rounded-lg border bg-muted">
          {/* object URL preview — next/image can't optimize blob: URLs */}
          <Image
            src={previewUrl}
            alt={`Label image: ${file.name}`}
            width={800}
            height={500}
            unoptimized
            className="max-h-72 w-full object-contain"
          />
          <div className="flex items-center justify-between gap-2 border-t bg-background p-2">
            <span className="truncate text-sm text-muted-foreground">
              {file.name}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => {
                onFileChange(null);
                if (inputRef.current) inputRef.current.value = "";
              }}
            >
              <XIcon data-icon="inline-start" />
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <label
          htmlFor={inputId}
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!disabled) accept(e.dataTransfer.files?.[0]);
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors",
            dragging ? "border-ring bg-accent" : "hover:bg-accent/50",
            disabled && "pointer-events-none opacity-50",
          )}
        >
          <ImageUpIcon aria-hidden className="size-8 text-muted-foreground" />
          <span className="font-medium">Add the label image</span>
          <span className="text-sm text-muted-foreground">
            Click to choose a file, or drag it here. JPEG, PNG, WebP, or GIF.
          </span>
        </label>
      )}
    </div>
  );
}
