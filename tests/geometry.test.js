// Structure geometry (js/structure/geometry.js): the domain rules agreed in CLAUDE.md.
'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { load } = require('./load');

const GHD = load(['js/structure/geometry.js', 'js/core/model.js']);
const { build, clipPoly } = GHD.StructureGeo;
const DEF = GHD.Model.DEF.structure;
const geo = patch => build(Object.assign(JSON.parse(JSON.stringify(DEF)), patch));
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const lineXs = g => g.lines.filter(l => !l.rep).map(l => l.x);

test('default design builds without warnings, with 5 module lines (bracket + 4 I)', () => {
  const g = geo();
  assert.deepEqual(g.warn, []);
  assert.equal(g.Is.length, 4);
  assert.equal(lineXs(g).length, 5);
});

test('middle reinforcement sits at (L + pillar width) / 2', () => {
  for (const [L, pw] of [[8530, 140], [9600, 120], [6400, 0]]) assert.equal(geo({ L, pw }).mid, (L + pw) / 2);
});

test('triangles: the number per side is kept, placed symmetrically from the middle', () => {
  for (const nSide of [1, 2, 3, 4]) {   // with more, whole triangles fall past the edge posts and nothing is left to draw
    const g = geo({ nSide }), ts = g.tris;
    assert.equal(g.n, nSide);
    assert.equal(ts.length, 2 * nSide);
    for (let i = 0; i < ts.length; i++) assert.ok(near(ts[i].x0 + ts[ts.length - 1 - i].x1, 2 * g.mid, 1e-6), `pair ${i} not symmetric`);
    assert.ok(ts.every(t => t.yA > t.yB), 'triangles point up');
  }
});

test('triangles past an edge post are cut at its face, not removed', () => {
  const g = geo();                                   // defaults: 4 per side, only 3 fit
  assert.ok(g.nFit < g.n);
  assert.equal(g.tris.length, 2 * g.n);
  assert.equal(g.nCut, 2);
  assert.ok(g.tris[0].cut && g.tris[g.tris.length - 1].cut);
  // no member point lies outside the pillars, and the clipped triangle parts stay between the edge posts
  for (const m of g.members) for (const [x] of m.pts) assert.ok(x >= g.xl - 1e-6 && x <= g.xr + 1e-6);
});

test('gutter lines spread symmetrically about the bay centre', () => {
  for (const gCount of [2, 4, 5]) {
    const g = geo({ gCount }), gx = g.fix.filter(f => f.kind === 'g').map(f => f.x);
    assert.equal(gx.length, gCount);
    assert.equal(gx[0], DEF.gFirst);
    for (let i = 0; i < gx.length; i++) assert.ok(near(gx[i] + gx[gx.length - 1 - i], 2 * g.mid));
  }
});

test('a single gutter line sits at the bay centre', { todo: 'open question: today it sits at the first-line distance' }, () => {
  const g = geo({ gCount: 1 }), gx = g.fix.filter(f => f.kind === 'g').map(f => f.x);
  assert.equal(gx.length, 1);
  assert.ok(near(gx[0], g.mid), `at ${gx[0]}, centre ${g.mid}`);
});

test('culture lines: one on each side of every gutter line at the set distance', () => {
  const g = geo({ cDist: 300 }), gx = g.fix.filter(f => f.kind === 'g').map(f => f.x), cx = g.fix.filter(f => f.kind === 'c').map(f => f.x);
  assert.equal(cx.length, 2 * gx.length);
  for (const x of gx) { assert.ok(cx.some(c => near(c, x - 300))); assert.ok(cx.some(c => near(c, x + 300))); }
});

test('culture lines without gutters: their own symmetric spread', () => {
  const g = geo({ gutter: false, cFirst: 600, cCount: 7 }), cx = g.fix.filter(f => f.kind === 'c').map(f => f.x);
  assert.equal(g.nG, 0);
  assert.equal(cx.length, 7);
  assert.equal(cx[0], 600);
  for (let i = 0; i < cx.length; i++) assert.ok(near(cx[i] + cx[cx.length - 1 - i], 2 * g.mid));
});

