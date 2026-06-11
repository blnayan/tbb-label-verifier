# Sample dataset sources

## Generated labels (AI-designed, rendered by `scripts/generate-samples.mjs`)

`old-tom-clean.png`, `stones-throw-case.png`, `title-case-warning.png`,
`wrong-abv.png`, `missing-warning.png`, `reworded-warning.png`,
`wrong-net-contents.png`, `wrong-brand.png`, `proof-only.png`,
`unit-mismatch-cl.png`, `no-bottler.png` are synthetic labels for fictional
brands. Each encodes a specific compliance scenario (case-only brand
differences, a title-case government warning, an ABV mismatch, a missing
warning, a reworded warning, wrong net contents, a wrong brand name on an
imported Canadian whisky, a proof-only alcohol statement, a cl-vs-mL unit
difference, a missing bottler statement). Regenerate with
`node scripts/generate-samples.mjs`.

## Photo-condition variants (real labels, simulated photography)

`photo-austerum-red.jpg` and `photo-victoria-beer.jpg` are real TTB label
images re-rendered under
simulated hand-held photo conditions (tilt, shear, glare, uneven lighting,
blur, lossy re-encoding) to exercise verification robustness. Regenerate
with `node scripts/generate-photo-variants.mjs`.

## Real labels (TTB public COLA registry)

All are label images from approved Certificate of Label Approval
applications, downloaded from TTB's public COLA registry
(https://ttbonline.gov/colasonline/publicSearchColasBasic.do):

| File | TTB ID | Brand (as printed) |
| --- | --- | --- |
| `real-mb-liquors-vodka.jpg` | 18305001000808 | MB LIQUORS |
| `real-iprandi-soave.jpg` | 15173001000487 | i PRANDI |
| `real-european-standard-vodka.png` | 25221001000045 | EUROPEAN STANDARD |
| `real-zhenjiu-baijiu.png` | 25225001000521 | ZHENJIU·ZHEN 15 |
| `real-victoria-beer.jpg` | 14251001000304 | Victoria |
| `real-mastri-birrai-ipa.jpg` | 25335001000692 | MASTRI BIRRAI UMBRI |
| `real-tsarine-champagne.jpg` | 25064001000113 | TSARINE |
| `real-mouton-rothschild.png` | 25223001000361 | CHATEAU MOUTON ROTHSCHILD |
| `real-zd-wines-cabernet.jpg` | 26099001000822 | ZD WINES® |
| `real-austerum-red.jpg` | 25142001000678 | Austerum |
| `real-house-of-harvey-sparkling.jpg` | 25203001000469 | Thee House of Harvey |
| `real-sentada-white.jpg` | 26021001000663 | SENTADA |
| `real-valle-etrusca-rosso.jpg` | 26089001000028 | Rosso Toscana |
| `real-garaudet-monthelie.jpg` | 25332001000182 | GARAUDET PERE ET FILS |
| `real-charlie-henri-pinot.jpg` | 26089001000026 | CHARLIE et HENRI |
| `real-beaumes-de-venise.jpg` | 25116001000011 | François Xavier Lambert |
| `real-jack-daniels-rye.jpg` | 25052001000168 | JACK DANIEL'S (Single Barrel Rye) |
| `real-four-loko-shot.jpg` | 24152001000126 | FOUR LOKO (Shot, front panel) |

The application data paired with each real label in `manifest.json` was
transcribed from the label itself (brand, class/type, ABV, net contents),
so each verifies as Pass or Needs review — except `real-four-loko-shot.jpg`, which is the front panel of a wrap-around label whose government warning is printed on the back, so it intentionally verifies as Issues found.

COLA label images are public records published by the U.S. Treasury's
Alcohol and Tobacco Tax and Trade Bureau. They are included here solely as
test fixtures for a label-verification prototype.
