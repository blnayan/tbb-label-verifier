/**
 * Last-resort image shrinking before upload.
 *
 * Images are sent exactly as the user provided them — resampling plus a
 * JPEG re-encode visibly degrades fine print (measured on a real crown
 * label: it flipped the government warning from a reliable match to a
 * misread, "IMPAIRS" → "IMPARES", and auto-rejected a compliant label).
 * The single exception is a file the server would reject outright
 * (> MAX_IMAGE_BYTES): shrinking it is strictly better than failing the
 * upload, so it is resized to the 2048px the OpenAI vision API scales
 * images down to anyway and re-encoded as JPEG.
 */

import { MAX_IMAGE_BYTES } from "@/lib/verification/input"

const MAX_DIMENSION = 2048

/** Pure gate: shrink only what the server would otherwise reject. */
export function needsDownscale(bytes: number): boolean {
  return bytes > MAX_IMAGE_BYTES
}

export async function downscaleImage(file: File): Promise<File> {
  // GIFs may animate and canvas would flatten them; an oversized GIF is
  // left for the server to reject with a clear error.
  if (!needsDownscale(file.size) || file.type === "image/gif") return file

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    // Not decodable here — let the server/model report a proper error.
    return file
  }

  const { width, height } = bitmap
  // Never upscale — an oversized file at modest dimensions (say, a huge
  // PNG) just gets the JPEG re-encode.
  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const ctx = canvas.getContext("2d")
  if (!ctx) {
    bitmap.close()
    return file
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.9)
  )
  if (!blob) return file

  const name = file.name.replace(/\.[^.]+$/, "") + ".jpg"
  return new File([blob], name, { type: "image/jpeg" })
}
