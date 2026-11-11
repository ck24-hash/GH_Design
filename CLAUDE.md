# CLAUDE.md: Voltiris GH Design

Context for Claude Code. Read this first, then README.md for the file map.

## What this is

A browser tool for designing a new Voltiris greenhouse (GH). The user goes through three tabs in order:

1. **Structure**: truss, pillars, edge posts, triangles, gutter and culture lines, crop height, bracket line, I attachments.
2. **Voltiris**: modules on the module lines set in Structure, night position, counts, 3D of the whole greenhouse.
3. **LEDs**: light plan (ray-traced PPFD, uniformity, DLI, share blocked by Voltiris), from the earlier "LED lab".

Fans will be a fourth tab later (not started).

Owner: Charbel (Voltiris, Swiss agrivoltaic cleantech). Earlier versions: the truss builder was a single-file claude.ai artifact; the LED lab is in `_previous/`.

## Run and test

- Must be served over http (data files + Web Worker): `node serve.mjs 8080` or `python3 -m http.server 8080`, then http://localhost:8080. `start.bat` on Windows.
- No build step, no npm dependencies. Libraries are bundled in `vendor/` (three.js r128 + OrbitControls, jsPDF 2.5.1, jsPDF-AutoTable 3.8.2, Lexend fonts).
- No automated tests yet. Pure modules run in Node for quick checks:
  - `js/engine.js` exports `LedEngine` (`require('./js/engine.js')`).
  - `js/structure/geometry.js` and `js/core/model.js` need `global.window = global` and a `localStorage` stub.
- Manual check after a change: open each tab, check the browser console, change a structure value and watch the other tabs update, click PDF report, Save design then Open design.

## Architecture

Plain scripts, one global namespace `window.GHD`, loaded in order by `js/main.js` (order matters):

```
util -> structure/geometry -> structure/drawing -> core/model -> core/scene3d -> core/report
     -> structure/tab -> voltiris/tab -> leds/photometry -> leds/tab -> core/shell
```

- `core/model.js` is the single source of truth. State `GHD.Model.S` has sections `project`, `structure`, `volt`, `led`, `custom` (+ `imported`, session only).
  - Each tab writes only its own section and reads the others.
  - Change flow: write state, then `Model.changed(section)` (or `Model.set`). This persists to localStorage (`ghdesign-state-v1`) and notifies listeners via `Model.on(fn)`; `fn` gets the section name, or `'loaded'` after a design file is opened.
  - `Model.geometry()`: structure geometry in mm (cached, rebuilt when `structure` changes).
  - `Model.greenhouse()`: the same in m for the engine and 3D (chapel width W, bay L, truss top/depth, `lines` [{id, x, kind}], gutters, cultures, `crop`, `iBottom`, `pivot`). This is the only place mm becomes m.
  - `Model.patterns(L)`, `Model.patternOf(i, k, n)`, `Model.pose()` read the module layout and night poses from `data/kit.json`.
  - `Model.toFile()` / `fromFile(text)`: design files (JSON, `app: 'voltiris-gh-design'`, `version: 1`).
- `core/scene3d.js`: `viewer(host)` and `addGreenhouse(viewer, opts)`. All three tabs use them for 3D. The LEDs tab adds its LEDs, crop texture and ray fan on top.
- `core/report.js`: one PDF. Each tab exposes `reportPages(R)`; `R` is the page kit (`page`, `T`, `tbl`, `checks`, `right`, colours). Structure pages are landscape, the others portrait.
- `core/shell.js`: tab switching (hash `#structure|#voltiris|#leds`), tab summaries, PDF button (waits for the light), Save/Open design.
- `js/engine.js` + `js/worker.js`: the light engine (runs in a Worker). Module lines come in as `cfg.lineXs`, module pivot height as `cfg.pivotZ`.
- `leds/tab.js` only calculates while the LEDs tab is open, or when the report needs it. Otherwise it marks the result stale and the header status says so. This is intended.

