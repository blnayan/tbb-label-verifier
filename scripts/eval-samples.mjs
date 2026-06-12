/**
 * Live eval over every sample in public/samples/manifest.json.
 *
 * Each sample is POSTed to /api/verify and the result is compared against a
 * hand-checked expectation (every label image was reviewed against its
 * application data and the rule engine in src/lib/verification/rules.ts).
 *
 * Usage:
 *   node scripts/eval-samples.mjs [--base http://localhost:3000] [--concurrency 4]
 *
 * Exit code 1 if any hard expectation is violated (regression), 0 otherwise.
 * Flaky samples (photo-condition renders) report violations as warnings only.
 */

import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const SAMPLES_DIR = path.join(ROOT, "public", "samples")

const args = process.argv.slice(2)
const argValue = (flag, fallback) => {
  const i = args.indexOf(flag)
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback
}
const BASE = argValue("--base", "http://localhost:3000")
const CONCURRENCY = Number(argValue("--concurrency", "4"))
/** --only id1,id2 restricts the run; --repeat N runs each selected sample N times. */
const ONLY = argValue("--only", "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
const REPEAT = Number(argValue("--repeat", "1"))
/** Results land here so /eval-dashboard.html can render them. */
const OUT = argValue("--out", path.join(ROOT, "public", "eval-results.json"))

/**
 * Expected outcomes per sample id.
 *
 *   overall      — verdicts that count as correct.
 *   fields       — per-field statuses that must hold when the verdict is in
 *                  `overall` (pins WHY a sample passes/fails, not just that
 *                  it does).
 *   allowedFailing — for fail-expected samples: the only fields permitted to
 *                  be mismatch/not_found. Any other failing field means the
 *                  extraction broke something unrelated.
 *   flaky        — violations are warnings, not regressions (photo renders
 *                  that deliberately probe the readability boundary).
 *
 * Status vocabulary: match | close_match | mismatch | not_found | not_checked
 * Verdicts: pass | needs_review | fail | unreadable
 */
const EXPECTATIONS = {
  // --- clean matches -------------------------------------------------------
  "old-tom-clean": {
    overall: ["pass"],
    note: "Everything matches verbatim; heading clearly bold.",
  },
  "proof-only": {
    overall: ["fail"],
    fields: { alcoholContent: ["mismatch"] },
    allowedFailing: ["alcoholContent"],
    note: "Proof alone is non-compliant — the percent-ABV statement is mandatory (user ruling 2026-06-12).",
  },

  // --- real labels: pass, or needs_review on styling/perception ------------
  "real-mb-liquors": {
    overall: ["pass", "needs_review"],
    note: "Model sometimes reads the serif heading as not bold (close_match).",
  },
  "real-iprandi-soave": { overall: ["pass", "needs_review"] },
  "real-valle-etrusca-rosso": {
    overall: ["pass", "needs_review"],
    note: "Importer line breaks drop the comma → close_match likely.",
  },
  "real-garaudet-monthelie": { overall: ["pass", "needs_review"] },
  "real-charlie-henri-pinot": { overall: ["pass", "needs_review"] },
  "real-beaumes-de-venise": { overall: ["pass", "needs_review"] },
  "real-european-standard-vodka": {
    overall: ["pass", "needs_review"],
    note: "Low-res crown label; tiny warning text.",
  },
  "real-zhenjiu-baijiu": {
    overall: ["pass", "needs_review"],
    note: "PLAINVIEW,NEW YORK missing space → close_match on name/address.",
  },
  "real-victoria-beer": { overall: ["pass", "needs_review"] },
  "real-mastri-birrai-ipa": { overall: ["pass", "needs_review"] },
  "real-tsarine-champagne": { overall: ["pass", "needs_review"] },
  "real-mouton-rothschild": { overall: ["pass", "needs_review"] },
  "real-zd-wines-cabernet": {
    overall: ["pass", "needs_review"],
    note: "Class printed in caps within the title line → close_match likely. 5.4-mini sometimes transcribes the condensed '(2) CONSUMPTION' without its space — spacing-only divergence is close_match by rule (verified on the image: the space is printed).",
  },
  "real-austerum-red": { overall: ["pass", "needs_review"] },
  "real-house-of-harvey-sparkling": {
    overall: ["pass", "needs_review"],
    flaky: true,
    note: "KNOWN-HARD: the condensed 'APPELLATION' is printed correctly (verified by zoom) but blind reads misread it ~half the time. Near-miss rule catches small garbles; the focused second read recovers the rest (measured 4/4 in-band) — a fail now means both reads missed, which the flaky flag surfaces as a warning.",
  },
  "real-sentada-white": { overall: ["pass", "needs_review"] },
  "real-jack-daniels-rye": {
    overall: ["pass", "needs_review"],
    note: "QUESTIONABLE SAMPLE: the back label never prints the brand standalone — watch what the model returns for brandName.",
  },

  // --- real labels: needs_review by construction ---------------------------
  "real-barenjager-honey": {
    overall: ["needs_review"],
    note: "App types BARENJAGER / 50 MILLILITERS vs label Bärenjäger / 50ML — diacritic and unit styling are close matches, never failures.",
  },

  // --- real labels: must fail, and only on the expected fields -------------
  "real-brouwerij-ipa": {
    overall: ["needs_review", "fail"],
    fields: { governmentWarning: ["close_match", "mismatch"] },
    allowedFailing: ["governmentWarning"],
    note: "Genuinely deviating warning (missing comma after 'machinery' + ABILIITY misprint), but the reader itself normalizes ABILIITY→ABILITY in most reads, so the misprint is not stable evidence — when only the comma survives transcription, the punctuation band (2026-06-12) queues it for review instead of auto-rejecting. fail only when a read reports ABILIITY and the blind stability re-read reproduces it. Never a silent pass. 20 LITER net contents is on the collar — gpt-5-mini previously missed it.",
  },
  "real-stillwater-debutante": {
    overall: ["pass", "needs_review"],
    fields: { governmentWarning: ["match", "close_match"] },
    flaky: true,
    note: "User-ruled COMPLIANT (2026-06-11): the arc-printed warning is fully correct (zoom-verified) and the class line contains Ale. The reader's habitual comma drop on the curve is now deterministically a punctuation-band close_match (2026-06-12), so a warning FAIL here is a regression, not flakiness. Still flagged flaky for the other known miss: the checkbox net contents occasionally returns null.",
  },
  "real-four-loko-shot": {
    overall: ["fail"],
    fields: { governmentWarning: ["not_found"] },
    allowedFailing: ["governmentWarning"],
    note: "Front panel only — the warning lives on the back panel.",
  },

  // --- photo-condition renders ---------------------------------------------
  "photo-austerum-red": {
    overall: ["pass", "needs_review"],
    flaky: true,
    note: "Deliberately probes the misread boundary — occasional fail is documented behavior.",
  },
  "photo-victoria-beer": { overall: ["pass", "needs_review"] },

  // --- generated needs_review cases ----------------------------------------
  "stones-throw-case": {
    overall: ["pass"],
    fields: { brandName: ["match"] },
    note: "Caps-only difference on the brand is a full match (user ruling 2026-06-12).",
  },
  "unit-mismatch-cl": {
    overall: ["needs_review"],
    fields: { netContents: ["close_match"] },
    note: "75 cl = 750 mL.",
  },
  "unbolded-warning": {
    overall: ["needs_review", "pass"],
    fields: { governmentWarning: ["close_match", "match"] },
    note: "Not-bold heading queues for review (close_match); a null bold judgment is not penalized (pass).",
  },

  // --- generated must-fail cases -------------------------------------------
  "wrong-abv": {
    overall: ["fail"],
    fields: { alcoholContent: ["mismatch"] },
    allowedFailing: ["alcoholContent"],
  },
  "missing-warning": {
    overall: ["fail"],
    fields: { governmentWarning: ["not_found"] },
    allowedFailing: ["governmentWarning"],
  },
  "reworded-warning": {
    overall: ["fail"],
    fields: { governmentWarning: ["mismatch"] },
    allowedFailing: ["governmentWarning"],
  },
  "wrong-net-contents": {
    overall: ["fail"],
    fields: { netContents: ["mismatch"] },
    allowedFailing: ["netContents"],
  },
  "wrong-brand": {
    overall: ["fail"],
    fields: { brandName: ["mismatch"] },
    allowedFailing: ["brandName"],
  },
  "no-bottler": {
    overall: ["fail"],
    fields: { nameAddress: ["not_found"] },
    allowedFailing: ["nameAddress"],
  },
  "title-case-warning": {
    overall: ["fail"],
    fields: { governmentWarning: ["mismatch"] },
    allowedFailing: ["governmentWarning"],
  },
}

const MEDIA_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
}

