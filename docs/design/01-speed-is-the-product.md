# Speed is the product

If results take longer than about 5 seconds, nobody uses the tool — the
division learned that the hard way. A previous vendor's tool didn't fail
on accuracy; it failed because 30–40 seconds per label lost a race against
a human eyeball. Agents can verify a simple label manually in well under a
minute, so the tool's entire value proposition lives inside a ~5 second
window. We treated that as a hard budget and spent it deliberately:

| Budget item | Decision |
| --- | --- |
| Model inference | GPT-5.4 mini with reasoning effort "none" — chosen by measurement, not by spec sheet: nano is billed as fastest but misread real-label fine print and returned slower; mini reads it reliably in ~2-3s. Extraction is transcription, not reasoning; paying frontier-model latency here buys nothing. |
| Upload time | Images ship exactly as the user provided them — a browser-side resample + JPEG re-encode measurably degrades fine print (it flipped a real label's government warning from reliable match to misread and auto-rejected a compliant label), and that risk buys nothing on typical files. The one exception: a file over the server's 10MB limit is shrunk client-side, because that beats rejecting the upload. |
| Round trips | Two parallel model calls per label — the full extraction and a blind re-read of just the government warning (the warning auto-passes only when two independent reads agree; see [02-ai-boundary.md](02-ai-boundary.md)). Parallel means the second call costs no wall-clock — and moving it up front from the fail path made failing labels ~1s faster. No OCR-then-LLM chains, no thinking mode; only a label about to auto-fail on a comparison field pays a sequential third call, the focused re-read of the disputed fields. |
| Image size | Small images (<1600px) are lanczos-upscaled server-side to 1800px before extraction — measured: identical input tokens, ~50ms of CPU, and fine print goes from word-shape guessing to letter-accurate (0/12 → ~75% faithful reads of a planted typo). Large photos pass through byte-for-byte. |
| Parse failures | Structured outputs (zod schema) — the response is valid by construction, so there is no retry-on-bad-JSON tax. |
| Batch wait | Four labels verified concurrently; the queue drains visibly so waiting feels like progress, not silence. |

Two supporting choices keep the budget honest:

- **The timer is in the UI.** Every report shows its extraction time. If a
  deployment or model change blows the budget, the user sees it before we
  hear about it.
- **Speed never overrides honesty.** A fast wrong answer is worse than a
  slow right one. When an image can't be read reliably, the answer is
  "Can't read label — request a better photo" in two seconds, not a
  confident guess in two seconds.

The non-obvious consequence: speed dictated the *model* but not the
*architecture*. Because the AI is confined to transcription
(see [02-ai-boundary.md](02-ai-boundary.md)), upgrading to a slower, more
accurate model — or a faster future one — is an environment variable, not a
redesign.
