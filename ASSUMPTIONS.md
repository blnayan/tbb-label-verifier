# Assumptions

Everything below was assumed because the requirements didn't spell it out.
Each entry says what was assumed, and why that reading was chosen.

## Scope of verification

1. **Five fields are checked, not the full mandatory set.** The brief lists
   seven common mandatory elements, but the "Sample Label Fields" section
   defines the concrete data the app receives: brand name, class/type,
   alcohol content, net contents, and the government warning. Those five are
   what the prototype verifies. Bottler name/address and country of origin
   are extracted-adjacent (the model sees them) but not compared, because
   the application-side data model in the brief doesn't include them.
   Adding a field is one entry in the extraction schema plus one rule.

2. **The application data is keyed in by the agent (or supplied via CSV).**
   Marcus was explicit that this prototype must not integrate with COLA, so
   there is no application lookup — the agent supplies what the application
   says, mirroring their current screen-to-screen comparison workflow.

3. **One image per label application.** Real COLAs often attach front and
   back labels separately. The prototype verifies a single image; if the
   warning is on the back label, the agent verifies the image that carries
   it (or a combined image). Multi-image applications are a known extension,
   not a core requirement of the brief.

4. **English-language labels.** TTB requires mandatory information in
   English; verifying foreign-language supplementary text is out of scope.

## Compliance interpretations (validated against ttb.gov / eCFR)

5. **The government warning must match 27 CFR 16.21 word-for-word.** The
   statutory text embedded in the rule engine was checked against the CFR.
   Whitespace and line breaks are tolerated (labels wrap text); any word
   difference is a failure, matching Jenny's "it has to be exact".

6. **"GOVERNMENT WARNING" must be in capital letters** (27 CFR 16.22(a)).
   A title-case heading is an automatic failure — this exact scenario is in
   the sample dataset because Jenny caught one last month.

7. **Bold type on the heading is required by regulation but reported as
   advisory.** Whether type is "bold" cannot be judged reliably from a
   photograph (lighting, rendering, font weight ambiguity), so a
   possibly-not-bold heading downgrades the result to "Needs review" with a
   note telling the agent to verify visually, rather than auto-failing.
   False rejections would erode trust faster than asking a human to look.

8. **Type-size and characters-per-inch rules (16.22(b)) are not checked.**
   Physical measurements can't be derived from an uncalibrated photo. TTB
   itself adds a qualification to COLAs saying it has not reviewed type
   size — the responsible industry member must ensure it. Same boundary
   here.

9. **Brand-name comparison is case- and punctuation-insensitive, with
   transparency.** Dave's "STONE'S THROW vs Stone's Throw" example is
   treated as a close match: flagged for review with an explanatory note,
   never silently passed and never auto-failed. Substantive word differences
   fail.

10. **ABV must match the application exactly** (no tolerance beyond float
    rounding). TTB tolerances govern label-vs-product, not
    label-vs-application. Proof is accepted as a fallback (proof = 2 × ABV),
    and when a label prints both by-weight and by-volume percentages, the
    by-volume figure is the ABV.

11. **Net contents are compared by volume, not by string.** "75 cl" vs
    "750 mL" is the same quantity — that passes with a note rather than
    failing. Standard-of-fill validation (whether 750 mL is an authorized
    size) is out of scope.

## Product decisions

12. **The AI never decides pass/fail.** The model transcribes; deterministic
    rules decide. This is the central design decision — reasoning in
    [ARCHITECTURE.md](ARCHITECTURE.md) and
    [docs/design/02-ai-boundary.md](docs/design/02-ai-boundary.md).

13. **Claude Haiku 4.5 is the default model.** Sarah's 5-second requirement
    is a hard product constraint ("nobody's going to use it"), and label
    transcription is a narrow task the fastest vision model handles well.
    `ANTHROPIC_MODEL` overrides it without a code change.

14. **No accounts, no persistence.** Marcus: "we're not storing anything
    sensitive for this exercise." Images are processed in memory and
    discarded; results live only in the browser session. This also keeps
    the deployment a single stateless container.

15. **Batch pairing is by filename.** A CSV column names each image file.
    This matches how bulk submissions arrive in practice (a spreadsheet plus
    a folder of artwork) and keeps the server stateless — the browser
    orchestrates the queue, four labels at a time.

16. **Batch size is bounded by patience, not the app.** 300 labels × ~3s at
    concurrency 4 ≈ 4 minutes, comfortably inside Sarah's peak-season
    scenario. Rows with bad data are skipped with line-numbered errors
    instead of aborting the batch.

17. **"AI-generated" sample labels are AI-designed and programmatically
    rendered** (SVG → PNG via `scripts/generate-samples.mjs`) rather than
    diffusion-generated images — this gives pixel-exact control over the
    error each sample encodes (you can't reliably ask an image model for "a
    label whose warning text is subtly reworded"). Real labels come from
    TTB's public COLA registry per the brief's pointer to ttb.gov; sources
    in [public/samples/SOURCES.md](public/samples/SOURCES.md).

## Known limitations (deliberate trade-offs)

- Five checked fields, not the full mandatory set (see #1).
- One image per application (see #3).
- Bold detection is advisory; type-size rules unchecked (see #7, #8).
- The "same field of vision" placement rule (brand name, class/type, and
  alcohol content must be viewable simultaneously) is not verified from a
  single photo.
- No retry/queue persistence: refreshing mid-batch loses client-side
  progress. Acceptable for a prototype; a job store is the production fix.
- Extraction quality is bounded by the model; the readability field and
  image-quality notes are the honesty valve — bad photos are flagged
  "Can't read label" rather than guessed at.
