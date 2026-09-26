---
name: lego-build
description: Brick-by-brick LEGO assembly animation in the style of an official instruction booklet. Everything is drawn in code on Canvas 2D (no images, no 3D engine) and rendered to mp4, vertical 1080x1920 or horizontal 1920x1080. A model is a list of steps made of real LEGO parts (BrickLink part numbers and colours); each step shows its parts list, new parts get a yellow outline, and the finished model spins at the end. Use when asked to build something out of LEGO as an animation or video, make LEGO instructions, a clip where a cat, robot, logo or any object assembles from bricks, or design a LEGO model from a picture or description. Second mode turns a photo into a LEGO Art style mosaic of 1x1 round and square tiles on black plates, with a parts list, build map and a build video. Use for "make me out of LEGO", "LEGO portrait from photo", "LEGO mosaic".
---

# lego-build

The engine draws LEGO parts on Canvas 2D in the look of a paper instruction booklet: light top faces, thin dark edges, new parts outlined in yellow, earlier steps faded. A model is a list of steps; the ready-made script turns it into a video with a parts list, step number, falling parts and a final spin.

The core rule: a model uses only real parts in colours that were actually produced, with no invented prints.

## What's in the folder

- `src/lego.js` engine, library of 47 parts and 16 colours.
- `src/booklet.js` video script, vertical and horizontal.
- `src/models/cat.js` example model, a ginger cat in 106 parts. `src/models/microduck.js` second example, a mini robot.
- `src/parts-sheet.js` catalogue page of every part.
- `index.html` player. Space or click pauses, arrows step frames. Parameters `?model=cat`, `?format=horizontal`, `?t=12`, `?view=parts`.
- `src/mosaic.js` photo to mosaic, `src/mosaic-film.js` mosaic drawing and build video, `mosaic.html` the same in the browser, `tools/mosaic.cjs` from the command line.
- `tools/check-model.cjs` model check, `tools/snap.cjs` single frames to PNG, `tools/render.cjs` video to mp4, `tools/parts-md.cjs` parts reference.
- `reference/modeling.md` how to design a model. Read it before your first model.
- `reference/parts.md` table of parts and colours.

## Setup

Copy the skill folder into the project's working folder and work in the copy. Needs Node.js 18+ and ffmpeg on PATH, or its path in the `FFMPEG` variable.

```bash
npm install
npx playwright install chromium
node tools/check-model.cjs cat
node tools/render.cjs --model cat
```

Done when the cat check is green and `exports/cat.mp4` opens showing the cat assembling step by step. To preview without rendering, open `index.html` in a browser.

## Making a video of a new object

1. **Brief.** Ask what to build and which orientation the video needs. Decide the rest yourself and say what you decided. Done when the object fits in one sentence.
2. **Sketch.** Draw the model on a grid from the front and from above. Pick a size, a palette from `reference/parts.md` and the parts that carry the shape. Done when the layers are clear and you know where the face or key feature is.
3. **Part check.** For every part + colour pair open `https://www.bricklink.com/catalogColors.asp?itemType=P&itemNo=<number>` and confirm the colour is listed. If not, change the colour or the part. Done when every pair is confirmed and the check date is in the model header.
4. **Model.** Copy `src/models/cat.js` to `src/models/<name>.js` and write the steps bottom-up following `reference/modeling.md`. Add the file to `index.html`. Done when `node tools/check-model.cjs <name>` reports no overlaps and everything is held.
5. **Frames.** Run `node tools/snap.cjs 3 6 9 12 <final> --model <name>` and look at the frames. The final frame is half a second before the end. Check the model is recognisable, parts don't intersect, and the parts list fits the page. Fix and re-snap. Done when the model is recognisable at first glance in the final frame.
6. **Render.** Run `node tools/render.cjs --model <name>`, add `--format horizontal` for landscape. Done when the mp4 is in `exports/` and has been watched start to finish.

## Portrait from a photo

The photo is shrunk to a grid where one stud is one pixel. Each cell gets a real LEGO tile: round 98138 or square 3070 in a colour it is produced in. Colours are matched perceptually (CIELAB, CIEDE2000). The palette is fitted to the photo, dithering blends neighbouring tiles into in-between tones, and isolated dots are removed. A round tile leaves visible black plate around it, and this is accounted for.

1. **Photo.** A front-facing portrait on a plain background with even light works best. Done when the photo is local and the face is in frame.
2. **Mosaic.** Run `node tools/mosaic.cjs <photo> --name <name>`. Default is 64×64, mixed round and square tiles, portrait palette up to 12 colours. A black-and-white photo is detected and built from four greys. Outputs `exports/<name>-compare.png` (photo, grid, LEGO), `<name>-lego.png`, `<name>-map.png` (build map) and `<name>-parts.md` (parts with BrickLink numbers).
3. **Likeness.** Open compare and judge by eye. If the face isn't recognisable, tune: `--size 80` or `96` for more detail; if the face is small, `--zoom 1.3` with `--dx`, `--dy`; stray dots on skin, lower `--dither 0.3`; flat photo, raise `--contrast 0.7`; fine features, raise `--sharpen 0.7`. Done when glasses, moustache, hair and other features read in the LEGO version.
4. **Video.** First snap a few frames with `--frames 3,9,15` and look. Then add `--video`, plus `--format vertical` for portrait. Produces `exports/<name>-build.mp4`: plates drop, the camera dives to the board and flies along the build front as tiles rain down, then rises over the finished portrait with the photo alongside. Done when the video has been watched.

`mosaic.html` does the same in the browser: drop a photo, tune the settings, download the image, map or a webm video.

## Rules

- No invented prints. Build eyes, noses and patterns from plain parts. Examples in `reference/modeling.md`.
- Fix face parts on side studs (87087 and similar), don't just rest them against the model.
- The model check must be green before every render.
- Never call a model physically verified unless someone built it by hand.
- No `Math.random` or `Date` in drawing code; a frame must depend only on time.
- LEGO is a trademark of the LEGO Group. Don't present the video as official and don't draw the LEGO logo.

## If a part is missing

Add it to `src/lego.js` with one of the helpers `box`, `slope`, `ridge`, `curve`, `round`, using its BrickLink number. Then rebuild the reference with `node tools/parts-md.cjs` and view the part at `index.html?view=parts`. Details in `reference/modeling.md`.