## Frames and units (keep consistent)

- **Display:** Structure tab in **mm**. Voltiris and LEDs tabs in **m**. Decided by the user; do not mix.
- **Structure frame (mm):** x along the truss from the **outer face of the left pillar**; y up from the underside of the lower beam.
- **Greenhouse frame (m):** same x origin; y along the greenhouse (trusses at y = j·L); z up from the floor.
- **Truss length L** runs from the outer face of the left pillar to the outer face of the next pillar. So it equals the chapel width and the repeat period.

## Domain decisions (agreed with the user, do not change silently)

Structure:
- Pillars rise to the truss top; pillar height is ground to truss top.
- An edge post sits against each pillar; the beams span between the edge posts.
- Triangles always point up. The number per side is fixed, placed from the middle outward. Any part past an edge post is cut at its face, not removed.
- Middle reinforcement at the centre between pillars, (L + pillar width) / 2.
- **Gutter lines and culture lines** hang from the **underside of the lower beam**.
  - Gutter lines: spread symmetrically about the bay centre.
  - Culture lines: with gutters, one on each side of every gutter at a fixed distance; without gutters, their own symmetric spread.
  - Gutter height = distance from truss underside to the gutter.
- **Crop height** (top of the crop, from the ground) is a Structure input and is never below the gutters. It is clamped when the field is left; `Model.greenhouse().crop` also clamps.

Module lines:
- **Bracket line**: the first module line, on a pillar bracket, 36 mm from the pillar face (left or right, can be switched off). Optional.
- The pattern **repeats**: the bracket line of the adjacent pillar also counts for the minimum spacing.
- **I attachment**: metal bar under the lower beam on a base plate (length 180, thickness 4), with two U-bolts 13 mm from the plate ends, over the beam. The **installation height** (I length below the truss, default 829 mm) sets the Voltiris pivot height.
- Plates and U-bolts are drawn but **cast no shadow**. The I bar section comes from `kit.json` (`i_structure`).
- I placement modes:
  - **Manual**: distances, the first from the bracket line.
  - **Uniform**: first distance, then even spacing up to the next bracket line.
  - **Optimal**: each I is tied to a fixed point where possible: a U-bolt touching the inside of a triangle leg, a U-bolt centred between two triangles, or a plate end touching a gutter/culture line. Respects the minimum spacing and avoids collisions, otherwise falls back to a free position. Free I report the nearest fixed point left and right.
- **Every chapel has 5 module lines** (bracket + 4 I, or 5 I). They alternate **A, B over the whole greenhouse**, so the pattern repeats every two chapels. The light map is computed for the chapel whose first line is A.
- The bracket line carries the same parts as an I line in the light engine and 3D; the bracket itself is a simple arm (not modelled further).

Voltiris:
- Module positions along a line and night poses live in `data/kit.json` (`layout`, `poses`), not in code.

## Style rules (from the user and Voltiris)

- UI and report text: plain, direct English, no filler, **no em dashes**, no "Great question"-style phrasing. Short labels that say what things are.
- Never invent numbers. Unknown values are marked `[TO CHECK]` in messages to the user.
- Voltiris colours: navy `#001D3B`, steel `#40598A`, teal `#00C9A5`; font Lexend. Colour tokens live in `css/styles.css` for light and dark themes; use the tokens, not literal colours.
- Keep pure geometry and engine code free of DOM access.

## Open items / ideas

- Fans tab (next section to add).
- Culture line length is not an input (drawn 0.35 m long in 3D).
- The LEDs tab (`leds/tab.js`, about 1,000 lines) still mixes engine setup, drawing and UI; the section and map drawing could move to `leds/drawing.js`.
- 3D rebuilds the whole greenhouse on each change; fine now, could rebuild only changed groups.
- No automated tests: geometry (`StructureGeo.build`) and the engine are pure and easy to test in Node.
- Global namespace + ordered script loading; ES modules would remove the load-order coupling.
