/**
 * Sample dataset manifest — lets reviewers exercise the app in one click
 * without hunting for label images.
 */

import type { ApplicationData } from "@/lib/verification/types";

export interface SampleLabel {
  id: string;
  name: string;
  /** Public path to the label image, e.g. "/samples/old-tom.png". */
  image: string;
  /** What this sample demonstrates, shown in the picker. */
  description: string;
  /** "generated" (AI/programmatic) or "real" (photograph of a real bottle). */
  source: "generated" | "real";
  application: ApplicationData;
}

export interface SampleManifest {
  singles: SampleLabel[];
  batch: {
    csv: string;
    images: string[];
  };
}

export async function fetchSampleManifest(): Promise<SampleManifest> {
  const response = await fetch("/samples/manifest.json");
  if (!response.ok) throw new Error("Could not load the sample dataset.");
  return (await response.json()) as SampleManifest;
}

export async function fetchAsFile(url: string): Promise<File> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}`);
  const blob = await response.blob();
  const name = url.split("/").pop() ?? "sample";
  return new File([blob], name, { type: blob.type });
}
