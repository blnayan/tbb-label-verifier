# TTB Label Verifier

AI-assisted verification of alcohol beverage labels against COLA application data, built as a prototype for the TTB Compliance Division.

An agent enters what the application says (brand name, class/type, alcohol content, net contents, the bottler/producer/importer's name and address — required, as it is on TTB F 5100.31 — and whether the product is imported, which requires its country of origin), adds the label image, and submits — including a word-for-word check of the mandatory government health warning (27 CFR part 16). A batch mode verifies a CSV of applications plus their label images in parallel (columns: `filename`, `brandName`, `classType`, `alcoholPercent`, `netContents`, `bottlerNameAddress`, plus optional `imported` (yes/no) and `countryOfOrigin` — required when `imported` is yes). Every verification lands on the **Verifications** page (persisted in the browser's IndexedDB), grouped by review status: clean passes are auto-approved and rule failures auto-rejected, while ambiguous results queue for a manual approve/reject decision made on each verification's own full-screen report page — the label image center stage, the application on its left, the field-by-field findings on its right, all in one viewport. A single upload opens its report the moment the verdict lands, and reviewing is a session: Back/Next step through the records of the tab the reviewer came from, and an approve/reject advances to the next waiting record automatically. Decisions can be revisited, and a guarded clear-history action wipes the record.

**How it works in one sentence:** an OpenAI vision model *transcribes* the label into structured JSON; deterministic TypeScript rules *decide* pass/fail. The AI never makes a compliance judgment — see [ARCHITECTURE.md](ARCHITECTURE.md).

## Quick start

Requirements: Node.js 20+ and an OpenAI API key.

```bash
npm install
cp .env.example .env.local   # set OPENAI_API_KEY and OPENAI_MODEL
npm run dev
```

Open http://localhost:3000, pick **“Try a sample label…”**, and press **Upload**. Or switch to **Batch upload** and press **Load sample batch**. Results stream into the **Verifications** page live.

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | yes | — | Auth for the OpenAI API (label extraction). |
| `OPENAI_MODEL` | yes | none, deliberately | Vision model used for extraction. There is no default and no fallback — one explicitly chosen model, swappable without a code change; the app refuses to verify until it is set. `gpt-5.4-mini` measured best: it reads real-label fine print reliably and came back faster than `gpt-5.4-nano`. |
| `OPENAI_REASONING_EFFORT` | no | unset (the API's own default applies) | Reasoning effort for the extraction call. Transcription needs no deliberation, so the lowest value the model tier accepts is right: `none` exists from gpt-5.1, while gpt-5.5 bottoms out at `low`. |

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on :3000 |
| `npm run build` / `npm start` | Production build / serve |
| `npm test` | Unit tests (Vitest) — rule engine, input validation, CSV parsing, concurrency pool, IndexedDB history |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `node scripts/generate-samples.mjs` | Regenerate the synthetic sample labels |
| `node scripts/generate-photo-variants.mjs` | Regenerate the photo-condition variants of real labels |
| `node scripts/eval-samples.mjs` | Live end-to-end eval: verifies every sample against its hand-checked expected verdict (start the dev server first). Results render at `/eval-dashboard.html`; exits 1 on a regression. |

## Sample dataset

`public/samples/` contains thirty-eight labels: **twenty-one real labels** (beer, wine, spirits, imports — twenty from TTB's public COLA registry plus a brewery's keg-collar artwork; each paired with application data transcribed from the label, and one — Bärenjäger — with the entries from its actual application form), **two of those re-rendered under simulated photo conditions** (tilt, glare, blur) to exercise robustness, and fifteen synthetic labels each encoding a compliance scenario (case-only brand differences, a title-case government warning, a warning heading without bold type, a wrong ABV, a missing/reworded warning, three near-miss warning misprints — a one-letter typo, a dropped word, and two swapped words — that probe whether the reader normalizes them away, wrong net contents, a wrong brand on an imported whisky, a proof-only statement, a cl-vs-mL unit difference, a missing bottler statement). Every sample's expected verdict is stated in its description and validated against the live pipeline. See [public/samples/SOURCES.md](public/samples/SOURCES.md).

## Deployment (Docker, any VPS)

The app is a single stateless container — no database, no volumes.

```bash
docker build -t tbb-label-verifier .
docker run -d --name label-verifier \
  -p 3000:3000 \
  -e OPENAI_API_KEY=sk-... \
  -e OPENAI_MODEL=gpt-5.4-mini \
  --restart unless-stopped \
  tbb-label-verifier
```

Put your usual reverse proxy (Caddy/nginx/Traefik) in front for TLS. The container exposes port 3000 and needs outbound HTTPS to `api.openai.com` only.

## Documentation

| Document | Contents |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System design and the reasoning behind each decision |
| [ASSUMPTIONS.md](ASSUMPTIONS.md) | Everything assumed that the requirements didn't spell out |
| [docs/design/](docs/design/) | Design philosophy, one file per principle |

## Approach, tools, trade-offs (summary)

- **Stack:** Next.js 16 (App Router) + TypeScript + Tailwind v4 + shadcn/ui; GPT-5.4 mini via the official OpenAI SDK with structured outputs (zod-validated); Vitest. One deployable, no database.
- **Core trade-off:** the AI is confined to transcription; all pass/fail logic is deterministic, unit-tested TypeScript (246 tests). This makes compliance behavior auditable and lets the model be swapped via env var.
- **Latency:** fastest vision-capable model + two parallel API calls per label (full extraction + a blind warning re-read — the warning auto-passes only when both agree) keeps verification inside the ~5s budget; batch mode runs four labels concurrently.
- **Known limitations** are listed at the end of [ASSUMPTIONS.md](ASSUMPTIONS.md) — notably: country of origin is checked only for products marked imported, one image per label, and an uncertain bold-type read (null) never penalizes a label.
