/**
 * Generates the AI-designed portion of the sample dataset: synthetic alcohol
 * labels rendered from SVG to PNG, including deliberate compliance errors
 * drawn from the stakeholder interviews (title-case warning, ABV mismatch,
 * missing warning, reworded warning, an unbolded warning heading, case-only
 * brand differences) plus the mandatory-elements checks (a missing bottler
 * statement; an imported Canadian whisky with importer and country-of-origin
 * statements) and near-miss warning deviations (single-letter typo, dropped
 * word, transposed words) that probe whether the reader normalizes a
 * deviating warning back to the statutory text it knows by heart.
 *
 * Run: node scripts/generate-samples.mjs
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const OUT_DIR = path.join(process.cwd(), "public", "samples");

const WARNING =
  "GOVERNMENT WARNING: (1) According to the Surgeon General, women should " +
  "not drink alcoholic beverages during pregnancy because of the risk of " +
  "birth defects. (2) Consumption of alcoholic beverages impairs your " +
  "ability to drive a car or operate machinery, and may cause health problems.";

const TITLE_CASE_WARNING = WARNING.replace(
  "GOVERNMENT WARNING:",
  "Government Warning:",
);

const REWORDED_WARNING = WARNING.replace(
  "women should not drink alcoholic beverages during pregnancy",
  "women should avoid alcoholic beverages while pregnant",
);

// Near-miss deviations: one word-level change each, otherwise statutory.
// These probe whether the reader silently normalizes a deviating warning
// back to the text it knows by heart — which would be a false PASS.
const TYPO_WARNING = WARNING.replace("impairs", "impares");

const DROPPED_WORD_WARNING = WARNING.replace(
  "and may cause health problems",
  "and cause health problems",
);

const SWAPPED_WORDS_WARNING = WARNING.replace(
  "drive a car or operate machinery",
  "operate a car or drive machinery",
);

/** Greedy word-wrap for SVG <text> lines. */
function wrap(text, maxChars) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    if (line && (line + " " + word).length > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = line ? line + " " + word : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function escapeXml(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * Render a classic rectangular label. The palette varies per label so the
 * dataset doesn't look like five copies of one template.
 */
function labelSvg({
  brand,
  brandSize = 64,
  classType,
  abvText,
  netText,
  bottlerText = null,
  originText = null,
  warning,
  warningHeadingBold = true,
  bg = "#f5efdf",
  ink = "#2b2118",
  accent = "#8a2e2e",
}) {
  const W = 900;
  const H = 1200;
  const brandLines = wrap(brand, 18);
  const classLines = wrap(classType, 30);

  let cursor = 300;
  const brandText = brandLines
    .map((line) => {
      const t = `<text x="450" y="${cursor}" text-anchor="middle" font-family="Georgia, serif" font-size="${brandSize}" font-weight="700" fill="${ink}" letter-spacing="2">${escapeXml(line)}</text>`;
      cursor += brandSize + 10;
      return t;
    })
    .join("\n");

  cursor += 30;
  const classText = classLines
    .map((line) => {
      const t = `<text x="450" y="${cursor}" text-anchor="middle" font-family="Georgia, serif" font-size="34" font-style="italic" fill="${accent}">${escapeXml(line)}</text>`;
      cursor += 44;
      return t;
    })
    .join("\n");

  let warningBlock = "";
  if (warning) {
    const lines = wrap(warning, 58);
    let y = 1010;
    warningBlock = lines
      .map((line, i) => {
        // Bold the heading words on the first line only.
        let content = escapeXml(line);
        if (i === 0 && warningHeadingBold) {
          const m = line.match(/^((?:GOVERNMENT WARNING|Government Warning):?)(.*)$/);
          if (m) {
            content = `<tspan font-weight="700">${escapeXml(m[1])}</tspan>${escapeXml(m[2])}`;
          }
        }
        const t = `<text x="80" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="20" fill="${ink}">${content}</text>`;
        y += 26;
        return t;
      })
      .join("\n");
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${bg}"/>
  <rect x="30" y="30" width="${W - 60}" height="${H - 60}" fill="none" stroke="${ink}" stroke-width="6"/>
  <rect x="44" y="44" width="${W - 88}" height="${H - 88}" fill="none" stroke="${ink}" stroke-width="2"/>
  <line x1="200" y1="150" x2="700" y2="150" stroke="${accent}" stroke-width="3"/>
  <text x="450" y="130" text-anchor="middle" font-family="Georgia, serif" font-size="26" letter-spacing="6" fill="${ink}">ESTABLISHED 1897</text>
  ${brandText}
  ${classText}
  <line x1="200" y1="${cursor + 10}" x2="700" y2="${cursor + 10}" stroke="${accent}" stroke-width="3"/>
  <text x="450" y="870" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="36" fill="${ink}">${escapeXml(abvText)}</text>
  <text x="450" y="925" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="36" fill="${ink}">${escapeXml(netText)}</text>
  ${bottlerText ? `<text x="450" y="958" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="19" fill="${ink}">${escapeXml(bottlerText)}</text>` : ""}
  ${originText ? `<text x="450" y="985" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="19" fill="${ink}">${escapeXml(originText)}</text>` : ""}
  ${warningBlock}
</svg>`;
}

const SAMPLES = [
  {
    file: "old-tom-clean.png",
    svg: labelSvg({
      brand: "OLD TOM DISTILLERY",
      classType: "Kentucky Straight Bourbon Whiskey",
      abvText: "45% Alc./Vol. (90 Proof)",
      netText: "750 mL",
      bottlerText: "BOTTLED BY OLD TOM DISTILLERY, BARDSTOWN, KY",
      warning: WARNING,
    }),
  },
  {
    file: "stones-throw-case.png",
    svg: labelSvg({
      brand: "STONE'S THROW",
      classType: "Red Wine",
      abvText: "13.5% Alc./Vol.",
      netText: "750 mL",
      bottlerText: "VINTED AND BOTTLED BY STONE'S THROW CELLARS, WALLA WALLA, WA",
      warning: WARNING,
      bg: "#f2e9e4",
      accent: "#5b3a5e",
    }),
  },
  {
    file: "title-case-warning.png",
    svg: labelSvg({
      brand: "SILVER RIDGE",
      classType: "Vodka",
      abvText: "40% Alc./Vol. (80 Proof)",
      netText: "750 mL",
      bottlerText: "DISTILLED AND BOTTLED BY SILVER RIDGE DISTILLING CO., BOISE, ID",
      warning: TITLE_CASE_WARNING,
      bg: "#eef1f4",
      accent: "#32556e",
    }),
  },
  {
    file: "wrong-abv.png",
    svg: labelSvg({
      brand: "COPPER CREEK",
      classType: "Straight Rye Whiskey",
      abvText: "40% Alc./Vol. (80 Proof)", // application will say 45%
      netText: "750 mL",
      bottlerText: "DISTILLED AND BOTTLED BY COPPER CREEK DISTILLERY, DENVER, CO",
      warning: WARNING,
      bg: "#f3ead8",
      accent: "#7a4b21",
    }),
  },
  {
    file: "missing-warning.png",
    svg: labelSvg({
      brand: "HARBOR LIGHT",
      classType: "India Pale Ale",
      abvText: "6.5% Alc./Vol.",
      netText: "12 FL OZ",
      bottlerText: "BREWED AND BOTTLED BY HARBOR LIGHT BREWING CO., PORTLAND, ME",
      warning: null,
      bg: "#e9f0e6",
      accent: "#3f6b3a",
    }),
  },
  {
    file: "reworded-warning.png",
    svg: labelSvg({
      brand: "JUNIPER & PINE",
      classType: "London Dry Gin",
      abvText: "47% Alc./Vol. (94 Proof)",
      netText: "750 mL",
      bottlerText: "DISTILLED AND BOTTLED BY JUNIPER & PINE DISTILLERY, SEATTLE, WA",
      warning: REWORDED_WARNING,
      bg: "#eaf0ef",
      accent: "#2e5f5c",
    }),
  },
  {
    file: "wrong-net-contents.png",
    svg: labelSvg({
      brand: "BLACKWATER BAY",
      classType: "Spiced Rum",
      abvText: "35% Alc./Vol. (70 Proof)",
      netText: "375 mL", // application will say 750 mL
      bottlerText: "BOTTLED BY BLACKWATER BAY RUM CO., SAVANNAH, GA",
      warning: WARNING,
      bg: "#efe6f0",
      accent: "#5e3a6e",
    }),
  },
  {
    file: "wrong-brand.png",
    svg: labelSvg({
      brand: "EAGLE HOLLOW", // application will say EAGLE HARBOR
      classType: "Blended Canadian Whisky",
      abvText: "40% Alc./Vol. (80 Proof)",
      netText: "750 mL",
      bottlerText: "IMPORTED BY EAGLE HARBOR IMPORTS, BUFFALO, NY",
      originText: "PRODUCT OF CANADA",
      warning: WARNING,
      bg: "#f0ece2",
      accent: "#6e5a2e",
    }),
  },
  {
    file: "proof-only.png",
    svg: labelSvg({
      brand: "CARTWRIGHT & SONS",
      classType: "Tennessee Whiskey",
      abvText: "90 PROOF", // no percentage printed — proof = 2 x ABV
      netText: "750 mL",
      bottlerText: "DISTILLED AND BOTTLED BY CARTWRIGHT & SONS, LYNCHBURG, TN",
      warning: WARNING,
      bg: "#f1e8da",
      accent: "#8a5a2e",
    }),
  },
  {
    file: "unit-mismatch-cl.png",
    svg: labelSvg({
      brand: "VIGNETO DEL SOLE",
      classType: "Pinot Grigio",
      abvText: "12.5% Alc./Vol.",
      netText: "75 cl", // application will say 750 mL — same volume
      bottlerText: "PRODUCED AND BOTTLED BY VIGNETO DEL SOLE WINERY, HEALDSBURG, CA",
      warning: WARNING,
      bg: "#eef2e6",
      accent: "#5a7a3a",
    }),
  },
  {
    file: "unbolded-warning.png",
    svg: labelSvg({
      brand: "MERIDIAN PASS",
      classType: "Straight Bourbon Whiskey",
      abvText: "43% Alc./Vol. (86 Proof)",
      netText: "750 mL",
      bottlerText: "DISTILLED AND BOTTLED BY MERIDIAN PASS DISTILLERY, OGDEN, UT",
      warning: WARNING,
      // Wording and capitals are exact — only the bold heading is missing,
      // probing whether the vision model can judge type weight.
      warningHeadingBold: false,
      bg: "#f0e9e0",
      accent: "#7a3a3a",
    }),
  },
  {
    file: "typo-warning.png",
    svg: labelSvg({
      brand: "NORTH FORK",
      classType: "Single Malt Whiskey",
      abvText: "46% Alc./Vol. (92 Proof)",
      netText: "750 mL",
      bottlerText: "DISTILLED AND BOTTLED BY NORTH FORK DISTILLERY, BOZEMAN, MT",
      warning: TYPO_WARNING, // "impares" — single-letter misprint
      bg: "#ece9f0",
      accent: "#4a3a6e",
    }),
  },
  {
    file: "dropped-word-warning.png",
    svg: labelSvg({
      brand: "RED LANTERN",
      classType: "Amber Lager",
      abvText: "5.2% Alc./Vol.",
      netText: "12 FL OZ",
      bottlerText: "BREWED AND BOTTLED BY RED LANTERN BREWING CO., DULUTH, MN",
      warning: DROPPED_WORD_WARNING, // missing "may"
      bg: "#f2e8e0",
      accent: "#a0522d",
    }),
  },
  {
    file: "swapped-words-warning.png",
    svg: labelSvg({
      brand: "QUARRY ROCK",
      classType: "Blanco Tequila",
      abvText: "40% Alc./Vol. (80 Proof)",
      netText: "750 mL",
      bottlerText: "IMPORTED BY QUARRY ROCK SPIRITS, EL PASO, TX",
      originText: "PRODUCT OF MEXICO",
      warning: SWAPPED_WORDS_WARNING, // drive/operate transposed
      bg: "#e6eef0",
      accent: "#2e6e6a",
    }),
  },
  {
    file: "no-bottler.png",
    svg: labelSvg({
      brand: "GLACIER PEAK",
      classType: "American Dry Gin",
      abvText: "42% Alc./Vol. (84 Proof)",
      netText: "750 mL",
      // No bottler/importer statement — required on every label, so the
      // presence check flags this for review.
      warning: WARNING,
      bg: "#e8eef2",
      accent: "#3a5a7a",
    }),
  },
];

await mkdir(OUT_DIR, { recursive: true });
for (const sample of SAMPLES) {
  const png = await sharp(Buffer.from(sample.svg)).png().toBuffer();
  await writeFile(path.join(OUT_DIR, sample.file), png);
  console.log(`wrote ${sample.file} (${(png.length / 1024).toFixed(0)} kB)`);
}
