# Architecture

## System overview

```
┌──────────────────────────── Browser ────────────────────────────┐
│  Sidebar dashboard: an Upload page that only uploads, a          │
│  Verifications page where every verification is worked           │
│                                                                  │
│  Single label upload              Batch upload                   │
│  (form + image)                   (CSV + images + progress)      │
│         │                              │                         │
│         │ downscale image (≤1568px)    │ parse CSV, pair files   │
│         │                              │ pool: 4 concurrent      │
│         ├──────────────┬───────────────┤                         │
│         ▼              │               ▼                         │
│   IndexedDB history (history.ts): result + image blob + review   │
│   state. Pass ⇒ auto-approved, fail ⇒ auto-rejected; ambiguity  │
│   queues on /verifications for a manual decision (revisitable)   │
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

One request per label. No server-side database, queue, or session state;
verification history persists in the browser's IndexedDB.

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

### Upload and review are separate jobs
The Upload page only uploads: submitting frees the form immediately for the
next label, and the verdict is announced in a toast; the full report is
never shown inline. Every verification lands on the Verifications page
carrying a review state, derived from the rule verdict: **pass ⇒
auto-approved** and **fail ⇒ auto-rejected** — the deterministic rules
already did that work — while genuine ambiguity (**needs review /
unreadable**) waits in a queue until an agent records an approve/reject
decision. Every decision, automatic or manual, is revisitable and
changeable.

Each verification gets its own report page (`/verifications/[id]`) rather
than a dialog — reviewing is the core job, so it gets the whole screen,
literally: the page steps outside the dashboard shell (no sidebar) and fits
everything in one viewport. The label image sits center stage sized to the
screen, the application (what the label must show) on its left, and what
was read off the label — each field with its match status — on its right,
with Approve/Reject in the header. A long panel scrolls internally; the
page itself never scrolls, so the agent compares image, application, and
findings without losing sight of any of them.

The Verifications page is live: it subscribes to history changes (local
listeners in-tab, a BroadcastChannel across tabs) and to the in-flight
upload registry (`src/lib/client/uploads.ts`), so results stream in from
either upload flow without a reload. In-flight uploads show as a live
strip above the tabs — ambient status visible from any tab, gone when
idle — rather than a tab of their own, because "verifying" is a transient
condition, not a review status a record can hold. They are deliberately
in-memory, not persisted — a reload aborts the underlying request, so a
persisted "verifying" row would spin forever.

Records group by review status — Needs review / Approved /
Rejected / All — because that is the one axis on which every record has
exactly one value, so the tabs are mutually exclusive and their counts add
up. One consolidated Status column tells the story per row: a pending
record shows the rule verdict (the *reason* it waits), a decided record
shows the decision and how it was made, and an "Override" marker flags the
audit-critical case where a human contradicted the rules. This mirrors how
the compliance team actually works: clerks feed the queue, reviewers work
it.

### No server database — history lives in the browser
Nothing requires server-side persistence: no accounts (per Marcus), samples
are static files, and the server stays a stateless container. Results,
however, are worth keeping: every completed verification (the result JSON,
the exact downscaled image the model saw, and its review state) is saved to
IndexedDB (`src/lib/client/history.ts`), surviving refreshes and restarts on
that device. The store's primary key is an auto-incremented sequence, so
insertion order *is* chronological order; a unique index on the record id
supports review-decision updates, and versioned migrations backfill and
upgrade review states without touching manual decisions (tested). A guarded "Clear history" action deletes everything. This
keeps the migrations/backups/PII questions out of the prototype while still
giving agents a workable queue; the production path is the same server-side
job store mentioned above.

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
| `src/lib/client/history.ts` | IndexedDB history + review states + change events (tested) |
| `src/lib/client/uploads.ts` | In-memory in-flight upload registry (tested) |
| `src/app/api/verify/route.ts` | HTTP shell: validate → verify → typed errors |
| `src/app/(dashboard)/*` | Sidebar shell; Upload (`/`) and Verifications (`/verifications`) pages |
| `src/components/verifier/*` | Upload views, review queue, full-page review report |
| `scripts/generate-samples.mjs` | Synthetic sample-label generator |

## Testing strategy

TDD on every pure module: rule engine (including the regulatory edge cases
from the interviews), input validation, CSV parsing, the concurrency pool,
and the IndexedDB history layer with its review states and schema migration
(against `fake-indexeddb`) — 171 tests, no network. The AI boundary is deliberately thin and typed;
the route handler is glue. The sample dataset doubles as a live end-to-end
suite: each sample's description states its expected verdict, so a reviewer
can validate the whole pipeline from the UI in two minutes.

## What production would add

Multi-image applications, the remaining mandatory fields, a server-side job
store for batches, authentication/audit logging, and COLA integration — none
of which require changing the extraction/rules split at the core.
