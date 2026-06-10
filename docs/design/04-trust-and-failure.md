# Trust and failure: the tool that knows what it doesn't know

A compliance tool earns adoption by how it behaves when things go wrong —
bad photos, bad CSVs, flaky networks, ambiguous matches. The design rule
throughout: **never guess silently, never fail loudly without a next step.**

## A four-state verdict, not a boolean

`pass / needs_review / fail / unreadable` — because the honest answer space
isn't binary:

- **Pass** — every check matched exactly. Safe to move on.
- **Needs review** — the tool found something a human should glance at
  (case-only brand difference, possibly-unbold heading, partially readable
  photo). The tool says *what* and *why*; the human spends ten seconds, not
  ten minutes.
- **Issues found** — a deterministic rule failed; the note cites the exact
  divergence ("Label shows 40% — application says 45%").
- **Can't read label** — the honesty valve. If the model reports the image
  unreadable (or not an alcohol label at all), no checks are run and the
  recommendation is the workflow agents already use: request a better
  image. Jenny asked for tolerance of imperfect photos; tolerance includes
  knowing when to stop.

The asymmetry is deliberate: anything mechanical that's clearly wrong
*fails*, anything requiring judgment *escalates to the human*. The tool
removes the data-entry half of the job (Sarah: "my agents spend half their
day doing what's essentially data entry verification") and explicitly keeps
the judgment half human.

## Failure handling by layer

| Failure | Behavior |
| --- | --- |
| Wrong file type / oversized / empty image | Rejected before any model call, with the fix in the message ("use JPEG, PNG, WebP, or GIF"). |
| Malformed CSV row | That row is skipped and reported with its line number; the rest of the batch runs. A missing column fails fast with the expected header list. |
| Image filename in CSV but not uploaded | Row marked "Image file not uploaded" — visible, not fatal. |
| AI service down / rate limited | Typed errors mapped to plain English, marked retryable; one label's failure never poisons the batch. |
| Missing API key | Caught at the route boundary with an operator-facing message, not a 500 stack trace. |
| Model returns the *wrong reading* | The report shows the transcription next to the expectation — the disagreement is visible to the agent, which is the last line of defense any OCR-class system needs. |

## Why transparency is the trust strategy

Dave has watched modernization projects fail since 2008, and his skepticism
is rational: tools that hide their reasoning get blamed for every
disagreement. This tool's bet is the opposite of "trust me":

- every verdict shows its inputs (expected vs. found, verbatim),
- every rule's behavior is documented and unit-tested,
- every response shows how long the AI took,
- and the AI's own uncertainty (readability, glare, angle notes) is
  surfaced, not smoothed over.

The goal is not for agents to believe the tool. It's for agents to be able
to *check* the tool faster than they could do the work — and let the
checking habit decay into trust at their own pace. That's also why the
verdict vocabulary stops at "needs review": the tool never pretends to a
certainty it doesn't have.