async function verifySample(sample) {
  const imagePath = path.join(SAMPLES_DIR, path.basename(sample.image))
  const bytes = await readFile(imagePath)
  const mediaType = MEDIA_TYPES[path.extname(imagePath).toLowerCase()]

  const form = new FormData()
  form.set(
    "image",
    new Blob([bytes], { type: mediaType }),
    path.basename(imagePath)
  )
  const app = sample.application
  form.set("brandName", app.brandName)
  form.set("classType", app.classType)
  form.set("alcoholPercent", String(app.alcoholPercent))
  form.set("netContents", app.netContents)
  form.set("bottlerNameAddress", app.bottlerNameAddress)
  if (app.countryOfOrigin) form.set("countryOfOrigin", app.countryOfOrigin)

  const started = Date.now()
  const res = await fetch(`${BASE}/api/verify`, { method: "POST", body: form })
  const ms = Date.now() - started
  const body = await res.json()
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${body.error ?? "unknown error"}`)
  }
  return { result: body, ms }
}

const FAILING = new Set(["mismatch", "not_found"])

function judge(sample, result) {
  const exp = EXPECTATIONS[sample.id]
  const problems = []
  if (!exp) {
    return { problems: [`no expectation defined for "${sample.id}"`], exp: null }
  }

  if (!exp.overall.includes(result.overall)) {
    problems.push(
      `overall "${result.overall}" not in expected [${exp.overall.join(", ")}]`
    )
  }

  const byField = Object.fromEntries(result.fields.map((f) => [f.field, f]))
  for (const [field, allowed] of Object.entries(exp.fields ?? {})) {
    const actual = byField[field]?.status ?? "(absent)"
    if (!allowed.includes(actual)) {
      problems.push(
        `${field} is "${actual}" — expected [${allowed.join(", ")}]`
      )
    }
  }

  if (exp.allowedFailing) {
    for (const f of result.fields) {
      if (FAILING.has(f.status) && !exp.allowedFailing.includes(f.field)) {
        problems.push(
          `unexpected failing field ${f.field} (${f.status}): ${f.note ?? ""} [found: ${JSON.stringify(f.found)}]`
        )
      }
    }
  }

  return { problems, exp }
}

async function main() {
  const manifest = JSON.parse(
    await readFile(path.join(SAMPLES_DIR, "manifest.json"), "utf8")
  )
  let samples = manifest.singles
  if (ONLY.length) {
    samples = samples.filter((s) => ONLY.includes(s.id))
    const unknown = ONLY.filter((id) => !samples.some((s) => s.id === id))
    if (unknown.length) {
      console.error(`Unknown sample id(s): ${unknown.join(", ")}`)
      process.exit(1)
    }
  }
  samples = samples.flatMap((s) => Array.from({ length: REPEAT }, () => s))

  const missing = samples.filter((s) => !EXPECTATIONS[s.id]).map((s) => s.id)
  const orphaned = Object.keys(EXPECTATIONS).filter(
    (id) => !samples.some((s) => s.id === id)
  )
  if (missing.length) console.warn(`⚠ no expectations for: ${missing.join(", ")}`)
  if (orphaned.length) console.warn(`⚠ orphaned expectations: ${orphaned.join(", ")}`)

  console.log(
    `Evaluating ${samples.length} samples against ${BASE} (concurrency ${CONCURRENCY})\n`
  )

  async function evalOnce(sample) {
    try {
      const { result, ms } = await verifySample(sample)
      const { problems, exp } = judge(sample, result)
      return { sample, result, ms, problems, flaky: exp?.flaky ?? false }
    } catch (error) {
      return {
        sample,
        result: null,
        ms: 0,
        problems: [`request failed: ${error.message}`],
        flaky: false,
      }
    }
  }

  const rows = []
  let cursor = 0
  async function worker() {
    while (cursor < samples.length) {
      const sample = samples[cursor++]
      let r = await evalOnce(sample)
      // Models are nondeterministic: a hard failure only counts as a
      // regression when it reproduces. One retry; the failed attempt is
      // kept (superseded) so the dashboard shows both.
      if (r.problems.length > 0 && !r.flaky) {
        rows.push({ ...r, superseded: true })
        r = { ...(await evalOnce(sample)), retried: true }
      }
      rows.push(r)
      const status =
        r.problems.length === 0
          ? r.retried
            ? "~"
            : "✓"
          : r.flaky
            ? "~"
            : "✗"
      const overall = r.result ? r.result.overall : "ERROR"
      const suffix = r.retried
        ? r.problems.length
          ? " (failed twice)"
          : " (passed on retry)"
        : ""
      console.log(
        `${status} ${sample.id.padEnd(32)} ${overall.padEnd(12)} ${String(r.ms).padStart(5)}ms${suffix}`
      )
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  const finals = rows.filter((r) => !r.superseded)
  const hard = finals.filter((r) => r.problems.length > 0 && !r.flaky)
  const soft = finals.filter(
    (r) => (r.problems.length > 0 && r.flaky) || (r.retried && r.problems.length === 0)
  )
  const clean = finals.length - hard.length - soft.length
  const timings = rows.filter((r) => r.ms > 0).map((r) => r.ms)
  const slowest = Math.max(...timings)
  const median = timings.sort((a, b) => a - b)[Math.floor(timings.length / 2)]
  const over5s = rows.filter((r) => r.ms > 5000)

  console.log(`\n${"─".repeat(72)}`)
  console.log(
    `\n${clean}/${rows.length} ok, ${soft.length} flaky-warn, ${hard.length} regression(s)` +
      ` | median ${median}ms, slowest ${slowest}ms, >5s: ${over5s.length}`
  )
  if (over5s.length) {
    console.log(`  over budget: ${over5s.map((r) => `${r.sample.id} (${r.ms}ms)`).join(", ")}`)
  }

  for (const r of [...hard, ...soft]) {
    const tag =
      r.problems.length === 0
        ? "FLAKE (failed once, passed on retry)"
        : r.flaky
          ? "FLAKY (warning only)"
          : "REGRESSION (reproduced on retry)"
    console.log(`\n${tag}: ${r.sample.id}`)
    const detail =
      r.problems.length > 0
        ? r
        : rows.find((x) => x.superseded && x.sample.id === r.sample.id)
    if (!detail) continue
    for (const p of detail.problems) console.log(`  - ${p}`)
    if (detail.result) {
      for (const f of detail.result.fields) {
        if (FAILING.has(f.status) || f.status === "close_match") {
          console.log(
            `    ${f.field}: ${f.status} | found: ${JSON.stringify(f.found)}`
          )
        }
      }
    }
  }

  // Dump everything the dashboard needs: manifest order, one entry per
  // sample, all runs (repeats) kept.
  const order = manifest.singles.map((s) => s.id)
  const byId = new Map()
  for (const r of rows) {
    if (!byId.has(r.sample.id)) byId.set(r.sample.id, [])
    byId.get(r.sample.id).push(r)
  }
  const report = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    model: rows.find((r) => r.result)?.result.model ?? null,
    partial: ONLY.length > 0,
    samples: order
      .filter((id) => byId.has(id))
      .map((id) => {
        const runs = byId.get(id)
        const sample = runs[0].sample
        return {
          id,
          name: sample.name,
          description: sample.description,
          image: sample.image,
          application: sample.application,
          expectation: EXPECTATIONS[id] ?? null,
          runs: runs.map((r) => ({
            ok: r.problems.length === 0,
            flaky: r.flaky,
            superseded: r.superseded ?? false,
            retried: r.retried ?? false,
            problems: r.problems,
            ms: r.ms,
            result: r.result,
          })),
        }
      }),
  }
  await writeFile(OUT, JSON.stringify(report, null, 2))
  console.log(`\nResults written to ${path.relative(ROOT, OUT)} — view at ${BASE}/eval-dashboard.html`)

  process.exit(hard.length > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
