// Light engine (js/engine.js): beam tables, ray casting, energy balance, blocked share, lamp clashes.
'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { readJSON } = require('./load');
const E = require('../js/engine.js').LedEngine;
const kit = readJSON('data/kit.json');

const D2R = Math.PI / 180;
const lambert = { sym: true, I: Array.from({ length: 91 }, (_, g) => (g >= 90 ? 0 : Math.cos(g * D2R))) };
// default design from the Structure tab, in m (bracket line + 4 I, pivot from the 829 mm I)
const LINES = [{ x: 0.176, kind: 'bracket' }, { x: 1.882, kind: 'I' }, { x: 3.647, kind: 'I' }, { x: 5.273, kind: 'I' }, { x: 7.08, kind: 'I' }];
const cfg = patch => Object.assign(E.defaults(), {
  lineXs: LINES, trussTop: 6.1, trussDepth: 0.505, crop: 1.8, pivotZ: 5.431,
  slots: [1.03, 6.18], ledFace: 5.595 - 0.161, ppf: 4000, dist: lambert, pose: { el: 60, az: 150 },
}, patch);
const nominal = c => c.slots.length * c.ppf / (c.W * c.L);
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;

test('beam table: a Lambertian beam has flux π', () => {
  assert.ok(Math.abs(E.makeDist(lambert, 180, 360).phi - Math.PI) < 1e-3);
});

test('intensity: symmetric table, two planes blended cos²/sin², full grid wraps around C', () => {
  assert.equal(E.intensity(lambert, 0, 123), 1);
  assert.ok(Math.abs(E.intensity(lambert, 30.5, 0) - (Math.cos(30 * D2R) + Math.cos(31 * D2R)) / 2) < 1e-12);
  const two = { I0: Array(91).fill(1), I90: Array(91).fill(0) };
  assert.equal(E.intensity(two, 20, 0), 1);
  assert.ok(Math.abs(E.intensity(two, 20, 90)) < 1e-12);
  assert.ok(Math.abs(E.intensity(two, 20, 45) - 0.5) < 1e-12);
  const grid = { grid: { nC: 4, dC: 90, nG: 2, dG: 90, V: [1, 1, 2, 2, 3, 3, 4, 4] } };
  assert.equal(E.intensity(grid, 0, 0), 1);
  assert.equal(E.intensity(grid, 0, 360), 1);
  assert.equal(E.intensity(grid, 0, -90), 4);
  assert.equal(E.intensity(grid, 0, 45), 1.5);
});

test('ray casting: a box under the source blocks the rays that hit it, and only those', () => {
  const s = [0, 0, 2], box = { name: 'plate', c: [0, 0, 1], u: [1, 0, 0, 0, 1, 0, 0, 0, 1], h: [0.5, 0.5, 0.1], tau: 0 };
  const ng = 90, nc = 36, { T } = E.shadowMap([box], s, ng, nc);
  const edge = Math.atan2(0.5, 0.9) / D2R;            // the top face of the box ends at about 29° from straight down
  for (let ig = 0; ig < ng; ig++) for (let ic = 0; ic < nc; ic++) {
    const g = ig + 0.5;
    if (g < edge - 1) assert.equal(T[ig * nc + ic], 0, `γ ${g}`);
    if (g > Math.atan2(Math.SQRT2 * 0.5, 0.9 - 0.2) / D2R + 1) assert.equal(T[ig * nc + ic], 1, `γ ${g}`);
  }
  const half = E.shadowMap([Object.assign({}, box, { tau: 0.5 })], s, ng, nc).T;
  assert.equal(half[0], 0.5, 'a part that lets half through');
  assert.equal(E.shadowMap([box], [0, 0, 1], ng, nc).insideHit, 'plate');
});

test('without Voltiris, almost all the light sent reaches the crop', () => {
  const c = cfg(), r = E.run(c, kit, null, { fast: true, noModules: true });
  assert.deepEqual(r.blocked, [0, 0]);
  const share = r.avg / nominal(c);
  assert.ok(share > 0.97 && share <= 1, `share ${share}`);       // the rest falls beyond the chapels and bays in reach
  assert.ok(r.min <= r.avg && r.avg <= r.max);
  assert.equal(r.E.length, r.nx * r.ny);
});

test('on the truss, the light lost matches the share Voltiris blocks', () => {
  const c = cfg(), off = E.run(c, kit, null, { fast: true, noModules: true }), on = E.run(c, kit, null, { fast: true });
  const lost = mean(on.blocked);
  assert.ok(lost > 0.01 && lost < 0.5, `blocked ${lost}`);
  assert.ok(Math.abs(on.avg / off.avg - (1 - lost)) < 0.02, `${on.avg / off.avg} vs ${1 - lost}`);
});

test('LEDs hung below every Voltiris part lose nothing', () => {
  const r = E.run(cfg({ ledFace: 3.5 }), kit, null, { fast: true });
  assert.deepEqual(r.blocked, [0, 0]);
});

test('point values agree with the map run', () => {
  const c = cfg(), pts = E.run(c, kit, null, { fast: true, points: [[1, 1], [4, 0]] });
  const kept = E.run(c, kit, null, { fast: true, keep: true });
  assert.ok(Math.abs(kept.at(1, 1) - pts.Ep[0]) < 1e-9);
  assert.ok(Math.abs(kept.probe(4, 0).e - pts.Ep[1]) < 1e-9);
});

test('module lines: from the structure, or spread evenly without it', () => {
  assert.deepEqual(E.linesOf({ lineXs: [1, { x: 2, kind: 'bracket' }] }), [{ x: 1, kind: 'I' }, { x: 2, kind: 'bracket' }]);
  const even = E.linesOf({ W: 10, lines: 5, lineOffset: 1 });
  assert.deepEqual(even.map(l => l.x), [1, 3, 5, 7, 9]);
});

test('parts: one set per module line, none when the modules are off', () => {
  const per5 = E.buildBoxes(cfg(), kit, 0, 0, 0, 0).length, per2 = E.buildBoxes(cfg({ lineXs: LINES.slice(0, 2) }), kit, 0, 0, 0, 0).length;
  assert.equal(per5 / 5, per2 / 2);
  assert.deepEqual(E.buildBoxes(cfg({ layers: Object.assign({}, E.defaults().layers, { modules: false }) }), kit, 0, 0, 0, 0), []);
});

test('pivot height: from the I installation height when given', () => {
  assert.equal(E.pivotZ({ pivotZ: 5.2, trussTop: 6, envTop: 0.6 }), 5.2);
  assert.equal(E.pivotZ({ trussTop: 6, envTop: 0.6 }), 5.4);
});

test('rotation matrix is orthonormal, identity when flat', () => {
  assert.deepEqual(E.rotMat(0, 0).map(v => v + 0), [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const R = E.rotMat(60, 150), col = k => [R[k], R[3 + k], R[6 + k]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) assert.ok(Math.abs(dot(col(i), col(j)) - (i === j ? 1 : 0)) < 1e-12);
});

test('lamp clashes: in the truss, too close to the crop', () => {
  assert.deepEqual(E.collide(cfg(), kit, false), []);
  assert.deepEqual(E.collide(cfg({ ledFace: 5.5 }), kit, true), ['the lamp reaches into the truss']);
  assert.deepEqual(E.collide(cfg({ ledFace: 2.0 }), kit, true), ['the lamp is less than 0.5 m above the crop']);
  assert.ok(E.collide(cfg({ ledFace: 4.8, slots: [1.882] }), kit, false).length > 0, 'a lamp right under a module line');
});
