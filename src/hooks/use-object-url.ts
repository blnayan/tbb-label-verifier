"use client";

import { useEffect, useMemo } from "react";

/** Object URL for a File/Blob, revoked automatically when it changes away. */
export function useObjectUrl(file: File | Blob | null): string | null {
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  useEffect(() => {
    if (!url) return;
    return () => URL.revokeObjectURL(url);
  }, [url]);

  return url;
}
