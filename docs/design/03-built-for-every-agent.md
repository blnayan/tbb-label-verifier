# Built for every agent

The user base spans 28-year veterans with little patience for new tools and junior agents who could have built the tool themselves — and half the team is over 50. The design bar is clean, obvious, no hunting for buttons. The design target is the veteran; the test is that the power user never feels slowed down.

## Principles applied

**Two destinations, one decision.** The navbar holds exactly two links — *Upload* and *Verifications* — no settings, no onboarding. Upload has two tabs — *Single label* and *Batch upload* — and each tab has exactly one primary action, rendered as the biggest button on the screen with a verb on it ("Upload"). If a user can find the button, they know what to do.

**The workflow mirrors the paper checklist.** Agents literally keep a printed checklist: brand — check, ABV — check, warning — check. The report is that checklist, rendered: each field gets a row with *what the application says*, *what the label says*, and a plain-English note. Nothing to interpret, nothing to learn — it's the mental model they already have.

**Status is words + icons, never color alone.** "Pass", "Needs review", "Issues found", "Can't read label" — each with a distinct icon. Color supports the message but never carries it (some of any 47-person team is colorblind). The labels avoid jargon: "Can't read label" rather than "low-confidence extraction".

**No silent magic.** Every value the AI read is shown next to the value it was compared against. Trust for a veteran agent isn't built by accuracy claims; it's built by the tool showing its work so they can catch it being wrong — and finding that it isn't.

**Forgiveness over precision in inputs.** "45", "45%", "13.5" all parse; file picking works by click, drag, or paste; a batch CSV with two bad rows runs the other 298 and reports the bad ones by line number. Errors are written as instructions ("Alcohol content must be a number, but got 'forty five'"), not as codes.

**Speed serves usability.** A 3-second response keeps attention; the skeleton state and per-row queue status make waiting legible. The power user's path — load sample, verify, next — has zero friction; the careful veteran's path has zero surprises.

## What was deliberately left out

Dark-mode toggles, configuration panels, confidence sliders, per-field overrides. Every knob is a thing to explain to 47 people. The prototype's opinion: the tool should have *fewer* decisions than the paper checklist it replaces, not more.
