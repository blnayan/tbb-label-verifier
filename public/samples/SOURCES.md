# Sample dataset sources

## Generated labels (AI-designed, rendered by `scripts/generate-samples.mjs`)

`old-tom-clean.png`, `stones-throw-case.png`, `title-case-warning.png`,
`wrong-abv.png`, `missing-warning.png`, `reworded-warning.png` are synthetic
labels for fictional brands. Each encodes a specific compliance scenario from
the stakeholder interviews (case-only brand differences, a title-case
government warning, an ABV mismatch, a missing warning, a reworded warning).
Regenerate with `node scripts/generate-samples.mjs`.

## Real labels (TTB public COLA registry)

Both are label images from approved Certificate of Label Approval
applications, downloaded from TTB's public COLA registry
(https://ttbonline.gov/colasonline/publicSearchColasBasic.do):

| File | TTB ID | Brand |
| --- | --- | --- |
| `real-mb-liquors-vodka.jpg` | 18305001000808 | MB LIQUORS (vodka specialty, CA) |
| `real-iprandi-soave.jpg` | 15173001000487 | I PRANDI BY MARCATO (Soave, Italy) |

COLA label images are public records published by the U.S. Treasury's
Alcohol and Tobacco Tax and Trade Bureau. They are included here solely as
test fixtures for a label-verification prototype.
