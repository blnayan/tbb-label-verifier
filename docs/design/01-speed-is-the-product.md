# Speed is the product

> "If we can't get results back in about 5 seconds, nobody's going to use
> it. We learned that the hard way." — Sarah Chen

The previous vendor's tool didn't fail on accuracy — it failed because 30–40
seconds per label lost a race against a human eyeball. Agents can verify a
simple label manually in well under a minute, so the tool's entire value
proposition lives inside a ~5 second window. We treated that as a hard
budget and spent it deliberately:

| Budget item | Decision |
| --- | --- |
| Model inference | Haiku 4.5 — the fastest vision-capable Claude model. Extraction is transcription, not reasoning; paying Opus latency here buys nothing. |
| Upload time | Images are downscaled in the browser to 1568px before upload. The API would discard the extra pixels anyway; we just stop paying to ship them. |
| Round trips | Exactly one model call per label. No OCR-then-LLM chains, no follow-up calls, no thinking mode. |
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
