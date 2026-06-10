# Architecture

## System overview

```
┌──────────────────────────── Browser ────────────────────────────┐
│                                                                  │
│  Single label view                Batch view                     │
│  (form + image + report)          (CSV + images + queue table)   │
│         │                              │                         │
│         │ downscale image (≤1568px)    │ parse CSV, pair files   │
│         │                              │ pool: 4 concurrent      │
│         └──────────────┬───────────────┘                         │
└────────────────────────┼─────────────────────────────────────────┘
                         │  POST /api/verify (multipart, 1 label)
┌────────────────────────┼─────────────────────────────────────────┐
│  Next.js server        ▼                                         │
│   route.ts ── validate input (input.ts)                          │
│      │                                                           │
│      ▼                                                           │
│   verify.ts ── orchestrator                                      │
│      │                                                           │
│      ├─► extract.ts ──► OpenAI (GPT-5.4 mini, vision +           │
│      │                  zod structured output)                   │
│      │       returns LabelExtraction (verbatim transcription)    │
│      │                                                           │
│      └─► rules.ts ──► deterministic comparisons                  │
│              returns field results + overall verdict             │
└──────────────────────────────────────────────────────────────────┘
```

One request per label. No database, no queue, no session state.

## The load-bearing decision: AI transcribes, rules decide

The pipeline is split into two stages with a typed contract
(`LabelExtraction`) between them:

1. **Extraction** (`src/lib/verification/extract.ts`) — the vision model
   reads the image and returns verbatim transcriptions: brand name as
   printed, the complete alcohol statement, the warning text exactly as it
   appears (explicitly instructed *not* to autocorrect it to the statutory
   wording), plus readability and image-quality observations. Structured
   outputs with a zod schema make the response shape guaranteed-parseable.

2. **Rules** (`src/lib/verification/rules.ts`) — pure TypeScript compares the
   extraction against the application: statutory-text matching for the
   warning, caps check on the heading, normalized comparison for brand and
   class/type, unit-aware parsing for ABV (%, proof, by-weight vs by-volume,
   fractions) and net contents (mL/cL/L/fl oz).

Why this split, rather than asking the model "does this label match?":

- **Auditability.** "Why did this fail?" must have a deterministic answer
  for a compliance tool. Every verdict traces to a rule you can read and a
  transcription you can see on screen.
- **Testability.** The compliance behavior is 78 unit tests that run in
  milliseconds with no API key. An end-to-end AI judgment can't be tested
  without live calls and tolerance for nondeterminism.
- **The failure modes match the staff.** Dave doesn't trust black boxes —
  and he's right not to. When the tool is wrong it's either a transcription
  error (visible: the "On label" column shows what the model read) or a rule
  bug (fixable, testable). There is no "the AI just decided differently
  today."
- **Model independence.** The model is a swappable transcriber
  (`OPENAI_MODEL` env var), not the owner of the compliance logic.

The same reasoning drives the trust UI: every field shows *expected*,
*found*, and *why*, so the agent confirms in seconds instead of re-doing the
work.

## Decisions and reasoning

### Next.js App Router, single deployable
The app is one screen plus one API endpoint. A separate backend would add a
deployment, CORS, and shared-type plumbing for zero benefit at this scope.
Next.js gives the API route, static sample assets, and the React UI in one
stateless container — which also keeps the FedRAMP-flavored conversation
simple if this ever moves toward a government environment.

### GPT-5.4 mini with structured outputs
Sarah's interview sets a hard product constraint: ~5 seconds or agents fall
back to eyeballing. The default was chosen by measuring, not by spec sheet:
gpt-5.4-nano is billed as the lowest-latency vision model, but live testing
showed it misreads the fine-print government warning on real labels (0/4
stable on a real TTB photo) *and* returns no faster than mini in practice
(~3.1–3.5s vs mini's ~2.3–3.2s). gpt-5.4-mini reads the same label 4/4.
Reasoning effort is pinned to "none" — transcription needs no deliberation,
and "none" measured ~1s faster than "low" with identical output. Structured
outputs (zod schema, validated by the SDK) remove an entire class of
parse-and-retry failure. The choice lives in one env var — model swaps are a
config change, not a refactor.

### Latency budget, end to end
- Client downscales images to ≤1568px before upload (the API would downscale
  anyway — shrinking client-side saves upload time and tokens, the two
  costs we control).
- One model call per label; no chained calls, no thinking mode.
- Measured extraction time is shown in the report (`extractionMs`), so the
  5-second claim is continuously visible rather than asserted.

### Batch = N × single, orchestrated by the browser
The batch endpoint *is* the single endpoint, called four-at-a-time by a
small client-side pool. Reasons:

- Each label is independent — there's nothing for the server to coordinate.
- The server stays stateless: nothing to persist, restart, or scale beyond
  HTTP.
- Per-label progress, retries, and partial failure fall out naturally — a
  bad row or a failed call affects one row in the table, never the batch.
- 300 labels (Sarah's peak-season number) ≈ 4 minutes at concurrency 4,
  with the queue visibly draining.

The trade-off: a closed tab abandons an in-flight batch. For a prototype
that's acceptable; the production path is a server-side job store, which
this architecture doesn't preclude.

### No database
Nothing requires persistence: no accounts (per Marcus), results are
ephemeral by design, samples are static files. Every piece of state the app
needs lives in the request or the browser. This was a deliberate
subtraction — a prototype with a database is a prototype with migrations,
backups, and PII questions.

### Hand-rolled CSV parser and promise pool (no dependencies)
Both are ~60 lines, fully unit-tested, and the alternative is a dependency
with 100× the surface area. The CSV parser handles the RFC-4180 cases that
actually occur in brand names (quoted commas, escaped quotes, CRLF).

### shadcn/ui (base-nova), extended rather than overridden
Components are vendored source, so status semantics were added properly:
`success`/`warning` variants on Badge and Alert backed by CSS tokens in
`globals.css`, instead of scattering color classNames. Status is always
icon + text, never color alone — half the team is over 50, and some
percentage of any team is colorblind.

## Module map

| Path | Responsibility |
| --- | --- |
| `src/lib/verification/types.ts` | Domain types; the extraction/rules contract |
| `src/lib/verification/extract.ts` | OpenAI vision call, zod schema, prompt |
| `src/lib/verification/rules.ts` | All compliance logic (pure, tested) |
| `src/lib/verification/verify.ts` | Orchestrator: extract → rules |
| `src/lib/verification/input.ts` | Request validation (pure, tested) |
| `src/lib/verification/batch.ts` | CSV parsing (pure, tested) |
| `src/lib/client/pool.ts` | Browser-side concurrency pool (tested) |
| `src/lib/client/downscale.ts` | Canvas downscale before upload |
| `src/app/api/verify/route.ts` | HTTP shell: validate → verify → typed errors |
| `src/components/verifier/*` | Single view, batch view, shared report panel |
| `scripts/generate-samples.mjs` | Synthetic sample-label generator |

## Testing strategy

TDD on every pure module: rule engine (including the regulatory edge cases
from the interviews), input validation, CSV parsing, and the concurrency
pool — 78 tests, no network. The AI boundary is deliberately thin and typed;
the route handler is glue. The sample dataset doubles as a live end-to-end
suite: each sample's description states its expected verdict, so a reviewer
can validate the whole pipeline from the UI in two minutes.

## What production would add

Multi-image applications, the remaining mandatory fields, a server-side job
store for batches, authentication/audit logging, and COLA integration — none
of which require changing the extraction/rules split at the core.
