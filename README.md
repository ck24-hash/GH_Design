# Voltiris GH Design

One tool to design a new greenhouse with Voltiris. You go through three tabs in order:

1. **Structure**: truss, pillars, edge posts, triangles, gutter and culture lines, the bracket line and the I attachments (manual, uniform or optimal placement). 2D elevation and details, 3D view, module line table with how to locate each I, checks.
2. **Voltiris**: the modules on the module lines of the Structure tab (bracket line and I), night position, module counts, the whole greenhouse in 3D, checks.
3. **LEDs**: the light plan from the earlier LED lab: LED choice, mounting, positions, light on the crop (PPFD, uniformity, daily light, share blocked by Voltiris), section, crop map, 3D, datasheets.

The **PDF report** button in the header makes one report: a summary page, then the Structure, Voltiris and LED pages.

**Save design** downloads one JSON file with every parameter of the three tabs; **Open design** loads it back.

Everything runs in the browser. No build step, no internet needed once the files are on your machine.

## Run it

The page loads data files and a web worker, so it must be opened through a web server, not by double-clicking `index.html`.

- Windows: double-click `start.bat` (needs Node.js or Python)
- Mac/Linux: `./start.sh`
- Any machine with Node: `node serve.mjs 8080`
- Any machine with Python: `python3 -m http.server 8080`

Then open http://localhost:8080. To publish it for colleagues, copy the whole folder to any static web host. There is no backend.

## How the parts fit together

```
Structure tab ──writes──> Model.S.structure ──> Model.geometry()   (mm, truss frame)
                                             └─> Model.greenhouse() (m, greenhouse frame: chapel width, truss top,
                                                                     module lines, gutter and culture lines)
Voltiris tab ───writes──> Model.S.volt       reads greenhouse()
LEDs tab ───────writes──> Model.S.led        reads greenhouse() and S.volt; sends module lines to the light engine
```

Each tab owns its own part of the state and only reads the others. Every change goes through the model, which saves it in the browser and tells the other tabs.

Units: the Structure tab shows mm, the Voltiris and LEDs tabs show m. Frames: the Structure tab works in mm along the truss, x from the outer face of the left pillar. The 3D views and the light engine work in m with the same x origin, y along the greenhouse and z up from the floor. `Model.greenhouse()` is the only place where one becomes the other.

## What is where

- `index.html` page markup for the three tabs. `css/styles.css` all styles (one set of colour tokens for light and dark).
- `js/main.js` loads the data, then the scripts below in order.
- `js/core/util.js` shared helpers. `js/core/model.js` the shared greenhouse model. `js/core/scene3d.js` the 3D greenhouse used by all three tabs (left drag pans, right drag turns, wheel zooms, full screen). `js/core/report.js` the combined PDF. `js/core/shell.js` tabs and the PDF button.
- `js/structure/geometry.js` truss, fixations, bracket line and I placement (pure functions, mm). `js/structure/drawing.js` 2D drawings for screen (SVG) and PDF. `js/structure/tab.js` the Structure tab.
- `js/voltiris/tab.js` the Voltiris tab.
- `js/leds/photometry.js` beam shapes, IES and LDT files, colour ramp, beam polar. `js/leds/tab.js` the LEDs tab (the former `app.js`).
- `js/engine.js` the light engine: photometric beam, Voltiris shadow maps, irradiance on the crop. Takes the module lines from the structure (`cfg.lineXs`). No browser dependencies, so it also runs in Node. `js/worker.js` runs it in a Web Worker.
- `data/kit.json` the Voltiris installation: parts as boxes, the sweep envelope, the module positions along a line (`layout`) and the night positions (`poses`). `data/mesh.json` Voltiris meshes for 3D. `data/curves.json` measured beam curve. `data/led-library.json` LED list and sources. `data/assets.json` logo and PDF fonts.
- `vendor/` three.js 0.128.0, jsPDF 2.5.1 and jsPDF-AutoTable 3.8.2, Lexend (SIL Open Font License), all bundled.
- `_previous/` the LED lab files this version replaced, kept for reference.

## Add an LED

Add an entry to `fixtures` in `data/led-library.json`: `id`, `brand`, `model`, `size` [length, width, height in mm], `src` (a key from `sources`), and `variants` with `ppf`, `watt`, and `beam` (`{ "angle": 120 }` or `{ "curve": "<name in curves.json>" }`). Users can also load an IES or LDT file in the LEDs tab.

## Known limits

- Geometry only: no structural verification of the truss or the I attachments.
- The bracket line carries the same parts as an I line (bar, cross profile, optimisers), held by a simple arm from the pillar.
- The I base plates and U-bolts are drawn but cast no shadow in the light engine.
- Every chapel is assumed to have 5 module lines. Lines alternate A and B over the whole greenhouse, so the pattern repeats every two chapels; the light map is computed for the chapel whose first line is A.
- Culture lines are drawn 0.35 m long; their real length is not an input yet.
- Light: direct LED light only (no reflections, sunlight or spectrum). Voltiris parts are boxes; lamellas pass PAR. Light beyond 6 chapels / 8 bays is dropped.
- Module positions along the line come from the kit for a 5 m truss spacing and are scaled for other spacings.
