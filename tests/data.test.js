// Data files: what the code expects to find in data/*.json.
'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { readJSON } = require('./load');

const kit = readJSON('data/kit.json'), lib = readJSON('data/led-library.json'), curves = readJSON('data/curves.json');
const assets = readJSON('data/assets.json'), mesh = readJSON('data/mesh.json');

test('LED library: every fixture is complete and its datasheet source exists', () => {
  const ids = new Set();
  for (const f of lib.fixtures) {
    assert.ok(!ids.has(f.id), `duplicate id ${f.id}`); ids.add(f.id);
    assert.ok(f.brand && f.model, f.id);
    assert.ok(Array.isArray(f.size) && f.size.length === 3 && f.size.every(v => v > 0), `${f.id} size`);
    assert.ok(f.variants.length > 0, `${f.id} variants`);
    if (!f.custom) assert.ok(lib.sources[f.src] && /^https?:\/\//.test(lib.sources[f.src].url), `${f.id}: source "${f.src}" missing`);
    for (const v of f.variants) {
      assert.ok(v.label && v.ppf > 0 && v.watt > 0, `${f.id} ${v.label}: label, ppf and watt`);
      assert.ok((v.beam.angle > 0 && v.beam.angle < 180) || curves[v.beam.curve], `${f.id} ${v.label}: beam`);
    }
  }
  assert.ok(lib.fixtures.some(f => f.custom), 'the custom LED entry');
});

test('the default LED of the model is in the library', () => {
  assert.ok(lib.fixtures.some(f => f.id === 'mx-maxpro'));
});

test('measured curves: two planes of 91 values from straight down', () => {
  for (const [name, c] of Object.entries(curves)) {
    if (c.sym) { assert.equal(c.I.length, 91, name); continue; }
    assert.equal(c.I0.length, 91, name); assert.equal(c.I90.length, 91, name);
  }
});

test('Voltiris kit: module layout, night poses and the parts the code looks up', () => {
  assert.ok(kit.layout.bay > 0);
  for (const k of ['A', 'B']) assert.ok(kit.layout[k].length > 0 && kit.layout[k].every(y => y > 0 && y < kit.layout.bay), `layout ${k}`);
  for (const p of ['park', 'flat']) assert.ok(kit.poses[p] && Number.isFinite(kit.poses[p].el) && Number.isFinite(kit.poses[p].az) && kit.poses[p].label, `pose ${p}`);
  assert.ok(kit.at_I.find(p => p.name === 'i_structure'), 'i_structure sets the pivot height');
  assert.ok(kit.line.find(p => p.name === 'profile'));
  for (const b of [...kit.moving, ...kit.static]) {
    assert.equal(b.c.length, 3, b.name); assert.equal(b.h.length, 3, b.name); assert.equal(b.u.length, 3, b.name);
  }
});

test('assets: logo, both PDF fonts and the build date', () => {
  assert.ok(assets.logo && assets.fonts.light && assets.fonts.medium && assets.built);
  assert.ok(mesh && typeof mesh === 'object');
});
