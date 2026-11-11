/* The one greenhouse model shared by all tabs.
   Each tab owns its section of the state (project, structure, volt, led) and only reads the others.
   The Structure tab is the source of the greenhouse geometry: chapel width, truss, pillars, module lines.
   greenhouse() turns it into the metric frame the light engine and the 3D view use. */
(function () {
  'use strict';
  const GHD = window.GHD;
  const KEY = 'ghdesign-state-v1';

  const DEF = {
    project: { name: 'My greenhouse', ref: 'T1', rev: 'A', author: '', notes: '' },
    // mm. L = truss length = chapel width (outer face of one pillar to the outer face of the next), bay = truss spacing
    structure: {
      L: 8530, H: 505, tc: 30, te: 30, zW: 60, pw: 140, pH: 6100, bay: 5000, crop: 1800,
      nSide: 4, w: 1059, td: 24, tm: 25, offMid: 5.32, offBtw: 8,
      gutter: true, gFirst: 1250, gCount: 4, gHang: 5000, culture: true, cDist: 250, cFirst: 500, cCount: 10,
      brk: true, brkSide: 'left', brkDist: 36,
      nI: 4, dmin: 1600, iMode: 'optimal', uFirst: 2000, man: [], plate: 180, ubIn: 13, rod: 5, hI: 829,
    },
    volt: { on: true, pose: 'park' },
    // positions across the chapel in m from the outer face of the left pillar
    led: { id: 'mx-maxpro', v: 0, n: 2, mount: 'truss', hBelow: null, dim: 100, hours: 16, rot: false, pos: 'centred', xs: [], sig: '' },
    custom: { ppf: 3000, watt: 900, angle: 120, L: 1000, W: 170 },
  };
  const clone = o => JSON.parse(JSON.stringify(o));
  const S = clone(DEF);
  S.imported = null;   // photometric file loaded in the LEDs tab (kept for the session only)

  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved) {
      for (const k of ['project', 'structure', 'volt', 'led', 'custom']) Object.assign(S[k], saved[k] || {});
      if (saved.led && saved.led.crop != null && !(saved.structure && saved.structure.crop != null)) S.structure.crop = Math.round(saved.led.crop * 1000);
      delete S.led.crop;
    }
    else {   // first start: take over the LED and crop settings of the earlier LED lab
      const old = JSON.parse(localStorage.getItem('ledlab-state') || 'null');
      if (old && old.led) { Object.assign(S.led, old.led, { pos: 'centred', xs: [] }); delete S.led.crop; if (old.gh && old.gh.crop) S.structure.crop = Math.round(old.gh.crop * 1000); Object.assign(S.custom, old.custom || {}); if (old.volt) S.volt.pose = old.volt.pose || S.volt.pose; if (old.project) S.project.name = old.project; }
    }
  } catch (e) { /* storage unavailable */ }
  if (!Array.isArray(S.structure.man)) S.structure.man = [];

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify({ project: S.project, structure: S.structure, volt: S.volt, led: S.led, custom: S.custom })); } catch (e) { /* ignore */ }
  }

  // change events: listeners get the name of the section that changed
  const listeners = [];
  function on(fn) { listeners.push(fn); }
  function changed(section) {
    if (section === 'structure') geoCache = null;
    persist();
    for (const fn of listeners) fn(section);
  }
  function set(section, patch) { Object.assign(S[section], patch); changed(section); }
  function reset(section) { Object.assign(S[section], clone(DEF[section])); changed(section); }

  // structure geometry, rebuilt only when the structure changes
  let geoCache = null;
  function geometry() { if (!geoCache) geoCache = GHD.StructureGeo.build(S.structure); return geoCache; }

  // greenhouse in metres, z up from the floor, x across the chapel from the outer face of the left pillar
  function greenhouse() {
    const p = S.structure, g = geometry(), m = v => v / 1000;
    const lines = [];
    if (g.xb != null) lines.push({ id: 'Bracket', x: m(g.xb), kind: 'bracket' });
    for (const I of g.Is) lines.push({ id: I.id, x: m(I.x), kind: 'I' });
    lines.sort((a, b) => a.x - b.x);
    const tb = m(p.pH - p.H), gutterZ = m(p.pH - p.H - p.gHang);
    return {
      W: m(p.L), L: m(p.bay), top: m(p.pH), depth: m(p.H), tb, pw: m(p.pw), zW: m(p.zW),
      lines,
      gutters: g.fix.filter(f => f.kind === 'g').map(f => m(f.x)),
      cultures: g.fix.filter(f => f.kind === 'c').map(f => m(f.x)),
      gutterZ,
      crop: cropZ(),                        // top of the crop, never below the gutters
      iBottom: tb - m(p.hI),                // bottom of the I bars: the Voltiris cross profile sits there
      pivot: tb - m(p.hI) - KIT().at_I.find(q => q.name === 'i_structure').z[0],   // module pivot height
      geom: g,
    };
  }
  const KIT = () => GHD.DATA.kit;
  // top of the crop in m: the input, raised to the gutters when they hang lower
  function cropZ() { const p = S.structure, c = p.crop / 1000; return p.gutter ? Math.max(c, (p.pH - p.H - p.gHang) / 1000) : c; }

  // module positions along each line within one truss bay (kit layout, scaled to the bay)
  function patterns(L) { const k = KIT().layout; return { A: k.A.map(y => y * L / k.bay), B: k.B.map(y => y * L / k.bay) }; }
  // lines alternate A, B over the whole greenhouse: line k of chapel i
  function patternOf(i, k, n) { return (((i * n + k) % 2) + 2) % 2 === 0 ? 'A' : 'B'; }
  // night position of the moving parts, from the kit
  function pose() { return KIT().poses[S.volt.pose] || KIT().poses.park; }

  // ---------- design files: every parameter, to download and load back
  const FILE_APP = 'voltiris-gh-design', FILE_VERSION = 1;
  function toFile() {
    return JSON.stringify({ app: FILE_APP, version: FILE_VERSION, saved: new Date().toISOString(),
      project: S.project, structure: S.structure, volt: S.volt, led: S.led, custom: S.custom }, null, 2);
  }
  // returns null when loaded, or the reason it could not be
  function fromFile(text) {
    let d; try { d = JSON.parse(text); } catch (e) { return 'the file is not valid JSON'; }
    if (!d || d.app !== FILE_APP) return 'this is not a GH design file';
    for (const k of ['project', 'structure', 'volt', 'led', 'custom']) {
      const src = d[k] || {}, out = clone(DEF[k]);
      for (const key of Object.keys(out)) if (src[key] !== undefined && typeof src[key] === typeof out[key] || (out[key] === null && src[key] !== undefined)) out[key] = src[key];
      Object.keys(S[k]).forEach(key => delete S[k][key]); Object.assign(S[k], out);
    }
    S.imported = null;
    geoCache = null; persist();
    for (const fn of listeners) fn('loaded');
    return null;
  }

  GHD.Model = { S, DEF, on, set, changed, reset, geometry, greenhouse, patterns, patternOf, pose, persist, toFile, fromFile };
})();
