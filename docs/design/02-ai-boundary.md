# The AI boundary: transcribe, don't judge

The single most important line in this system is the one between the model
and the rules. Claude answers exactly one question — *"what is physically
printed on this label?"* — and deterministic TypeScript answers the other —
*"does that comply?"*.

## Why not just ask the model "does this label match?"

It would work impressively in a demo and fail as a product:

1. **Compliance needs receipts.** A rejection letter has to say *what* was
   wrong. "The model said no" is not a finding; "warning text deviates from
   27 CFR 16.21 at 'should avoid'" is. Rules produce findings natively.
2. **Exactness is a rules problem.** Jenny's title-case "Government
   Warning" must fail every single time, by policy, forever. An LLM
   judgment is probabilistic exactly where the requirement is absolute. A
   string comparison is absolute exactly where the requirement is absolute.
3. **Nuance is a rules problem too** — once you've seen it. Dave's
   "STONE'S THROW vs Stone's Throw" is not AI judgment territory; it's a
   normalization rule (case- and punctuation-insensitive comparison →
   "close match, review"). Encoding it as a rule means it behaves
   identically on label one and label ten thousand.
4. **Tests.** The entire compliance surface is unit-tested — 78 tests
   covering the statutory text, fraction ABVs, unit conversions, the
   interview edge cases. You cannot unit-test a vibe.

## What the model is genuinely needed for

Reading. Labels arrive as photographs — curved bottles, glare, angled
shots, decorative typefaces. That perception problem is exactly what a
vision model solves and what 2003-era OCR could not. The extraction prompt
leans into it: transcribe verbatim, preserve case and punctuation, *never
autocorrect the warning to what it should say*, and report your own
uncertainty (`readability`, `imageQualityNotes`) instead of guessing.

That last instruction matters most. A model's instinct is to be helpful and
complete the familiar statutory text; we explicitly want the unhelpful,
literal reading — the typo is the finding.

## The contract

`LabelExtraction` (a typed, zod-validated schema) is the only thing that
crosses the boundary. Consequences:

- The model is swappable by env var; the rules don't know it exists.
- The rules are auditable by a compliance officer who has never heard of
  an LLM.
- When the system is wrong, the failure is legible: either the
  transcription is wrong (visible in the report's "On label" column) or a
  rule is wrong (fixable with a failing test first).
