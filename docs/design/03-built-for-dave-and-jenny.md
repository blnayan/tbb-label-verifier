# Built for Dave *and* Jenny

> "We need something my mother could figure out… Half our team is over 50.
> Clean, obvious, no hunting for buttons." — Sarah Chen

The user base spans a 28-year veteran who prints his emails and a junior
agent who could have built the tool herself. The design target is the
veteran; the test is that the power user never feels slowed down.

## Principles applied

**One screen, one decision.** No navigation, no settings, no onboarding.
Two tabs — *Single label* and *Batch upload* — and each tab has exactly one
primary action, rendered as the biggest button on the screen with a verb on
it ("Verify label"). If a user can find the button, they know what to do.

**The workflow mirrors the paper checklist.** Jenny literally keeps a
printed checklist: brand — check, ABV — check, warning — check. The report
is that checklist, rendered: each field gets a row with *what the
application says*, *what the label says*, and a plain-English note. Nothing
to interpret, nothing to learn — it's the mental model they already have.

**Status is words + icons, never color alone.** "Pass", "Needs review",
"Issues found", "Can't read label" — each with a distinct icon. Color
supports the message but never carries it (some of any 47-person team is
colorblind). The labels avoid jargon: "Can't read label" rather than
"low-confidence extraction".

**No silent magic.** Every value the AI read is shown next to the value it
was compared against. Trust for someone like Dave isn't built by accuracy
claims; it's built by the tool showing its work so he can catch it being
wrong — and finding that it isn't.

**Forgiveness over precision in inputs.** "45", "45%", "13.5" all parse;
file picking works by click, drag, or paste; a batch CSV with two bad rows
runs the other 298 and reports the bad ones by line number. Errors are
written as instructions ("Alcohol content must be a number — got 'forty
five'"), not as codes.

**Speed serves usability.** A 3-second response keeps attention; the
skeleton state and per-row queue status make waiting legible. Jenny's
power-user path — load sample, verify, next — has zero friction; Dave's
careful path has zero surprises.

## What was deliberately left out

Dark-mode toggles, configuration panels, confidence sliders, per-field
overrides. Every knob is a thing to explain to 47 people. The prototype's
opinion: the tool should have *fewer* decisions than the paper checklist it
replaces, not more.
