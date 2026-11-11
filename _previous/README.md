# Voltiris LED Lab

Plans greenhouse grow lights with Voltiris modules. You pick an LED, set the greenhouse, and see the light on the crop (PPFD, uniformity, daily light, share blocked by Voltiris), a 3D view, a section, a crop map, and a PDF report.

Everything runs in the browser. No build step, no internet needed once the files are on your machine.

## Run it

The page loads data files and a web worker, so it must be opened through a web server, not by double-clicking `index.html`.

- Windows: double-click `start.bat` (needs Node.js or Python; not tested on Windows)
- Mac/Linux: `./start.sh`
- Any machine with Node: `node serve.mjs 8080`
- Any machine with Python: `python3 -m http.server 8080`

Then open http://localhost:8080.

To publish it for colleagues, copy the whole folder to any static web host (internal web server, IIS, Azure Static Web Apps, GitHub Pages). There is no backend.

## What is where

- `index.html` page markup. `css/styles.css` styles.
- `js/engine.js` the light engine: photometric beam, Voltiris shadow maps, irradiance on the crop. No browser dependencies, so it also runs in Node.
- `js/worker.js` runs the engine in a Web Worker. `js/app.js` the interface, charts, 3D view, PDF report. `js/main.js` loads the data, then starts the app.
- `data/kit.json` Voltiris parts as boxes (position, size, rotation, transmission) and the sweep envelope.
- `data/mesh.json` Voltiris 3D meshes for the 3D view only.
- `data/curves.json` measured beam curve (Signify TLF20 quadro beam).
- `data/led-library.json` the LED list and datasheet sources. Edit this to add or correct fixtures; reload the page.
- `data/assets.json` logo and fonts used in the PDF.
- `vendor/` three.js 0.128.0, jsPDF 2.5.1, Lexend (SIL Open Font License), all bundled.

## Add an LED

Add an entry to `fixtures` in `data/led-library.json`: `id`, `brand`, `model`, `size` [length, width, height in mm], `src` (a key from `sources`), and `variants` with `ppf`, `watt`, and `beam` (`{ "angle": 120 }` or `{ "curve": "<name in curves.json>" }`). For a measured beam, users can also load an IES or LDT file in the app.

## Use the engine on its own

```js
const { LedEngine } = require('./js/engine.js');   // Node
const kit = require('./data/kit.json');

const beam = angle => { const n = Math.log(0.5) / Math.log(Math.cos(angle / 2 * Math.PI / 180));
  return { sym: true, I: Array.from({ length: 91 }, (_, g) => g >= 90 ? 0 : Math.cos(g * Math.PI / 180) ** n) }; };

const cfg = Object.assign(LedEngine.defaults(), {
  slots: [2.9, 5.6],            // LED positions across one chapel, m from the column
  ledFace: 5.28, ppf: 5100,     // LED face height (m) and flux (umol/s)
  dist: beam(150), pose: { el: 60, az: 150 },
});
const r = LedEngine.run(cfg, kit, null, { ng: 90, nc: 180, res: 0.125, reach: [6, 8], smooth: true });
console.log(r.avg, r.uMinAvg, r.blocked);   // PPFD, min/avg, blocked share per LED
```

## Known limits

- Direct LED light only: no reflections, sunlight or spectrum. Daily light is from the LEDs alone.
- Voltiris parts are boxes, so blocking is slightly overestimated. Lamellas are treated as 100% PAR transmitting. Parked pose is fixed at 60° / 150°.
- Beams other than the TLF20 curve are rotationally symmetric from one beam angle.
- Truss spacing below 5 m scales the module positions; line count is limited to 4, 5 or 6.
- Light beyond 6 chapels / 8 bays is dropped (about 1.6% for a 150° beam).
