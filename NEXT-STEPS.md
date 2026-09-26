# Where PileBuild stands (26 Sep 2026)

Live: https://hampshire33.github.io/LOGO/ with the AI reader on
(https://pilebuild-ai.hampshire333a.workers.dev, check /v1/health/anything).

Working rule with the owner: announce anything slow or costly first, with an estimate, and
wait for a go-ahead before spending API credit. API credit: about $5 prepaid, auto-reload off.

## Done
- Identification: Claude reads the photo (prompt v6, compact answers), parts checked against the
  Rebrickable catalogue. Sonnet 5 by default (~1-3 cents a read), Opus 5.5 as "Precise read",
  tiles only with "Lots of small pieces". Cost shown after every read. See EVAL-RESULTS.md.
- Building: car/house/tree/animal designs from the photo, fitted to owned parts; flat picture.

## Next, in order
1. Measure prompt v6: Actions > Evaluate identification (Sonnet, per_kind 2, ~$0.50). Compare
   with EVAL-RESULTS.md (v5 Sonnet: part+colour 47/18/34/33%). If v6 is worse, restore v5 wording.
2. Real photos with hand-counted truth in eval/private/truth.json (not in the repo).
3. Big piles: two readings of dense tiles, keep the counts they agree on.
4. Building part: Claude-designed 3D models from the parts list and target photo on the public
   site (a /v1/design endpoint on the worker, same safety rules as /v1/identify-tile).
