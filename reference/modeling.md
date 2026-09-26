# Designing your own model

A model is a file `src/models/<name>.js` holding a list of steps. Each step is a list of parts. The engine draws the instruction page, drops the parts in, outlines the new ones, fades the old ones and spins the finished model at the end.

A worked example is `src/models/cat.js`: a ginger cat in 106 parts whose face hangs on side studs.

## Coordinates

- One unit is one stud pitch (8 mm). A plate is 0.4 high, a brick 1.2, i.e. three plates.
- x runs right, y away from the viewer, z up.
- The model faces -y, towards the camera. With `theta` between 35 and 45 the camera looks from front-right, and the front face appears on the left of the screen.
- In `at`, x and y count studs and z counts plates. Plate 0 sits on the ground; a brick above it starts at z = 1.
- `at` is the part's minimum corner after rotation. A 1×2 turned along y is still placed by its left-front-bottom corner.

## One part

```js
{ id: '3001', color: 'orange', at: [0, 1, 9], rot: 1 }
{ id: '98138', color: 'black', at: [2, -0.4, 15.5], up: '-y', from: [0, -3, 0] }
```

- `id` BrickLink part number, listed in `reference/parts.md`.
- `color` colour key from the same file.
- `rot` 0 to 3 turns the part about the vertical by 90° anticlockwise seen from above. Unrotated, the part's width runs along x.
- `up` points the studs sideways (SNOT). `'-y'` points them at the viewer; that is how eyes and noses are fixed.
- `from` offset the part slides in from. Without it the part drops from above. For parts on side studs use `from: [0, -3, 0]`: the part slides in from the front with a red arrow, as in a real booklet.
- `prints` a print on the part. Only use it if that printed part really exists.

Register the model like this, with the key matching the file name:

```js
window.MODELS.cat = { title: 'Ginger Cat', theta: 35, phi: 28, steps: STEPS };
```

Then add `<script src="src/models/<name>.js"></script>` to `index.html`.

## Workflow

1. Sketch the model on grid paper from the front and from above. An odd width gives a stud dead centre, handy for a nose.
2. Build in layers from the bottom up. Plates add 1 to z, bricks add 3.
3. Stagger joints between layers like brickwork. It is stronger and looks like a real build.
4. Hidden insides can be any colour, but they show from above during the build, so use the body colour.
5. Put small face parts in the last steps. The moment the eyes slide in is when the model comes alive, the best part of the video.
6. Keep 1 to 12 parts per step. Parts fall straight down, so each must reach its place without touching parts already there.

## Side studs

Brick 87087 carries an extra stud on its front face, centred 0.7 above the brick's bottom. A part mounted on it sits like this:

- Height. If the brick is at z = k plates, the part's `at` z is k + 0.5. This works for a 1×1 round tile and for the bottom row of a 2×2 round plate.
- Depth. The face front is at y = 0 and a plate or tile is 0.4 thick, so `at` y is -0.4.
- Width. A 1×1 tile takes the x of its brick. A 2×2 plate rests on two neighbouring 87087 bricks and takes the x of the left one.

In the cat the muzzle row is at z = 9 and the whisker pads at 9.5. The nose row is at 12, the nose at 12.5. The eye row is at 15, the eyes at 15.5.

## Honest building

- Real parts only. If a print does not exist in the catalogue, build the detail from plain parts. Eyes can be black round tiles, a nose a pink round tile. Cheeks come from white 2×2 round plates, whose studs read as whisker dots.
- Check every part + colour pair in the catalogue. `https://www.bricklink.com/catalogColors.asp?itemType=P&itemNo=<number>` lists every colour the part was made in. Rebrickable blocks automated requests, so use BrickLink. Write the check date in the model file header.
- After every change run `node tools/check-model.cjs <name>`. It finds overlapping parts and parts held by nothing. A part can be held from above, below or by a side stud, as long as the chain reaches the ground.
- The check does not replace a physical build. Strength, tolerances and balance cannot be verified on screen.

## Viewing the result

```bash
node tools/snap.cjs 3 6 9 12 --model cat
node tools/snap.cjs 20 --model cat --format horizontal
```

Frames land in `exports/`. Look at them. Check that the model is recognisable at the end, that parts do not intersect and that each step's parts list fits. Video length is 0.55 + 0.85 × steps + 5.55 seconds; the final frame is half a second before the end.

## Common mistakes

- An off-by-one in `at`, so two parts share a spot. The check catches this.
- A forgotten `rot: 1` on a 1×N part that should run along y.
- z in studs instead of plates. A brick on a brick is +3, not +1.
- A part on a side stud without `up`. It will lie flat.
- An invented print. Build the detail from plain parts instead.

## Adding a part to the library

Parts are defined in `src/lego.js` with helpers:

- `box(id, label, width, depth, height in plates, has studs)` bricks, plates and tiles.
- `slope`, `ridge`, `curve` slopes. The profile lies in the y-z plane and is extruded along x.
- `round(id, label, size, height, has studs)` round parts.
- A side stud is added to `studs` with a fourth element giving its axis, e.g. `[0.5, 0, 0.7, [0, -1, 0]]`.
- Technic holes go in `holes`; an axle hole is a `hole` disc.

Use the BrickLink number. Then rebuild the reference with `node tools/parts-md.cjs` and look at the part on `index.html?view=parts`.

## API

- `LEGO.place(spec)` places a part.
- `LEGO.camera({ theta, phi, scale, cx, cy, target })` sets up the orthographic camera.
- `LEGO.draw(ctx, items, cam)` draws parts in the right order. An item can carry `part`, `move`, `pale`, `halo`, `alpha`.
- `LEGO.booklet(model, 'vertical' | 'horizontal')` returns a film `{ W, H, duration, draw(ctx, t) }`.
- `LEGO.drawPart`, `LEGO.partSize`, `LEGO.bounds`, `LEGO.extent`, `LEGO.arrow` help with custom pages.

Rendering is deterministic. There is no `Math.random` or `Date`; a frame depends only on time, so the engine drops into any frame-by-frame renderer.
