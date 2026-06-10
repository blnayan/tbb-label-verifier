/**
 * Client-side image downscaling before upload.
 *
 * The vision model never sees more than ~1568px on the long edge (the API
 * downscales larger images server-side anyway), so shrinking a 12MP phone
 * photo in the browser cuts upload time and tokens with zero accuracy cost —
 * which is how we protect the ~5 second budget on slow connections.
 */

const MAX_DIMENSION = 1568;

export async function downscaleImage(file: File): Promise<File> {
  // GIFs may animate and canvas would flatten them; send small files as-is.
  if (file.type === "image/gif") return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // Not decodable here — let the server/model report a proper error.
    return file;
  }

  const { width, height } = bitmap;
  if (Math.max(width, height) <= MAX_DIMENSION) {
    bitmap.close();
    return file;
  }

  const scale = MAX_DIMENSION / Math.max(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.9),
  );
  if (!blob) return file;

  const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return new File([blob], name, { type: "image/jpeg" });
}
