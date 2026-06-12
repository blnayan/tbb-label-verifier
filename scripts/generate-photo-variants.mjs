/**
 * Generates "photo condition" robustness samples: real TTB label artwork
 * re-rendered as if photographed by hand — slight rotation and shear, a
 * glare hotspot, uneven lighting, mild blur, and lossy JPEG re-encoding.
 * The text content is unchanged, so the expected verdict matches the flat
 * original; only the imaging conditions get harder.
 *
 * Run: node scripts/generate-photo-variants.mjs
 */

import path from "node:path";
import sharp from "sharp";

const SAMPLES_DIR = path.join(process.cwd(), "public", "samples");

const VARIANTS = [
  { source: "real-austerum-red.jpg", out: "photo-austerum-red.jpg", angle: -2.2 },
  { source: "real-victoria-beer.jpg", out: "photo-victoria-beer.jpg", angle: 1.8 },
];

/** Soft white glare hotspot + darkened corner, sized to the image. */
function lightingOverlay(width, height) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <radialGradient id="glare" cx="32%" cy="22%" r="36%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.26"/>
      <stop offset="55%" stop-color="#ffffff" stop-opacity="0.09"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="shadow" cx="95%" cy="100%" r="80%">
      <stop offset="0%" stop-color="#000000" stop-opacity="0.30"/>
      <stop offset="60%" stop-color="#000000" stop-opacity="0.10"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#glare)"/>
  <rect width="${width}" height="${height}" fill="url(#shadow)"/>
</svg>`);
}

for (const variant of VARIANTS) {
  const sourcePath = path.join(SAMPLES_DIR, variant.source);
  const base = sharp(sourcePath);
  const meta = await base.metadata();

  // Hand-held camera feel: small rotation plus a mild shear (perspective-ish),
  // on a desk-like backdrop.
  const warped = await base
    .rotate(variant.angle, { background: "#d8d2c4" })
    .affine([1, 0.015, 0.03, 0.995], { background: "#d8d2c4" })
    .toBuffer();
  const { width, height } = await sharp(warped).metadata();

  await sharp(warped)
    .composite([{ input: lightingOverlay(width, height) }])
    .blur(0.4)
    .modulate({ brightness: 0.97, saturation: 0.94 })
    .jpeg({ quality: 78 })
    .toFile(path.join(SAMPLES_DIR, variant.out));
  console.log(`wrote ${variant.out} (from ${variant.source}, ${meta.width}x${meta.height})`);
}