test('bracket line: 36 mm from the pillar face, repeated at the next pillar', () => {
  const left = geo({ brkSide: 'left' });
  assert.equal(left.xb, DEF.pw + 36);
  assert.equal(left.xbRep, DEF.L + DEF.pw + 36);
  const right = geo({ brkSide: 'right' });
  assert.equal(right.xb, DEF.L - 36);
  assert.equal(right.xbRep, -36);
  const off = geo({ brk: false, nI: 5 });
  assert.equal(off.xb, null);
  assert.equal(lineXs(off).length, 5, 'without a bracket line, 5 I make the 5 module lines');
});

test('optimal I placement: minimum spacing (bracket repeat included) and no collisions', () => {
  for (const patch of [{}, { brkSide: 'right' }, { dmin: 1500 }, { L: 9600 }, { gutter: false }]) {
    const g = geo(Object.assign({ iMode: 'optimal' }, patch)), p = Object.assign({}, DEF, patch);
    assert.equal(g.Is.length, 4, JSON.stringify(patch));
    for (const I of g.Is) assert.deepEqual(I.prob, [], `${I.id} collides (${JSON.stringify(patch)})`);
    const xs = g.lines.map(l => l.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] >= p.dmin - 0.5, `spacing ${xs[i] - xs[i - 1]} (${JSON.stringify(patch)})`);
    for (const I of g.Is) for (const r of I.refs) assert.ok(Math.abs(r.x - I.x) < 0.5, 'a referenced I sits on its fixed point');
    for (const I of g.Is.filter(I => !I.refs.length)) assert.ok(I.near && 'left' in I.near && 'right' in I.near, 'a free I reports its nearest fixed points');
  }
});

test('optimal I placement falls back and warns when the I cannot all fit', () => {
  const g = geo({ iMode: 'optimal', dmin: 3000 });
  assert.ok(g.Is.length < 4);
  assert.ok(g.warn.some(w => /^Only \d+ of 4 I fit/.test(w)), g.warn.join(' | '));
});

test('uniform I placement: first distance, then even spacing up to the next bracket line', () => {
  for (const side of ['left', 'right']) {
    const g = geo({ iMode: 'uniform', uFirst: 2000, brkSide: side }), xs = g.Is.map(I => I.x).sort((a, b) => a - b);
    const dir = side === 'left' ? 1 : -1, first = g.xb + dir * 2000;
    assert.ok(xs.some(x => near(x, first)));
    for (let i = 1; i < xs.length; i++) assert.ok(near(xs[i] - xs[i - 1], g.iPitch));
    const last = side === 'left' ? xs[xs.length - 1] : xs[0];
    assert.ok(near(last + dir * g.iPitch, g.xbRep), 'the pitch ends on the next bracket line');
  }
});

test('manual I placement: distances add up from the bracket line', () => {
  const man = [1700, 1650, 1800, 1600];
  const left = geo({ iMode: 'manual', man }), right = geo({ iMode: 'manual', man, brkSide: 'right' });
  let x = left.xb; const wantL = man.map(d => (x += d));
  assert.deepEqual(left.Is.map(I => I.x), wantL);
  x = right.xb; const wantR = man.map(d => (x -= d)).sort((a, b) => a - b);
  assert.deepEqual(right.Is.map(I => I.x), wantR);
});

test('I too close together are flagged', () => {
  const g = geo({ iMode: 'manual', man: [1000, 1000, 1000, 1000] });
  assert.ok(g.warn.some(w => /less than the 1600 mm minimum/.test(w)));
  assert.ok(g.Is.some(I => I.clash));
});

test('input checks: truss too shallow, culture lines on the gutters, gutter below ground', () => {
  assert.ok(geo({ H: 50, tc: 30 }).warn.some(w => /more than twice the beam thickness/.test(w)));
  assert.ok(geo({ cDist: 0 }).warn.some(w => /Culture lines sit on the gutter lines/.test(w)));
  assert.ok(geo({ gHang: 6000 }).warn.some(w => /at or below ground level/.test(w)));
});

test('clipPoly cuts a polygon to an x range', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const c = clipPoly(sq, 2, 5);
  assert.ok(c.every(([x]) => x >= 2 && x <= 5));
  assert.deepEqual([...new Set(c.map(p => p[0]))].sort((a, b) => a - b), [2, 5]);
  assert.deepEqual(clipPoly(sq, 20, 30), []);
});
