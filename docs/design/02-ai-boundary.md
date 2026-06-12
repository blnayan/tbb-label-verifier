# The AI boundary: transcribe, don't judge

The single most important line in this system is the one between the model and the rules. The vision model answers exactly one question — *"what is physically printed on this label?"* — and deterministic TypeScript answers the other — *"does that comply?"*.

## Why not just ask the model "does this label match?"

It would work impressively in a demo and fail as a product:

1. **Compliance needs receipts.** A rejection letter has to say *what* was wrong. "The model said no" is not a finding; "warning text deviates from 27 CFR 16.21 at 'should avoid'" is. Rules produce findings natively.
2. **Exactness is a rules problem.** A title-case "Government Warning" must fail every single time, by policy, forever. An LLM judgment is probabilistic exactly where the requirement is absolute. A string comparison is absolute exactly where the requirement is absolute.
3. **Nuance is a rules problem too** — once you've seen it. A display-caps "STONE'S THROW vs Stone's Throw" is not AI judgment territory; it's a normalization rule (case- and punctuation-insensitive comparison → "close match, review"). Encoding it as a rule means it behaves identically on label one and label ten thousand.
4. **Tests.** The entire compliance surface is unit-tested — 118 tests covering the statutory text, fraction ABVs, unit conversions, and the real-world edge cases. You cannot unit-test a vibe.

## What the model is genuinely needed for

Reading. Labels arrive as photographs — curved bottles, glare, angled shots, decorative typefaces. That perception problem is exactly what a vision model solves and what 2003-era OCR could not. The extraction prompt leans into it: transcribe verbatim, preserve case and punctuation, *never autocorrect the warning to what it should say*, and report your own uncertainty (`readability`, `imageQualityNotes`) instead of guessing.

That last instruction matters most. A model's instinct is to be helpful and complete the familiar statutory text; we explicitly want the unhelpful, literal reading — the typo is the finding.

Prompting alone does not buy that literal reading, though — it has a resolution floor. Measured (2026-06-12): a 900px render with a planted "impares" was read as the statutory "impairs" in 0/32 attempts across every prompt framing, including "spell it letter by letter" — below the size where letters are resolvable, the encoder hands the language prior a word shape and the prior fills it in, exactly like a human skim-reading. Two countermeasures, both measured: small images are lanczos-upscaled to 1800px before extraction (same input tokens, ~75% faithful reads), and the prompts instruct the model to re-verify each long warning word letter by letter after transcribing ("a transcription containing a misspelling is often the correct answer"), which lifted the catch rate further. On the planted-typo eval sample the combination took the false-pass rate from 16/16 to 0/24.

## The reader is a noisy sensor — no verdict rests on one read

A single transcription is one sample from a noisy sensor (measured: condensed "APPELLATION" garbles about half the time; an arc-wrapped "Surgeon General," loses its comma about as often), and the noise is biased in both directions: it garbles compliant labels toward failure, and it normalizes deviating warnings toward compliance. So neither auto-verdict rests on one read:

- **Comparison fields** (brand, class, ABV, …) about to fail get a *primed* focused re-read that sees the application's claim — that is what lets it recover text the blind pass garbled.
- **The government warning** gets a *blind* re-read that sees nothing — the model knows the statutory text by heart, so priming there invites normalizing a deviating label back to compliance. It runs in parallel with the first read on every label, because both verdicts need it. On a failing warning it is the stability check: the same deviation twice means it is printed on the label and the failure stands; disagreement means the transcription is unstable and a human decides. On a passing warning it is the normalization check: the warning auto-passes only when both independent reads agree on it, because a single read that "matches" may be the prior autocompleting a misprint (measured: a planted "impares" auto-approved 16/16 before this check). Punctuation, spacing, and boldness wobble between honest reads of the same label, so only word-level disagreement challenges a pass.

One invariant governs all of it: **a second read can only move a label toward review, never toward pass.** Agreement with the application is grounds for human eyes, not for trusting a read that was given (or knows) the answer.

## The contract

`LabelExtraction` (a typed, zod-validated schema) is the only thing that crosses the boundary. Consequences:

- The model is swappable by env var; the rules don't know it exists.
- The rules are auditable by a compliance officer who has never heard of an LLM.
- When the system is wrong, the failure is legible: either the transcription is wrong (visible in the report's "On label" column) or a rule is wrong (fixable with a failing test first).
