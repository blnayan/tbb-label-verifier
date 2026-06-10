# TTB Label Verifier

AI-assisted verification of alcohol beverage labels against COLA application
data, built as a take-home prototype for the TTB Compliance Division.

An agent enters what the application says (brand name, class/type, alcohol
content, net contents), adds the label image, and gets a field-by-field
report in a few seconds — including a word-for-word check of the mandatory
government health warning (27 CFR part 16). A batch mode verifies a CSV of
applications plus their label images in parallel.

**How it works in one sentence:** an OpenAI vision model *transcribes* the
label into structured JSON; deterministic TypeScript rules *decide*
pass/fail. The AI never makes a compliance judgment — see
[ARCHITECTURE.md](ARCHITECTURE.md).

## Quick start

Requirements: Node.js 20+ and an OpenAI API key.

```bash
npm install
cp .env.example .env.local   # then put your OPENAI_API_KEY in .env.local
npm run dev
```

Open http://localhost:3000, pick **“Try a sample label…”**, and press
**Verify label**. Or switch to **Batch upload** and press
**Load sample batch**.

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | yes | — | Auth for the OpenAI API (label extraction). |
| `OPENAI_MODEL` | no | `gpt-5.4-mini` | Vision model used for extraction. Chosen by live measurement: reads real-label fine print reliably and came back faster than `gpt-5.4-nano`. |
| `OPENAI_REASONING_EFFORT` | no | `none` | Reasoning effort for the extraction call — transcription needs no deliberation. Set to `low` for model tiers that don't accept `none` (e.g. gpt-5.5). |

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on :3000 |
| `npm run build` / `npm start` | Production build / serve |
| `npm test` | Unit tests (Vitest) — rule engine, input validation, CSV parsing, concurrency pool |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `node scripts/generate-samples.mjs` | Regenerate the synthetic sample labels |
| `node scripts/generate-photo-variants.mjs` | Regenerate the photo-condition variants of real labels |

## Sample dataset

`public/samples/` contains thirty labels: **eighteen real approved labels
from TTB's public COLA registry** (beer, wine, spirits, imports — each
paired with application data transcribed from the label), **two of those
re-rendered under simulated photo conditions** (tilt, glare, blur) to
exercise robustness, and ten synthetic labels each encoding a compliance
scenario (case-only brand differences, a title-case government warning, a
wrong ABV, a missing/reworded warning, wrong net contents, wrong brand, a
proof-only statement, a cl-vs-mL unit difference). Every sample's expected
verdict is stated in its description and validated against the live
pipeline. See [public/samples/SOURCES.md](public/samples/SOURCES.md).

## Deployment (Docker, any VPS)

The app is a single stateless container — no database, no volumes.

```bash
docker build -t tbb-label-verifier .
docker run -d --name label-verifier \
  -p 3000:3000 \
  -e OPENAI_API_KEY=sk-... \
  --restart unless-stopped \
  tbb-label-verifier
```

Put your usual reverse proxy (Caddy/nginx/Traefik) in front for TLS. The
container exposes port 3000 and needs outbound HTTPS to
`api.openai.com` only.

## Documentation

| Document | Contents |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System design and the reasoning behind each decision |
| [ASSUMPTIONS.md](ASSUMPTIONS.md) | Everything assumed that the requirements didn't spell out |
| [docs/design/](docs/design/) | Design philosophy, one file per principle |

## Approach, tools, trade-offs (summary)

- **Stack:** Next.js 16 (App Router) + TypeScript + Tailwind v4 + shadcn/ui;
  GPT-5.4 mini via the official OpenAI SDK with structured outputs
  (zod-validated); Vitest. One deployable, no database.
- **Core trade-off:** the AI is confined to transcription; all pass/fail
  logic is deterministic, unit-tested TypeScript (78 tests). This makes
  compliance behavior auditable and lets the model be swapped via env var.
- **Latency:** fastest vision-capable model + client-side image downscaling
  + one API call per label keeps verification inside the ~5s budget; batch
  mode runs four labels concurrently.
- **Known limitations** are listed at the end of
  [ASSUMPTIONS.md](ASSUMPTIONS.md) — notably: five checked fields (not the
  full mandatory set), one image per label, and bold-type detection is
  advisory because it can't be judged reliably from a photo.
