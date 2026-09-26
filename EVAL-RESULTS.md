# Identification results

Measured with `tools/eval/run.cjs` on test photos with known contents (2 per scene kind,
seeds 100-101, real LEGO colours, phone-like noise and blur). Scores are overlap F1 between
found and true pieces: 100% means every piece found with nothing extra. Count error is the
average absolute difference in total pieces. Repeat runs vary by several points: read
differences under ~5 points as noise.

## History (26 Sep 2026)

| Step | Spread | Heap | Carpet | Dense |
|---|---|---|---|---|
| **Offline detector** (colour blobs): count error | 10% | 37% | 64% | 100% (found nothing) |
| Offline detector: part numbers | none | none | none | none |
| **Claude Sonnet 5, prompt v3**: count error / part+colour | 10% / 30% | 21% / 18% | 8% / 16% | 67% / 26% |
| + v4: scan in bands, colour-in-shadow guidance | 4% / 38% | 14% / 14% | 4% / 24% | 67% / 25% |
| + fixed 2x2 tiles (dropped: hurt heaps, 3x cost) | 3% / 31% | 23% / 22% | 14% / 21% | 52% / 28% |
| + adaptive tiling (only when the pile fills the frame) | 7% / 38% | 22% / 15% | 7% / 17% | 49% / 32% |
| + v5: report shape and studs, part number derived | 7% / 47% | 25% / 18% | 10% / 34% | 52% / 33% |
| **Claude Opus 5.5, prompt v5** (current default) | **4% / 91%** | **13% / 60%** | **8% / 78%** | **34% / 46%** |

Opus 5.5 with v5, other scores: colour only 95% / 86% / 95% / 78%; part only 94% / 75% / 85% / 65%.

Cost on this bench (8 photos): Sonnet 5 about 7 US cents a photo, Opus 5.5 about 23 cents
(at $2/$10 and $4/$20 per million input/output tokens).

## Real photos (10 user photos, no exact truth)

With Opus 5.5 and v5 every photo returned a plausible parts list (the offline detector
returned nothing for 8 of them): correct part types on the 2x4-brick, 2x2-brick and
1x2-brick photos, minifigure parts on the minifigure pile, and colour mixes that match.
Counting is the limit: a 415 px photo of a ~1,500-piece heap gave 57 pieces, and a 640 px
full-frame pile gave an implausibly high 860. Small web images of big piles cannot be
counted piece by piece; sharp phone photos are read in tiles and count far better.

## What to try next

- Two readings of dense tiles with different crops, keeping counts they agree on.
- A per-piece listing (one line per piece with its position) for piles under ~60 pieces.
- Real photos with hand-counted truth in `eval/private/truth.json` (kept out of the repo).
