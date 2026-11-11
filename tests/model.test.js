// Shared model (js/core/model.js): mm to m, crop clamp, A/B pattern, change events, storage and design files.
'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { load, memoryStorage, readJSON } = require('./load');

const fresh = storage => load(['js/structure/geometry.js', 'js/core/model.js'], { storage }).Model;
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

test('greenhouse() is the structure in metres', () => {
  const M = fresh(), p = M.S.structure, gh = M.greenhouse(), g = M.geometry();
  assert.equal(gh.W, p.L / 1000);
  assert.equal(gh.L, p.bay / 1000);
  assert.equal(gh.top, p.pH / 1000);
  assert.equal(gh.depth, p.H / 1000);
  assert.ok(near(gh.tb, (p.pH - p.H) / 1000));
  assert.deepEqual(gh.gutters, g.fix.filter(f => f.kind === 'g').map(f => f.x / 1000));
  assert.ok(near(gh.iBottom, (p.pH - p.H - p.hI) / 1000));
});

test('module lines: bracket first, sorted, in metres', () => {
  const M = fresh(), gh = M.greenhouse(), g = M.geometry();
  assert.equal(gh.lines.length, 5);
  assert.equal(gh.lines[0].kind, 'bracket');
  assert.ok(near(gh.lines[0].x, g.xb / 1000));
  for (let i = 1; i < gh.lines.length; i++) assert.ok(gh.lines[i].x > gh.lines[i - 1].x);
});

test('pivot height follows the I installation height and the kit I bar', () => {
  const M = fresh(), p = M.S.structure, kitI = readJSON('data/kit.json').at_I.find(q => q.name === 'i_structure');
  const gh = M.greenhouse();
  assert.ok(near(gh.pivot, (p.pH - p.H - p.hI) / 1000 - kitI.z[0]));
  M.set('structure', { hI: p.hI + 100 });
  assert.ok(near(M.greenhouse().pivot, gh.pivot - 0.1));
});

test('crop height is never below the gutters', () => {
  const M = fresh(), p = M.S.structure;
  const gutterZ = (p.pH - p.H - p.gHang) / 1000;
  M.set('structure', { crop: Math.round(gutterZ * 1000) - 200 });
  assert.ok(near(M.greenhouse().crop, gutterZ));
  M.set('structure', { gutter: false });
  assert.ok(near(M.greenhouse().crop, p.crop / 1000), 'without gutters the input is kept');
});

test('module lines alternate A, B over the whole greenhouse', () => {
  const M = fresh(), n = 5;
  const row = i => Array.from({ length: n }, (_, k) => M.patternOf(i, k, n)).join('');
  assert.equal(row(0), 'ABABA');
  assert.equal(row(1), 'BABAB');
  assert.equal(row(2), row(0), 'the pattern repeats every two chapels');
  assert.equal(row(-1), row(1));
  assert.equal(Array.from({ length: 4 }, (_, k) => M.patternOf(1, k, 4)).join(''), 'ABAB', 'even line count: same in every chapel');
});

test('module positions scale with the truss spacing', () => {
  const M = fresh(), k = readJSON('data/kit.json').layout;
  for (const L of [k.bay, 2 * k.bay, 4.5]) {
    const p = M.patterns(L);
    for (const AB of ['A', 'B']) p[AB].forEach((y, i) => assert.ok(near(y, k[AB][i] * L / k.bay, 1e-12)));
  }
});

test('night pose comes from the kit, park when unknown', () => {
  const M = fresh(), poses = readJSON('data/kit.json').poses;
  M.S.volt.pose = 'flat'; assert.deepEqual(M.pose(), poses.flat);
  M.S.volt.pose = 'nonsense'; assert.deepEqual(M.pose(), poses.park);
});

test('change events: section name to listeners, geometry rebuilt only for structure', () => {
  const M = fresh(), seen = [];
  M.on(s => seen.push(s));
  const g0 = M.geometry();
  M.changed('led');
  assert.equal(M.geometry(), g0, 'cached when another section changes');
  M.set('structure', { L: 9000 });
  assert.notEqual(M.geometry(), g0);
  assert.equal(M.greenhouse().W, 9);
  assert.deepEqual(seen, ['led', 'structure']);
});

test('state is saved in localStorage and read back on start', () => {
  const store = memoryStorage();
  const M1 = fresh(store);
  M1.set('structure', { L: 9100 }); M1.set('led', { n: 3 });
  const saved = JSON.parse(store.getItem('ghdesign-state-v1'));
  assert.equal(saved.structure.L, 9100);
  const M2 = fresh(store);
  assert.equal(M2.S.structure.L, 9100);
  assert.equal(M2.S.led.n, 3);
  assert.equal(M2.S.structure.bay, M2.DEF.structure.bay, 'other values keep their defaults');
});

test('an old saved LED crop height moves to the structure, in mm', () => {
  const store = memoryStorage({ 'ghdesign-state-v1': JSON.stringify({ led: { crop: 2.1 } }) });
  const M = fresh(store);
  assert.equal(M.S.structure.crop, 2100);
  assert.equal(M.S.led.crop, undefined);
});

test('design file: save and open give the same design', () => {
  const A = fresh();
  A.set('structure', { L: 9200, iMode: 'uniform', man: [1700, 1700] });
  A.set('led', { n: 3, mount: 'below', xs: [1, 2, 3] });
  A.set('project', { name: 'Test GH' });
  const text = A.toFile(), file = JSON.parse(text);
  assert.equal(file.app, 'voltiris-gh-design');
  assert.equal(file.version, 1);
  const B = fresh(), events = [];
  B.on(s => events.push(s));
  assert.equal(B.fromFile(text), null);
  for (const k of ['project', 'structure', 'volt', 'led', 'custom']) assert.deepEqual(B.S[k], A.S[k], k);
  assert.deepEqual(events, ['loaded']);
  assert.equal(B.greenhouse().W, 9.2, 'geometry rebuilt after loading');
});

test('design file: bad files are refused, wrong types and unknown keys ignored', () => {
  const M = fresh();
  assert.equal(M.fromFile('not json'), 'the file is not valid JSON');
  assert.equal(M.fromFile(JSON.stringify({ app: 'other' })), 'this is not a GH design file');
  M.S.imported = { name: 'x.ies' };
  const err = M.fromFile(JSON.stringify({ app: 'voltiris-gh-design', structure: { L: 'wide', bay: 4500, extra: 1 }, led: { hBelow: 1.2 } }));
  assert.equal(err, null);
  assert.equal(M.S.structure.L, M.DEF.structure.L, 'a string is not taken for a number');
  assert.equal(M.S.structure.bay, 4500);
  assert.equal(M.S.structure.extra, undefined);
  assert.equal(M.S.led.hBelow, 1.2, 'null defaults accept a value');
  assert.equal(M.S.imported, null, 'the session photometric file is cleared');
});
