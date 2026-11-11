/* LEDs tab (from the Voltiris LED lab): settings -> light engine (worker) -> numbers, section, crop map, 3D, pop-ups with the calculation.
   The greenhouse (chapel width, truss spacing, truss top and depth, module lines) comes from the Structure tab through the model,
   Voltiris on/off and the night position from the Voltiris tab. This tab owns Model.S.led and Model.S.custom. */
(function () {
  'use strict';
  const GHD = window.GHD, Model = GHD.Model, DATA = GHD.DATA, Engine = window.LedEngine;
  const D2R = Math.PI / 180;
  const { $, $$, nf, pct, m2, esc } = GHD.util;

  // beams, photometric files, colour ramp and beam polar: js/leds/photometry.js
  const { cosnN, beamDist, parseIES, parseLDT, ramp, LO, HI, drawPolar } = GHD.LedPhoto;

  // ------------------------------------------------------------------ LED datasheets (public sources)
  const SRC = GHD.LIB.sources;
  const LIB = GHD.LIB.fixtures;
  const libById = id => LIB.find(f => f.id === id) || LIB[0];

  // ------------------------------------------------------------------ state
  const S = Model.S;   // S.led, S.custom and S.imported belong to this tab; S.volt and the structure are read only here
  // greenhouse seen by the light engine, in m
  function GH() { const gh = Model.greenhouse(); return { W: gh.W, L: gh.L, top: gh.top, depth: gh.depth, crop: gh.crop, pivot: gh.pivot }; }
  let three = null, t3timer = 0, optBusy = false, optId = 0;
  let active = false, stale = true, forced = false;   // the light runs only while this tab is open, or when the report asks for it

  const KIT = DATA.kit;
  const LOW_FIXED = Math.min(...KIT.at_I.map(p => p.z[0]), ...KIT.line.map(p => p.z[0]), ...KIT.static.map(b => b.c[2] - b.h[2])); // lowest fixed part, below the pivot
  const CLEAR = 0.05;                                 // gap kept under the lowest Voltiris part

  function fixture() {
    const f = libById(S.led.id);
    if (f.custom) {
      const c = S.custom;
      return Object.assign({}, f, { size: [c.L, c.W, 120], variants: [{ label: `Beam ${c.angle}°`, ppf: c.ppf, watt: c.watt, eff: c.ppf && c.watt ? nf(c.ppf / c.watt, 2) : null, beam: { angle: c.angle } }] });
    }
    return f;
  }
  function variant() {
    const f = fixture();
    if (S.imported && S.led.v === -1) return Object.assign({}, f.variants[0], { label: 'File: ' + S.imported.name, beam: { dist: S.imported.dist } });
    return f.variants[Math.max(0, Math.min(S.led.v, f.variants.length - 1))];
  }
  function geo() {
    const g = GH(), f = fixture();
    const lines = Model.greenhouse().lines.length;
    const PZ = g.pivot, tb = g.top - g.depth;   // module pivot from the I installation height (Structure tab)
    const H = f.size[2] / 1000;
    const faceTruss = tb - H;
    const faceBelowMax = PZ + LOW_FIXED - CLEAR - H;
    const hTruss = faceTruss - g.crop, hBelowMax = faceBelowMax - g.crop;
    return { lines, PZ, tb, H, faceTruss, faceBelowMax, hTruss, hBelowMax, zLow: PZ + LOW_FIXED };
  }
  // module line positions across one chapel (bracket line and I attachments from the Structure tab), m from the left pillar
  function lineXs() { return Model.greenhouse().lines.map(l => l.x); }
  // the settings an optimised position set belongs to; when they change, the LEDs fall back to the centred positions
  function sigNow() { return JSON.stringify([GH(), lineXs(), S.volt, S.led.n, S.led.mount, S.led.hBelow, S.led.rot, S.led.id, S.led.v, S.custom, S.imported && S.imported.name]); }
  function posMode() {
    if (S.led.pos === 'manual' && S.led.xs.length === S.led.n) return 'manual';
    if (S.led.pos === 'even' && S.led.xs.length === S.led.n && S.led.sig === sigNow()) return 'even';
    return 'centred';
  }
  // LED positions across the chapel: the user's set, a regular grid, or (on the truss) the centres of the gaps between module lines
  function slotsFor(mount, n, voltOn, usePos) {
    const W = GH().W;
    if (usePos && posMode() !== 'centred') return S.led.xs.map(x => Math.max(0, Math.min(W, x))).sort((a, b) => a - b);
    const grid = Array.from({ length: n }, (_, i) => (i + 0.5) * W / n);
    if (mount !== 'truss' || !voltOn) return grid;
    const xs = lineXs(), gaps = xs.map((x, k) => ((x + (k + 1 < xs.length ? xs[k + 1] : xs[0] + W)) / 2) % W);
    const cyc = (a, b) => { const d = Math.abs(a - b) % W; return Math.min(d, W - d); };
    const used = new Set(), out = [];
    for (const x of grid) {
      let best = -1, bd = Infinity;
      gaps.forEach((gx, k) => { if (!used.has(k) && cyc(gx, x) < bd) { bd = cyc(gx, x); best = k; } });
      if (best < 0) return grid;
      used.add(best); out.push(gaps[best]);
    }
    return out.sort((a, b) => a - b);
  }
  // free range of each LED inside its gap: keeps 5 cm between the LED end and the I-structure
  function freeRanges(base) {
    const G = geo(), W = GH().W, n = S.led.n, f = fixture(), hx = (S.led.rot ? f.size[1] : f.size[0]) / 2000;
    if (S.led.mount === 'truss' && S.volt.on) {
      const xs = lineXs(G), clr = hx + 0.0275 + 0.05;
      return base.map(x => {
        let lo = -Infinity, hi = Infinity;
        for (const X of xs) for (const sh of [-1, 0, 1]) { const Y = X + sh * W; if (Y <= x && Y > lo) lo = Y; if (Y >= x && Y < hi) hi = Y; }
        const a = lo + clr, b = hi - clr; return a <= b ? [a, b] : [x, x];
      });
    }
    const m = Math.min(hx, W / n / 2 - 0.05);
    return base.map((x, i) => [i * W / n + m, (i + 1) * W / n - m]);
  }
  function hBelow() { const G = geo(); const v = S.led.hBelow == null ? G.hBelowMax : Math.min(S.led.hBelow, G.hBelowMax); return Math.max(0.6, v); }
  function cfgFor(opts) {
    // opts: { mount, voltOn, slotsMount }
    const g = GH(), G = geo(), f = fixture(), v = variant();
    const mount = opts.mount || S.led.mount, voltOn = opts.voltOn != null ? opts.voltOn : S.volt.on;
    const face = mount === 'truss' ? G.faceTruss : g.crop + (opts.hBelow != null ? opts.hBelow : hBelow());
    const slots = opts.slots || slotsFor(opts.slotsMount || mount, S.led.n, opts.gapSlots != null ? opts.gapSlots : voltOn, opts.usePos != null ? opts.usePos : true);
    return Object.assign(Engine.defaults(), {
      W: g.W, L: g.L, lineXs: Model.greenhouse().lines.map(l => ({ x: l.x, kind: l.kind })), patA: Model.patterns(g.L).A, patB: Model.patterns(g.L).B,
      trussTop: g.top, trussDepth: g.depth, crop: g.crop,
      fix: { L: f.size[0] / 1000, W: f.size[1] / 1000, H: f.size[2] / 1000 },
      slots, ledY: 0, ledFace: face, ppf: v.ppf * S.led.dim / 100, dist: beamDist(v.beam), rot90: !!S.led.rot,
      pivotZ: g.pivot, pose: Model.pose(),
    });
  }
  const nominal = () => S.led.n * variant().ppf * S.led.dim / 100 / (GH().W * GH().L);

  // ------------------------------------------------------------------ worker
  let worker = null;
  try { worker = new Worker('js/worker.js'); worker.postMessage({ type: 'kit', kit: KIT }); }
  catch (e) { worker = null; }
  const R = { main: null, ref: null, cmp: {}, id: 0, cfg: null, refCfg: null, cmpCfg: {}, busy: false };
  const probeWaiters = new Map(); let probeReq = 0;
  // nearby LEDs: the fixture face is sampled nL x 2 times (about every 7 cm along it), so thin parts cast soft shadows
  const faceN = (cfg, nMax) => Math.max(5, Math.min(nMax, Math.round(cfg.fix.L / 0.07)));
  const FAST = { ng: 48, nc: 96, nsub: 1, res: 0.25, reach: [4, 5], smooth: true };
  const MID = cfg => ({ ng: 90, nc: 180, res: 0.125, reach: [5, 6], smooth: true, area: { nL: faceN(cfg, 9), nW: 2, ng: 60, nc: 120, near: 1, farN: [7, 2] } });
  const FULL = cfg => ({ ng: 120, nc: 240, res: 0.1, reach: [6, 8], smooth: true, area: { nL: faceN(cfg, 15), nW: 2, ng: 60, nc: 120, near: 1, farN: [7, 2] } });

  function jobsNow() {
    const main = cfgFor({}), ref = cfgFor({ voltOn: false, gapSlots: S.volt.on });
    const G = geo();
    const cmp = {
      truss: cfgFor({ mount: 'truss', voltOn: true, usePos: S.led.mount === 'truss' }),
      below: cfgFor({ mount: 'below', voltOn: true, hBelow: G.hBelowMax, usePos: S.led.mount === 'below' }),
      none: cfgFor({ mount: 'truss', voltOn: false, gapSlots: false, usePos: false }),
    };
    R.cfg = main; R.refCfg = ref; R.cmpCfg = cmp;
    const vOn = S.volt.on;
    const jobs = [
      { key: 'main', stage: 'fast', cfg: main, opts: Object.assign({ noModules: !vOn }, FAST) },
      { key: 'ref', stage: 'fast', cfg: ref, opts: Object.assign({ noModules: true }, FAST) },
      { key: 'main', stage: 'full', cfg: main, opts: Object.assign({ noModules: !vOn, keep: true }, FULL(main)), section: true },
      { key: 'ref', stage: 'full', cfg: ref, opts: Object.assign({ noModules: true }, FULL(ref)) },
      { key: 'cmp:truss', stage: 'mid', cfg: cmp.truss, opts: Object.assign({ noModules: false }, MID(cmp.truss)) },
      { key: 'cmp:below', stage: 'mid', cfg: cmp.below, opts: Object.assign({ noModules: false }, MID(cmp.below)) },
      { key: 'cmp:none', stage: 'mid', cfg: cmp.none, opts: Object.assign({ noModules: true }, MID(cmp.none)) },
    ];
    return jobs;
  }
  let timer = 0;
  function schedule(delay) {
    if (!active && !forced) { stale = true; clearTimeout(timer); setStatus(false); return; }
    stale = false;
    clearTimeout(timer);
    timer = setTimeout(runNow, delay == null ? 90 : delay);
    setStatus(true);
  }

  function runNow() {
    const jobs = jobsNow();
    R.id++;
    R.cmp = {};
    if (worker) worker.postMessage({ type: 'run', id: R.id, jobs: jobs.map(j => ({ key: j.key, stage: j.stage, cfg: stripCfg(j.cfg), opts: j.opts, section: j.section })) });
    else runInline(jobs, R.id);
    renderStatic();
  }
  function stripCfg(c) { return JSON.parse(JSON.stringify(c)); }
  function runInline(jobs, id) {   // fallback without workers: run the fast and full main jobs on this thread
    let k = 0;
    const step = () => {
      if (id !== R.id || k >= jobs.length) { if (id === R.id) setStatus(false); return; }
      const j = jobs[k++];
      const r = Engine.run(j.cfg, KIT, null, j.opts);
      onResult(id, Object.assign({ key: j.key, stage: j.stage }, r, extremesOf(r)));
      setTimeout(step, 0);
    };
    step();
  }
  function extremesOf(r) {
    let mn = Infinity, mx = -Infinity, kmn = 0, kmx = 0;
    for (let i = 0; i < r.E.length; i++) { const v = r.E[i]; if (v < mn) { mn = v; kmn = i; } if (v > mx) { mx = v; kmx = i; } }
    const at = k => ({ x: (k % r.nx + 0.5) * r.res, y: (Math.floor(k / r.nx) + 0.5) * r.res });
    return { minAt: at(kmn), maxAt: at(kmx) };
  }
  if (worker) worker.onmessage = e => {
    const m = e.data;
    if (m.type === 'result') onResult(m.id, m.res);
    else if (m.type === 'done') { if (m.id === R.id) setStatus(false); }
    else if (m.type === 'probe') { const f = probeWaiters.get(m.req); if (f) { probeWaiters.delete(m.req); f(m.d); } }
    else if (m.type === 'error') { console.warn('engine:', m.message); }
    else if (m.type === 'optprog') { if (m.id === optId) $('#posNote').textContent = `Testing positions… ${Math.round(100 * m.f)}%`; }
    else if (m.type === 'optdone') { if (m.id === optId) optDone(m.xs, m.u); }
  };
  function onResult(id, res) {
    if (id !== R.id) return;
    if (res.key === 'main') { if (!(R.main && R.main.stage === 'full' && res.stage === 'fast')) R.main = res; renderResults(); }
    else if (res.key === 'ref') { if (!(R.ref && R.ref.stage === 'full' && res.stage === 'fast')) R.ref = res; renderResults(); }
    else if (res.key.startsWith('cmp:')) { R.cmp[res.key.slice(4)] = res; renderCompare(); }
    if (res.key === 'main') { renderCompare(); updateCrop3d(); }
  }
  function probe(x, y) {
    return new Promise(resolve => {
      if (!worker) { resolve(null); return; }
      const req = ++probeReq; probeWaiters.set(req, resolve);
      worker.postMessage({ type: 'probe', id: R.id, req, x, y });
      setTimeout(() => { if (probeWaiters.has(req)) { probeWaiters.delete(req); resolve(null); } }, 4000);
    });
  }
  function setStatus(busy) {
    R.busy = busy;
    const el = $('#status'); el.classList.toggle('busy', busy);
    el.lastElementChild.textContent = busy ? 'Calculating the light…' : stale ? 'Light not calculated yet' : 'Light up to date';
  }


  // ------------------------------------------------------------------ controls
  function bindRange(id, get, set, fmtv) {
    const el = $('#' + id), out = $('#' + id + 'o');
    el.value = get();
    const show = () => { if (out) out.textContent = fmtv(Number(el.value)); };
    el.addEventListener('input', () => { set(Number(el.value)); show(); afterChange(); });
    show();
    return { el, sync: () => { el.value = get(); show(); } };
  }
  const ranges = [];
  function afterChange(opts) { Model.changed('led'); renderStatic(); schedule(opts && opts.now ? 0 : undefined); }


  // LEDs
  $$('[data-mount]').forEach(b => b.addEventListener('click', () => { S.led.mount = b.dataset.mount; afterChange({ now: true }); }));
  $$('#perBaySeg [data-n]').forEach(b => b.addEventListener('click', () => { S.led.n = Number(b.dataset.n); afterChange({ now: true }); }));
  // LED positions across the chapel
  $$('#posSeg [data-pos]').forEach(b => b.addEventListener('click', () => {
    const m = b.dataset.pos;
    if (m === 'even') { optimisePositions(); return; }
    if (m === 'manual') S.led.xs = cfgFor({}).slots.slice();
    S.led.pos = m; afterChange({ now: true });
  }));
  $('#posFields').addEventListener('change', e => {
    const i = Number(e.target.dataset.i); if (!isFinite(i)) return;
    let v = Number(e.target.value); if (!isFinite(v)) return;
    v = Math.max(0, Math.min(GH().W, v)); S.led.xs[i] = v; S.led.pos = 'manual'; afterChange({ now: true });
  });
  function optimisePositions() {
    if (optBusy) return;
    const base = cfgFor({ usePos: false }), iv = freeRanges(base.slots);
    if (iv.every(([a, b]) => b - a < 0.01)) { $('#posNote').textContent = 'The LEDs have no room to move between the module lines.'; return; }
    optBusy = true; optId++;
    $$('#posSeg button').forEach(b => { b.disabled = true; });
    $('#posNote').textContent = 'Testing positions…';
    const msg = { type: 'optimise', id: optId, cfg: stripCfg(base), iv, start: base.slots.slice(), noModules: !S.volt.on };
    if (worker) worker.postMessage(msg);
    else setTimeout(() => { const r = optimiseInline(msg); optDone(r.xs, r.u); }, 30);
  }
  function optimiseInline(m) {   // same search on this thread, coarser
    const FASTO = { ng: 48, nc: 96, res: 0.25, smooth: true, reach: [4, 5], area: { nL: 5, nW: 1, ng: 32, nc: 64, near: 1, farN: [3, 1] } };
    const ev = xs => Engine.run(Object.assign({}, m.cfg, { slots: xs.slice().sort((a, b) => a - b) }), KIT, null, Object.assign({ noModules: m.noModules }, FASTO)).uMinAvg;
    let xs = m.start.slice(), best = ev(xs);
    for (let i = 0; i < m.iv.length; i++) { const [a, b] = m.iv[i]; if (b - a < 1e-6) continue; for (let t = 0; t <= 6; t++) { const tr = xs.slice(); tr[i] = a + (b - a) * t / 6; const u = ev(tr); if (u > best + 1e-5) { best = u; xs = tr; } } }
    return { xs, u: best };
  }
  function optDone(xs, u) {
    optBusy = false; $$('#posSeg button').forEach(b => { b.disabled = false; });
    S.led.xs = xs.slice().sort((a, b) => a - b); S.led.pos = 'even'; S.led.sig = sigNow();
    afterChange({ now: true });
    $('#posNote').textContent = `Most even positions: ${S.led.xs.map(x => nf(x, 2)).join(' m, ')} m from the left pillar (quick estimate ${nf(u, 2)}; the full result is above).`;
  }
  ranges.push(bindRange('ledH', () => S.led.mount === 'truss' ? geo().hTruss : hBelow(), v => { if (S.led.mount === 'below') S.led.hBelow = v; }, v => m2(v)));
  ranges.push(bindRange('ledDim', () => S.led.dim, v => { S.led.dim = v; }, v => v + '%'));
  ranges.push(bindRange('ledHours', () => S.led.hours, v => { S.led.hours = v; }, v => v + ' h'));
  $('#ledRot').checked = S.led.rot;
  $('#ledRot').addEventListener('change', e => { S.led.rot = e.target.checked; afterChange({ now: true }); });
  $('#ledVariant').addEventListener('change', e => { S.led.v = Number(e.target.value); afterChange({ now: true }); });
  for (const [id, key] of [['cPpf', 'ppf'], ['cW', 'watt'], ['cAngle', 'angle']]) {
    $('#' + id).value = S.custom[key];
    $('#' + id).addEventListener('change', e => { const v = Number(e.target.value); if (v > 0) { S.custom[key] = key === 'angle' ? Math.max(60, Math.min(170, v)) : v; e.target.value = S.custom[key]; afterChange({ now: true }); } });
  }
  $('#cLen').value = `${S.custom.L} × ${S.custom.W}`;
  $('#cLen').addEventListener('change', e => { const m = String(e.target.value).match(/(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/i); if (m) { S.custom.L = Math.max(100, Math.min(2500, +m[1])); S.custom.W = Math.max(30, Math.min(800, +m[2])); } e.target.value = `${S.custom.L} × ${S.custom.W}`; afterChange({ now: true }); });
  $('#chooseLed').addEventListener('click', () => openPop('library'));
  $('#beamInfo').addEventListener('click', () => openPop('beam'));
  $('#ledPolar').addEventListener('click', () => openPop('beam'));

  // photometric files
  $('#iesFile').addEventListener('change', e => {
    const file = e.target.files && e.target.files[0]; if (!file) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const txt = String(rd.result);
        const d = /\.ldt$/i.test(file.name) || !/TILT=/.test(txt) ? parseLDT(txt) : parseIES(txt);
        S.imported = { name: file.name, dist: d }; S.led.v = -1;
        $('#iesNote').textContent = `Loaded ${file.name}. The beam shape comes from the file; the PPF stays as set.`;
        afterChange({ now: true });
      } catch (err) { $('#iesNote').textContent = `Could not read ${file.name}: ${err.message}.`; }
    };
    rd.readAsText(file);
  });

  // ------------------------------------------------------------------ colours
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function palette(print) {
    if (print) return { bg: '#FFFFFF', ink: '#001D3B', ink2: '#40598A', ink3: '#6B7F9E', line: '#D9E2EF', line2: '#B8C0CC', accent: '#00C9A5', accentInk: '#00745F', surface2: '#EEF3FA', tint: '#E6F0FF', crop: '#5FB58A', cropDark: '#2F7A57', steel: '#40598A', cut: '#001D3B', beyond: '#C9D6E8', warn: '#9A5B00' };
    const dark = css('--bg').toLowerCase() === '#07121e';
    return { bg: css('--surface'), ink: css('--ink'), ink2: css('--ink-2'), ink3: css('--ink-3'), line: css('--line'), line2: css('--line-2'), accent: css('--accent'), accentInk: css('--accent-ink'), surface2: css('--surface-2'), tint: css('--tint'),
      crop: dark ? '#2E7D5B' : '#5FB58A', cropDark: dark ? '#57C493' : '#2F7A57', steel: dark ? '#7F9CC9' : '#40598A', cut: dark ? '#DCE6F5' : '#001D3B', beyond: dark ? '#2A4466' : '#C9D6E8', warn: css('--warn') };
  }
  // ------------------------------------------------------------------ section drawing
  function hull(pts) {
    pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  function boxCorners(b) {
    const r = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) r.push([
      b.c[0] + sx * b.h[0] * b.u[0] + sy * b.h[1] * b.u[3] + sz * b.h[2] * b.u[6],
      b.c[1] + sx * b.h[0] * b.u[1] + sy * b.h[1] * b.u[4] + sz * b.h[2] * b.u[7],
      b.c[2] + sx * b.h[0] * b.u[2] + sy * b.h[1] * b.u[5] + sz * b.h[2] * b.u[8]]);
    return r;
  }
  function drawSection(ctx, Wpx, Hpx, pal, cfg, res, opts) {
    opts = opts || {};
    const g = GH(), G = geo(), voltOn = opts.voltOn != null ? opts.voltOn : S.volt.on;
    const fs = opts.fs || (opts.compact ? 10 : 11);
    const font = (w, s) => `${w} ${s}px Lexend, 'Lexend Light', system-ui, sans-serif`;
    const levels = [['Truss top', g.top], ['Truss bottom', G.tb], ['LED', cfg.ledFace], ['Crop top', g.crop], ['Floor', 0]];
    if (voltOn) levels.splice(2, 0, ['Voltiris lowest', G.zLow]);
    ctx.save();
    ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, Wpx, Hpx);
    ctx.font = font(300, fs);
    const labW = Math.max(...levels.map(([n, z]) => ctx.measureText(`${n} ${nf(z, 2)}`).width));
    const pad = { l: Math.ceil(labW) + 18, r: 10, t: 14, b: 16 };
    const gutter = g.top + 0.18, ridge = gutter + g.W / 4 * Math.tan(22 * D2R), z0 = 0, z1 = ridge + 0.15;
    const availW = Wpx - pad.l - pad.r, availH = Hpx - pad.t - pad.b;
    let sc = availH / (z1 - z0), span = availW / sc;
    if (span < g.W + 0.7) { span = g.W + 0.7; sc = availW / span; }
    span = Math.min(span, 2 * g.W + 1);
    const x0 = g.W / 2 - span / 2, x1 = g.W / 2 + span / 2;
    const ox = pad.l + (availW - sc * span) / 2, oy = pad.t + (availH + sc * (z1 - z0)) / 2;
    const X = x => ox + (x - x0) * sc, Z = z => oy - (z - z0) * sc;
    const i0 = Math.floor(x0 / g.W) - 1, i1 = Math.ceil(x1 / g.W);
    ctx.save();
    ctx.beginPath(); ctx.rect(X(x0), Z(z1), span * sc, (z1 - z0) * sc); ctx.clip();

    // floor and crop
    ctx.fillStyle = pal.surface2; ctx.fillRect(X(x0), Z(0), span * sc, 3);
    const rows = Math.max(4, Math.round(g.W / 1.07));
    for (let i = i0; i <= i1; i++) for (let k = 0; k < rows; k++) {
      const cx = i * g.W + (k + 0.5) * g.W / rows, w = Math.min(0.55, g.W / rows * 0.6);
      if (cx < x0 - 1 || cx > x1 + 1) continue;
      ctx.strokeStyle = pal.line2; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(X(cx), Z(0)); ctx.lineTo(X(cx), Z(Math.max(0, g.crop - 0.6))); ctx.stroke();
      ctx.fillStyle = pal.crop; ctx.globalAlpha = 0.55;
      ctx.beginPath(); ctx.ellipse(X(cx), Z(g.crop - 0.28), w / 2 * sc, 0.28 * sc, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.setLineDash([4, 4]); ctx.strokeStyle = pal.cropDark; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(X(x0), Z(g.crop)); ctx.lineTo(X(x1), Z(g.crop)); ctx.stroke(); ctx.setLineDash([]);

    // LED light in the plane of the truss (the pattern repeats in every chapel)
    if (res && res.section) {
      for (const led of res.section) {          // fans of the middle chapel only, so each one stays readable
        const lx = led.x;
        if (lx < x0 - 6 || lx > x1 + 6) continue;
        for (const ray of led.rays) {
          const a = Math.max(0, Math.min(1, ray.I));
          if (a < 0.02) continue;
          const hw = (ray.dg || 1) / 2, G0 = (ray.g - hw) * D2R, G1 = (ray.g + hw) * D2R, tc = Math.min(30, ray.tCrop);
          const e0 = [lx + ray.side * Math.sin(G0) * tc, led.z - Math.cos(G0) * tc], e1 = [lx + ray.side * Math.sin(G1) * tc, led.z - Math.cos(G1) * tc];
          ctx.beginPath(); ctx.moveTo(X(lx), Z(led.z)); ctx.lineTo(X(e0[0]), Z(e0[1])); ctx.lineTo(X(e1[0]), Z(e1[1])); ctx.closePath();
          ctx.fillStyle = pal.accent; ctx.globalAlpha = 0.34 * a * ray.T; ctx.fill();
          if (ray.T < 0.98) { ctx.fillStyle = pal.ink3; ctx.globalAlpha = 0.4 * a * (1 - ray.T); ctx.fill(); }
        }
      }
      ctx.globalAlpha = 1;
    }

    // greenhouse: roof, pillars and the truss members from the Structure tab
    const tan = Math.tan(22 * D2R), gh = Model.greenhouse(), pw = gh.pw;
    ctx.strokeStyle = pal.line2; ctx.lineWidth = 1.2; ctx.beginPath();
    for (let i = i0; i <= i1; i++) {
      const b = i * g.W + pw / 2, pts = [[b, gutter], [b + g.W / 4, ridge], [b + g.W / 2, gutter], [b + 3 * g.W / 4, ridge], [b + g.W, gutter]];
      pts.forEach((p, k) => k ? ctx.lineTo(X(p[0]), Z(p[1])) : ctx.moveTo(X(p[0]), Z(p[1])));
    }
    ctx.stroke();
    ctx.strokeStyle = pal.steel; ctx.lineWidth = 0.8;
    for (let i = i0; i <= i1 + 1; i++) {
      const x = i * g.W; ctx.fillStyle = pal.beyond; ctx.fillRect(X(x), Z(g.top), pw * sc, g.top * sc); ctx.strokeRect(X(x), Z(g.top), pw * sc, g.top * sc);
    }
    ctx.fillStyle = pal.steel;
    for (let i = i0; i <= i1; i++) for (const m of gh.geom.members) {
      ctx.beginPath(); m.pts.forEach(([x, y], k) => { const px = X(i * g.W + x / 1000), pz = Z(G.tb + y / 1000); k ? ctx.lineTo(px, pz) : ctx.moveTo(px, pz); }); ctx.closePath(); ctx.fill();
    }

    // Voltiris parts: cut by the plane of the truss (dark), further along the bay (light)
    if (voltOn) {
      const boxes = Engine.buildBoxes(cfg, KIT, i0, i1, 0, 0);
      const list = [];
      for (const b of boxes) {
        const cs = boxCorners(b);
        if (!cs.some(p => p[0] > x0 - 0.3 && p[0] < x1 + 0.3)) continue;
        const ys = cs.map(p => p[1]), ymin = Math.min(...ys), ymax = Math.max(...ys);
        if (ymin > g.L - 0.3) continue;             // parts of the next truss sit behind the cut ones
        list.push({ cs, cut: ymin <= 0.02 && ymax >= -0.02, ymid: (ymin + ymax) / 2 });
      }
      list.sort((a, b) => (a.cut - b.cut) || (b.ymid - a.ymid));
      for (const o of list) {
        const hp = hull(o.cs.map(p => [p[0], p[2]]));
        ctx.beginPath(); hp.forEach((p, k) => k ? ctx.lineTo(X(p[0]), Z(p[1])) : ctx.moveTo(X(p[0]), Z(p[1]))); ctx.closePath();
        if (o.cut) { ctx.fillStyle = pal.cut; ctx.globalAlpha = 0.9; ctx.fill(); }
        else { ctx.fillStyle = pal.beyond; ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 0.7; ctx.strokeStyle = pal.steel; ctx.lineWidth = 0.5; ctx.stroke(); }
        ctx.globalAlpha = 1;
      }
    }

    // LEDs
    const fL = cfg.rot90 ? cfg.fix.W : cfg.fix.L, fH = cfg.fix.H;
    for (let i = i0; i <= i1; i++) for (const s0 of cfg.slots) {
      const sx = s0 + i * g.W; if (sx < x0 - 1 || sx > x1 + 1) continue;
      ctx.fillStyle = pal.accent; ctx.strokeStyle = pal.cut; ctx.lineWidth = 1;
      ctx.fillRect(X(sx - fL / 2), Z(cfg.ledFace + fH), fL * sc, Math.max(3, fH * sc));
      ctx.strokeRect(X(sx - fL / 2), Z(cfg.ledFace + fH), fL * sc, Math.max(3, fH * sc));
    }

    // dimension: LED face to the crop
    const dx = cfg.slots[0] + fL / 2 + 0.12;
    ctx.strokeStyle = pal.ink; ctx.fillStyle = pal.ink; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(X(dx), Z(cfg.ledFace)); ctx.lineTo(X(dx), Z(g.crop)); ctx.stroke();
    for (const [zz, d] of [[cfg.ledFace, 1], [g.crop, -1]]) { ctx.beginPath(); ctx.moveTo(X(dx), Z(zz)); ctx.lineTo(X(dx) - 3.5, Z(zz) + d * 6); ctx.lineTo(X(dx) + 3.5, Z(zz) + d * 6); ctx.closePath(); ctx.fill(); }
    ctx.font = font(500, fs + 1); ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    const lbl = `${nf(cfg.ledFace - g.crop, 2)} m to the crop`, tw = ctx.measureText(lbl).width;
    ctx.fillStyle = pal.bg; ctx.globalAlpha = 0.88; ctx.fillRect(X(dx) + 5, Z((cfg.ledFace + g.crop) / 2) - 9, tw + 8, 18); ctx.globalAlpha = 1;
    ctx.fillStyle = pal.ink; ctx.fillText(lbl, X(dx) + 9, Z((cfg.ledFace + g.crop) / 2));
    ctx.restore();

    // height scale on the left
    ctx.font = font(300, fs); ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    const sorted = levels.slice().sort((a, b) => b[1] - a[1]);
    let lastY = -99;
    for (const [name, z] of sorted) {
      let yy = Z(z); if (yy - lastY < fs + 2) yy = lastY + fs + 2; lastY = yy;
      ctx.fillStyle = name === 'LED' ? pal.accentInk : pal.ink2;
      ctx.fillText(`${name} ${nf(z, 2)}`, pad.l - 10, yy);
      ctx.strokeStyle = pal.line2; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(pad.l - 7, yy); ctx.lineTo(X(x0) - 1, Z(z)); ctx.stroke();
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------ crop map drawing
  function mapGeom(Wpx) {
    const g = GH(), pad = 2, Hpx = Math.round((Wpx - 2 * pad) * g.L / g.W + 2 * pad);
    const sc = (Wpx - 2 * pad) / g.W;
    return { Hpx, sc, X: x => pad + x * sc, Y: y => pad + (g.L / 2 - y) * sc, pad };
  }
  function drawMap(ctx, Wpx, res, cfg, pal, opts) {
    opts = opts || {};
    const g = GH(), G = geo(), M = mapGeom(Wpx), nom = nominal();
    ctx.save();
    ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, Wpx, M.Hpx);
    if (res) {
      const nx = res.nx, ny = res.ny, img = new ImageData(nx, ny), E = res.E;
      for (let iy = 0; iy < ny; iy++) {
        const yy = (iy + 0.5) * res.res;                    // screen row iy -> y from +L/2 down to -L/2
        const yTop = g.L / 2 - yy, ys = yTop < 0 ? yTop + g.L : yTop;
        const sy = Math.min(ny - 1, Math.max(0, Math.floor(ys / res.res)));
        for (let ix = 0; ix < nx; ix++) {
          const c = ramp(E[sy * nx + ix] / nom), o = 4 * (iy * nx + ix);
          img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
        }
      }
      const off = document.createElement('canvas'); off.width = nx; off.height = ny;
      off.getContext('2d').putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(off, M.X(0), M.Y(g.L / 2), g.W * M.sc, g.L * M.sc);
    }
    // module lines and truss
    ctx.strokeStyle = 'rgba(0,29,59,.55)'; ctx.lineWidth = 1;
    if (S.volt.on) for (const lx of lineXs()) { const x = M.X(lx); ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, M.Y(g.L / 2)); ctx.lineTo(x, M.Y(-g.L / 2)); ctx.stroke(); }
    ctx.setLineDash([]); ctx.strokeStyle = 'rgba(0,29,59,.7)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(M.X(0), M.Y(0)); ctx.lineTo(M.X(g.W), M.Y(0)); ctx.stroke();
    // LEDs
    const fL = cfg.rot90 ? cfg.fix.W : cfg.fix.L, fW = cfg.rot90 ? cfg.fix.L : cfg.fix.W;
    for (const sx of cfg.slots) {
      ctx.fillStyle = '#00C9A5'; ctx.strokeStyle = '#001D3B'; ctx.lineWidth = 1;
      ctx.fillRect(M.X(sx - fL / 2), M.Y(fW / 2), fL * M.sc, Math.max(3, fW * M.sc));
      ctx.strokeRect(M.X(sx - fL / 2), M.Y(fW / 2), fL * M.sc, Math.max(3, fW * M.sc));
    }
    // darkest spot
    if (res && res.minAt && !opts.noMin) {
      const mx = res.minAt.x, my = res.minAt.y > g.L / 2 ? res.minAt.y - g.L : res.minAt.y;
      ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(M.X(mx), M.Y(my), 6, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#001D3B'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(M.X(mx), M.Y(my), 6, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.strokeStyle = pal.line; ctx.lineWidth = 1; ctx.strokeRect(M.X(0) - 0.5, M.Y(g.L / 2) - 0.5, g.W * M.sc + 1, g.L * M.sc + 1);
    ctx.restore();
    return M;
  }
  function drawLegendBar(cv) {
    const ctx = cv.getContext('2d'), w = cv.width, h = cv.height;
    for (let i = 0; i < w; i++) { const c = ramp(LO + (HI - LO) * i / (w - 1)); ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; ctx.fillRect(i, 0, 1, h); }
  }

  // ------------------------------------------------------------------ rendering
  function seg(selector, attr, value) { $$(selector).forEach(b => b.setAttribute('aria-pressed', String(b.dataset[attr] === String(value)))); }
  function renderStatic() {
    const G = geo(), f = fixture(), v = variant();
    seg('[data-mount]', 'mount', S.led.mount);
    seg('#perBaySeg [data-n]', 'n', S.led.n);
    const pm = posMode();
    seg('#posSeg [data-pos]', 'pos', pm);
    { const pf = $('#posFields'), xsNow = cfgFor({}).slots;
      pf.hidden = pm !== 'manual';
      if (pm === 'manual' && (pf.childElementCount !== S.led.n || !pf.contains(document.activeElement)))
        pf.innerHTML = xsNow.map((x, i) => `<label>LED ${i + 1}<input type="number" step="0.01" min="0" max="${nf(GH().W, 2)}" data-i="${i}" value="${x.toFixed(2)}" aria-label="LED ${i + 1} position, m from the left pillar"></label>`).join('');
      if (!optBusy) $('#posNote').textContent = pm === 'centred' ? (S.led.mount === 'truss' && S.volt.on ? `Centred in the gaps between module lines: ${xsNow.map(x => nf(x, 2)).join(', ')} m.` : `Usual grid: ${xsNow.map(x => nf(x, 2)).join(', ')} m.`) + (S.led.pos === 'even' ? ' Settings changed since the last search: press Most even again.' : '')
        : pm === 'manual' ? 'Positions in m from the outer face of the left pillar, for one chapel.' : $('#posNote').textContent; }
    { const g = GH(); $('#ledGh').innerHTML = `Chapels of <b>${m2(g.W)}</b>, trusses every <b>${m2(g.L)}</b>, truss top <b>${m2(g.top)}</b>, ${m2(g.depth)} deep, top of the crop <b>${m2(g.crop)}</b>. ${S.volt.on ? `Voltiris on <b>${G.lines} module lines</b>, ${Model.pose().label.toLowerCase()} at night.` : 'Voltiris switched off.'}`; }
    // LED card
    $('#ledBrand').textContent = f.brand;
    $('#ledModel').textContent = f.model;
    const specs = [['PPF', `${f.custom ? '' : (f.wattTxt ? 'up to ' : '')}${nf(v.ppf)} µmol/s`], ['Power', `${f.wattTxt && !S.imported ? f.wattTxt : nf(v.watt)} W`], ['Efficacy', v.eff ? `${v.eff} µmol/J` : '–'], ['Size', `${f.size[0]} × ${f.size[1]} × ${f.size[2]} mm`]];
    $('#ledSpecs').innerHTML = specs.map(([k, val]) => `<dt>${k}</dt><dd>${esc(val)}</dd>`).join('');
    const src = f.src ? SRC[f.src] : null;
    $('#ledSrc').hidden = !src; if (src) { $('#ledSrc').href = src.url; $('#ledSrc').textContent = 'Datasheet'; }
    const vs = $('#ledVariant');
    const opts = f.variants.map((x, i) => `<option value="${i}">${esc(x.label)}${f.custom ? '' : ' · ' + nf(x.ppf) + ' µmol/s'}</option>`);
    if (S.imported) opts.push(`<option value="-1">File: ${esc(S.imported.name)}</option>`);
    vs.innerHTML = opts.join(''); vs.value = String(S.led.v);
    $('#variantField').hidden = f.variants.length < 2 && !S.imported;
    $('#customFields').hidden = !f.custom;
    const pc = $('#ledPolar');
    drawPolar(pc.getContext('2d'), pc.width, pc.height, palette(false), beamDist(v.beam), { lw: 2.2, top: 8 });
    // height
    const hr = $('#ledH');
    if (S.led.mount === 'truss') { hr.disabled = true; hr.min = 0.5; hr.max = Math.max(1, G.hTruss + 0.5); hr.value = G.hTruss; $('#ledHo').textContent = `${m2(G.hTruss)}, under the truss`; }
    else { hr.disabled = false; hr.min = 0.6; hr.max = Math.max(0.65, G.hBelowMax).toFixed(2); hr.value = hBelow(); $('#ledHo').textContent = m2(hBelow()) + (Math.abs(hBelow() - G.hBelowMax) < 0.01 ? ', as high as possible' : ''); }
    // warnings
    const cfg = cfgFor({});
    const warn = Engine.collide(cfg, KIT, !S.volt.on);
    if (S.volt.on && S.led.mount === 'truss') {
      const hx = (S.led.rot ? f.size[1] : f.size[0]) / 2000, xsL = lineXs(G);
      cfg.slots.forEach((x, i) => {
        let d = Infinity; for (const X of xsL) for (const sh of [-1, 0, 1]) d = Math.min(d, Math.abs(x - (X + sh * GH().W)));
        const gap = d - hx - 0.0275;
        if (gap < 0) warn.push(`LED ${i + 1} overlaps a module line`); else if (gap < 0.049) warn.push(`LED ${i + 1} is only ${Math.round(gap * 100)} cm from an I-structure`);
      });
    }
    if (S.led.mount === 'below' && G.hBelowMax < 0.6) warn.push('there is no room below Voltiris at this crop height');
    $('#ledWarn').hidden = !warn.length;
    $('#ledWarn').textContent = warn.length ? 'Check: ' + warn.join('; ') + '.' : '';
    // section subtitle
    $('#secSub').textContent = `Chapels of ${nf(GH().W, 2)} m, seen along the truss`;
    $('#mapSub').textContent = `One chapel × one truss bay, ${nf(GH().W, 2)} × ${nf(GH().L, 1)} m`;
    renderPower();
    renderLibrary();
    schedule3d();
    if (GHD.Shell) GHD.Shell.summaries();
  }
  function renderPower() {
    const v = variant(), area = GH().W * GH().L, wm2 = S.led.n * v.watt / area;
    $('#powerLine').innerHTML = `<span class="lhs">Installed:</span> ${S.led.n} × ${nf(v.watt)} W ÷ ${nf(area, 1)} m² = <b>${nf(wm2, 1)} W/m²</b> · ${nf(wm2 * 10, 0)} kW/ha · ${nf(S.led.n / area * 10000, 0)} LEDs/ha`;
  }
  function renderResults() {
    const r = R.main, rf = R.ref, nom = nominal();
    if (r) {
      $('#vPpfd').innerHTML = `${nf(r.avg)}<small>µmol/m²s</small>`;
      $('#sPpfd').textContent = S.volt.on && rf ? `${pct(r.avg / nom)} of the ${nf(nom)} the LEDs send · ${nf(rf.avg)} without Voltiris` : `${pct(r.avg / nom)} of the ${nf(nom)} the LEDs send`;
      $('#vU').innerHTML = `${nf(r.uMinAvg, 2)}<small>min/avg</small>`;
      $('#sU').textContent = S.volt.on && rf ? `${nf(rf.uMinAvg, 2)} without Voltiris` : 'Darkest spot ÷ average';
      const dli = r.avg * S.led.hours * 3600 / 1e6;
      $('#vDli').innerHTML = `${nf(dli, 1)}<small>mol/m²/day</small>`;
      $('#sDli').textContent = `${S.led.hours} h of LED light`;
      const lost = r.blocked.reduce((a, b) => a + b, 0) / r.blocked.length;
      $('#vLost').innerHTML = S.volt.on ? `${pct(lost, lost < 0.1 && lost > 0 ? 1 : 0)}` : '–';
      $('#sLost').textContent = !S.volt.on ? 'Voltiris is switched off' : lost < 0.0005 ? 'The LEDs hang below every Voltiris part' : (S.volt.pose === 'park' ? 'of the LED light, modules parked at 60°' : 'of the LED light, modules flat');
      $('#kpiLost').classList.toggle('good', S.volt.on && lost < 0.0005);
    }
    drawAll();
  }
  function renderCompare() {
    const G = geo(), tb = $('#cmpTable tbody');
    const rowsDef = [
      ['truss', 'On the truss', G.hTruss, true],
      ['below', 'Below Voltiris', G.hBelowMax, true],
      ['none', 'Without Voltiris', G.hTruss, false],
    ];
    const cur = !S.volt.on ? (S.led.mount === 'truss' ? 'none' : '') : S.led.mount === 'truss' ? 'truss' : (Math.abs(hBelow() - G.hBelowMax) < 0.01 ? 'below' : '');
    tb.innerHTML = rowsDef.map(([k, label, h, v]) => {
      const r = k === cur && R.main && R.main.stage === 'full' ? R.main : R.cmp[k];
      const lost = r ? r.blocked.reduce((a, b) => a + b, 0) / r.blocked.length : null;
      return `<tr class="${k === cur ? 'cur' : ''}"><td>${label}</td><td class="n">${m2(h)}</td><td class="n">${r ? nf(r.avg) : '…'}</td><td class="n">${r ? nf(r.uMinAvg, 2) : '…'}</td><td class="n">${!v ? '–' : r ? pct(lost, lost > 0 && lost < 0.1 ? 1 : 0) : '…'}</td></tr>`;
    }).join('');
  }
  let lastMapM = null;
  function sizeCanvas(cv, cssW, cssH) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
    cv.style.height = cssH + 'px';
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return ctx;
  }
  function drawAll() {
    const pal = palette(false);
    const sc = $('#secCanvas'), sw = sc.parentElement.clientWidth || 600;
    const sh = Math.max(220, Math.min(340, Math.round(sw * 0.36)));
    drawSection(sizeCanvas(sc, sw, sh), sw, sh, pal, R.cfg || cfgFor({}), R.main && R.main.section ? R.main : null, { compact: sw < 560 });
    const mc = $('#mapCanvas'), mw = mc.parentElement.clientWidth || 600;
    const M = mapGeom(mw);
    lastMapM = drawMap(sizeCanvas(mc, mw, M.Hpx), mw, R.main, R.cfg || cfgFor({}), pal);
    const nom = nominal();
    $('#legMin').textContent = nf(LO * nom); $('#legMax').textContent = nf(HI * nom);
  }

  // map hover and click
  const mapCanvas = $('#mapCanvas'), tip = $('#mapTip');
  function mapPoint(ev) {
    if (!lastMapM) return null;
    const rect = mapCanvas.getBoundingClientRect(), px = ev.clientX - rect.left, py = ev.clientY - rect.top;
    const x = (px - lastMapM.pad) / lastMapM.sc, y = GH().L / 2 - (py - lastMapM.pad) / lastMapM.sc;
    if (x < 0 || x > GH().W || y < -GH().L / 2 || y > GH().L / 2) return null;
    return { x, y, px, py };
  }
  function valueAt(x, y) {
    const r = R.main; if (!r) return null;
    const ys = y < 0 ? y + GH().L : y;
    const ix = Math.min(r.nx - 1, Math.max(0, Math.floor(x / r.res))), iy = Math.min(r.ny - 1, Math.max(0, Math.floor(ys / r.res)));
    return r.E[iy * r.nx + ix];
  }
  mapCanvas.addEventListener('pointermove', ev => {
    const p = mapPoint(ev); if (!p || !R.main) { tip.hidden = true; return; }
    const v = valueAt(p.x, p.y);
    tip.hidden = false; tip.style.left = p.px + 'px'; tip.style.top = p.py + 'px';
    tip.textContent = `${nf(v)} µmol/m²s · ${pct(v / R.main.avg)} of the average`;
  });
  mapCanvas.addEventListener('pointerleave', () => { tip.hidden = true; });
  mapCanvas.addEventListener('click', async ev => {
    const p = mapPoint(ev); if (!p) return;
    openPop('point', { x: p.x, y: p.y, loading: true });
    const d = await probe(p.x, p.y < 0 ? p.y + GH().L : p.y);
    openPop('point', { x: p.x, y: p.y, d });
  });

  // ------------------------------------------------------------------ library table
  let brandFilter = 'All';
  function renderLibrary() {
    const brands = ['All', ...new Set(LIB.filter(f => !f.custom).map(f => f.brand))];
    $('#brandChips').innerHTML = brands.map(b => `<button type="button" data-b="${esc(b)}" aria-pressed="${b === brandFilter}">${esc(b)}</button>`).join('');
    const rows = [];
    for (const f of LIB) {
      if (f.custom || (brandFilter !== 'All' && f.brand !== brandFilter)) continue;
      f.variants.forEach((v, i) => {
        const cur = S.led.id === f.id && S.led.v === i;
        rows.push(`<tr class="${cur ? 'cur' : ''}" data-id="${f.id}" data-v="${i}" tabindex="0" style="cursor:pointer"><td>${i ? '' : esc(f.brand)}</td><td>${i ? '' : esc(f.model)}<div class="hint">${esc(v.label)}</div></td><td class="n">${nf(v.ppf)}</td><td class="n">${f.wattTxt || nf(v.watt)}</td><td class="n">${v.eff || '–'}</td><td class="n">${f.size[0]} × ${f.size[1]} × ${f.size[2]}</td><td class="n">${f.kg != null ? nf(f.kg, 1) : '–'}</td><td>${esc(v.beam.curve ? '150 × 135°' : v.beam.angle + '°')}</td><td>${v.beam.curve ? '<span class="pill m">Measured</span>' : '<span class="pill">Beam angle</span>'}</td><td>${i ? '' : `<a href="${SRC[f.src].url}" target="_blank" rel="noopener">Datasheet</a>`}</td></tr>`);
      });
    }
    $('#libTable tbody').innerHTML = rows.join('');
  }
  $('#brandChips').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; brandFilter = b.dataset.b; renderLibrary(); });
  function pickLed(id, v) { S.led.id = id; S.led.v = v; afterChange({ now: true }); }
  $('#libTable').addEventListener('click', e => { if (e.target.closest('a')) return; const tr = e.target.closest('tr[data-id]'); if (!tr) return; pickLed(tr.dataset.id, Number(tr.dataset.v)); window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); });
  $('#libTable').addEventListener('keydown', e => { if (e.key !== 'Enter') return; const tr = e.target.closest('tr[data-id]'); if (tr) pickLed(tr.dataset.id, Number(tr.dataset.v)); });

  // ------------------------------------------------------------------ pop-ups
  const pop = $('#pop');
  $('#popClose').addEventListener('click', () => pop.close());
  pop.addEventListener('click', e => { if (e.target === pop) pop.close(); });
  $$('[data-pop]').forEach(b => b.addEventListener('click', () => openPop(b.dataset.pop)));
  function openPop(kind, extra) {
    const c = popContent(kind, extra || {});
    $('#popTitle').textContent = c.title; $('#popBody').innerHTML = c.html;
    if (!pop.open) { try { pop.showModal(); } catch (e) { pop.setAttribute('open', ''); } }
    if (c.after) c.after();
  }
  $('#popBody').addEventListener('click', e => {
    const b = e.target.closest('[data-pick]'); if (!b) return;
    const [id, v] = b.dataset.pick.split('|'); pickLed(id, Number(v)); pop.close();
  });
  function avgLost(r) { return r ? r.blocked.reduce((a, b) => a + b, 0) / r.blocked.length : 0; }
  function popContent(kind, x) {
    const r = R.main, rf = R.ref, cfg = R.cfg || cfgFor({}), v = variant(), f = fixture(), g = GH(), nom = nominal(), area = g.W * g.L;
    const ppf = v.ppf * S.led.dim / 100;
    const wait = '<p>The calculation is still running. Open this again in a moment.</p>';
    if (kind === 'ppfd') {
      if (!r) return { title: 'Light on the crop', html: wait };
      return { title: 'Light on the crop', html: `
        <p>PPFD on the top of the crop, averaged over one chapel and one truss bay. Every LED in reach adds its share.</p>
        <ol class="steps">
          <li><b>Light sent.</b> ${S.led.n} LEDs per bay × ${nf(ppf)} µmol/s${S.led.dim < 100 ? ` (${S.led.dim}% of ${nf(v.ppf)})` : ''} ÷ (${nf(g.W, 2)} × ${nf(g.L, 1)} m) = <b>${nf(nom)} µmol/m²s</b>. That is the most the crop could get.</li>
          <li><b>Light at each spot.</b> For every LED: the beam strength toward the spot, times the share that passes Voltiris, times cos γ, divided by the distance squared.</li>
          <li><b>Average.</b> ${nf(r.nx * r.ny)} spots, ${nf(r.res * 100)} cm apart: <b>${nf(r.avg)} µmol/m²s</b>, ${pct(r.avg / nom)} of the light sent.</li>
        </ol>
        <div class="formula"><span class="lhs">E(x, y) =</span> Σ<sub>LEDs</sub> Φ · I(γ, C) ⁄ ∫I · T(γ, C) · cos γ ⁄ d²</div>
        <p>Φ is the PPF of one LED, I the beam shape, T = 1 where the ray passes and 0 where it hits a Voltiris part, γ the angle from straight down, d the distance from the LED.</p>
        ${S.volt.on && rf ? `<p>Same LEDs without Voltiris: <b>${nf(rf.avg)} µmol/m²s</b>. The difference is the light Voltiris blocks.</p>` : ''}
        <p class="hint">The model adds LEDs up to six chapels and eight bays away. Light that goes further, or hits walls, screens or glass, is left out. So even without Voltiris the average sits slightly under the light sent.</p>` };
    }
    if (kind === 'u') {
      if (!r) return { title: 'Uniformity', html: wait };
      const my = r.minAt.y > g.L / 2 ? r.minAt.y - g.L : r.minAt.y;
      return { title: 'Uniformity', html: `
        <p>How even the light is: the darkest spot divided by the average.</p>
        <div class="formula"><span class="lhs">U =</span> E<sub>min</sub> ⁄ E<sub>avg</sub> = ${nf(r.min)} ⁄ ${nf(r.avg)} = <b>${nf(r.uMinAvg, 2)}</b></div>
        <p>The darkest spot is ${nf(r.minAt.x, 2)} m across the chapel and ${nf(Math.abs(my), 2)} m ${my >= 0 ? 'one side' : 'the other side'} of the truss (white ring on the map). The brightest gets ${nf(r.max)} µmol/m²s, so min/max is ${nf(r.uMinMax, 2)}.</p>
        ${S.volt.on && rf ? `<p>Without Voltiris, same LEDs: ${nf(rf.min)} ⁄ ${nf(rf.avg)} = <b>${nf(rf.uMinAvg, 2)}</b>.</p>` : ''}
        <p class="hint">Growers and LED suppliers often quote min/avg; some plans quote min/max. Both are shown here.</p>` };
    }
    if (kind === 'dli') {
      if (!r) return { title: 'Daily light', html: wait };
      const dli = r.avg * S.led.hours * 3600 / 1e6;
      return { title: 'Daily light from the LEDs', html: `
        <p>The daily light integral adds up the light over the hours the LEDs are on.</p>
        <div class="formula"><span class="lhs">DLI =</span> ${nf(r.avg)} µmol/m²s × ${S.led.hours} h × 3,600 s/h ⁄ 1,000,000 = <b>${nf(dli, 2)} mol/m²/day</b></div>
        <p>Sunlight through the roof comes on top. Change the light hours in the LED settings.</p>` };
    }
    if (kind === 'lost') {
      if (!S.volt.on) return { title: 'Light blocked by Voltiris', html: '<p>Voltiris is switched off, so nothing is blocked.</p>' };
      if (!r) return { title: 'Light blocked by Voltiris', html: wait };
      const lost = avgLost(r);
      return { title: 'Light blocked by Voltiris', html: `
        <p>Share of the light each LED sends downward that hits a Voltiris part before it reaches the crop.</p>
        <ol class="steps">
          <li>${R.main.stage === 'full' ? 'Each LED face is split into 7 × 2 points. From each point, rays leave every 0.75° in angle and 1.5° around.' : 'Quick preview: each LED is one point, with rays every 1.9° in angle and 3.75° around.'}</li>
          <li>Each ray is tested against every Voltiris part within two chapels and two bays: module frame, receiver, tracker, I-structure, profile, rods and optimisers. The lamellas let PAR through.</li>
          <li>Blocked share = Σ I · (1 − T) · sin γ ⁄ Σ I · sin γ, weighted by the beam shape.</li>
        </ol>
        <table class="t"><thead><tr><th>LED</th><th class="n">Across the chapel</th><th class="n">Blocked</th></tr></thead><tbody>
          ${r.blocked.map((b, i) => `<tr><td>LED ${i + 1}</td><td class="n">${m2(cfg.slots[i])}</td><td class="n">${pct(b, 1)}</td></tr>`).join('')}
          <tr><td><b>Average</b></td><td></td><td class="n"><b>${pct(lost, 1)}</b></td></tr></tbody></table>
        <p>${lost < 0.0005 ? 'Here the LEDs hang below every Voltiris part, so nothing is blocked.' : S.volt.pose === 'park' ? 'At night the modules park at 60°. Flat, they would block more.' : 'Parked at 60° at night, the modules would block less.'} By day the modules track the sun, so the share changes through the day.</p>` };
    }
    if (kind === 'section') {
      return { title: 'Reading the section', html: `
        <p>Chapels seen along the truss. The fans are the light the LEDs of the middle chapel send to their left and right, within 45° of this view: stronger where the beam is stronger. Where Voltiris parts stop part of it, the fan turns grey in proportion. The LEDs of the next chapels do the same.</p>
        <p>Dark shapes sit at the truss (I-structure, profile, rods, optimisers). Light shapes are the modules and trackers further along the bay, between the trusses.</p>
        <p>Heights on the left come from the Structure tab and the crop height. Under the truss there is room only for the LED; below Voltiris the LED must clear the lowest part, ${nf(geo().zLow, 2)} m.</p>` };
    }
    if (kind === 'map') {
      return { title: 'Reading the light map', html: `
        <p>Top view of one chapel (${nf(g.W, 2)} m across) and one truss bay (${nf(g.L, 1)} m), with the truss in the middle. Colours show the light on the top of the crop compared with the light sent (${nf(nom)} µmol/m²s): dark blue is half, light blue is all of it, white is 30% more.</p>
        <p>Teal bars are the LEDs, dashed lines the Voltiris module lines, the white ring the darkest spot. The greenhouse repeats this pattern, so the edges continue into the next chapel and bay.</p>
        <p>Hover to read a value. Click a spot to see how it is calculated, LED by LED.</p>` };
    }
    if (kind === 'compare') {
      const G = geo();
      return { title: 'Where to hang the LEDs', html: `
        <p>The same LEDs in three cases, at a slightly coarser grid than the main result, so the numbers can differ by about 1%.</p>
        <ol class="steps">
          <li><b>On the truss:</b> fixture face ${m2(G.faceTruss)}, ${m2(G.hTruss)} above the crop, in the gaps between module lines so the I-structure and profile stay clear.</li>
          <li><b>Below Voltiris:</b> fixture top ${nf(CLEAR * 100)} cm under the lowest Voltiris part (${m2(G.zLow)}), so ${m2(G.hBelowMax)} above the crop, on a regular grid.</li>
          <li><b>Without Voltiris:</b> on the truss, on a regular grid. The reference for the grower.</li>
        </ol>
        <p>Closer to the crop, the gaps between LEDs are seen at steeper angles, so a wide beam matters more. On the truss, part of the light hits Voltiris, and the parts that hang under the truss leave a slightly darker band along it.</p>` };
    }
    if (kind === 'beam') {
      const d = beamDist(v.beam);
      return { title: 'Beam shape', html: `
        <p><b>${esc(f.brand)} ${esc(f.model)}</b>, ${esc(v.label)}.</p>
        <canvas id="popPolar" width="560" height="290" style="width:100%;max-width:560px;height:auto" role="img" aria-label="Beam shape in two planes"></canvas>
        <div class="legend"><span><span class="sw" style="background:#40598A"></span>Along the fixture (C0)</span><span><span class="sw" style="background:var(--accent)"></span>Across the fixture (C90)</span></div>
        <p>${v.beam.dist ? 'Shape from the loaded photometric file, normalised to its peak.' : v.beam.curve ? 'Measured curve: Signify\'s DIALux diagram of this fixture, read at 1° steps in both planes. Directions between the planes are blended (cos² C and sin² C).' : `The datasheet gives a ${v.beam.angle}° beam angle only. We use the smooth curve that falls to half its peak at ${v.beam.angle / 2}° from straight down: I(γ) = cos<sup>${nf(cosnN(v.beam.angle), 2)}</sup> γ. Real optics may be wider or batwing-shaped: ask the maker for the IES or LDT file and load it in step 3.`}</p>`,
        after: () => { const cv = $('#popPolar'); drawPolar(cv.getContext('2d'), cv.width, cv.height, palette(false), d, { lw: 3, top: 12 }); } };
    }
    if (kind === 'library') {
      return { title: 'Choose an LED', html: `<p>Public datasheets. The beam shape follows the stated beam angle unless a measured curve is marked.</p><div class="libgrid">${LIB.map(fx => fx.variants.map((vv, i) => {
        const cur = S.led.id === fx.id && S.led.v === i;
        return `<div class="libitem ${cur ? 'cur' : ''}"><div><b>${esc(fx.brand)}</b> · ${esc(fx.model)}<div class="meta">${esc(vv.label)}${fx.custom ? ' · set PPF, power and beam angle in step 3' : ` · ${nf(vv.ppf)} µmol/s · ${fx.wattTxt || nf(vv.watt)} W · ${fx.size[0]} × ${fx.size[1]} mm`}${vv.beam.curve ? ' · <span class="pill m">Measured beam</span>' : ''}</div></div><button class="btn" type="button" data-pick="${fx.id}|${i}">${cur ? 'Selected' : 'Use'}</button></div>`;
      }).join('')).join('')}</div>` };
    }
    if (kind === 'point') {
      const ptxt = `${nf(x.x, 2)} m across, ${nf(Math.abs(x.y), 2)} m from the truss`;
      if (x.loading) return { title: 'One spot on the crop', html: `<p>${ptxt}. Calculating…</p>` };
      if (!x.d) return { title: 'One spot on the crop', html: `<p>${ptxt}. The detailed calculation is not ready yet; try again when the status shows Up to date.</p>` };
      const d = x.d, rows = d.list.slice(0, 8);
      return { title: 'One spot on the crop', html: `
        <p>${ptxt}. The LEDs that light it most:</p>
        <div class="tblwrap"><table class="t"><thead><tr><th>LED</th><th class="n">Distance d</th><th class="n">Angle γ</th><th class="n">Beam I</th><th class="n">cos γ</th><th class="n">Passes T</th><th class="n">µmol/m²s</th></tr></thead><tbody>
        ${rows.map(p => `<tr><td>${p.i === 0 && p.j === 0 ? 'This bay' : `${p.i ? (p.i > 0 ? '+' : '') + p.i + ' chapel ' : ''}${p.j ? (p.j > 0 ? '+' : '') + p.j + ' bay' : ''}`.trim()}, LED ${p.s + 1}</td><td class="n">${m2(p.d)}</td><td class="n">${nf(p.gamma, 0)}°</td><td class="n">${nf(p.Irel, 2)}</td><td class="n">${nf(p.cos, 2)}</td><td class="n">${pct(p.T)}</td><td class="n">${nf(p.e, 1)}</td></tr>`).join('')}
        <tr><td colspan="6">All ${d.n} LED images in reach</td><td class="n"><b>${nf(d.e, 1)}</b></td></tr></tbody></table></div>
        <div class="formula"><span class="lhs">share of one LED =</span> Φ · I ⁄ ∫I · T · cos γ ⁄ d²</div>
        <p>Beam I is the beam strength toward the spot, relative to the peak. T is the share of that LED's light toward the spot that passes Voltiris${S.volt.on ? '' : ' (100%, Voltiris is off)'}. Without any blocking this spot would get ${nf(d.e0, 1)} µmol/m²s.</p>` };
    }
    return { title: '', html: '' };
  }

  // ------------------------------------------------------------------ PDF report
  // light plan pages of the report (portrait); RP is the shared page kit from report.js
  function reportPages(RP) {
    {
      const { doc, T, wrapH, NAVY, STEEL, LINE, TINT } = RP;
      const PW = 595.28, PH = 841.89, ML = 36, CW = PW - 2 * ML;
      const r = R.main, rf = R.ref, cfg = R.cfg, v = variant(), f = fixture(), g = GH(), G = geo(), nom = nominal(), area = g.W * g.L;
      const lost = avgLost(r), dli = r.avg * S.led.hours * 3600 / 1e6, ppf = v.ppf * S.led.dim / 100, wm2 = S.led.n * v.watt / area;
      const mountTxt = S.led.mount === 'truss' ? 'on the truss' : 'below Voltiris';
      // continue on a new page when a block whose last baseline is h below y would run into the footer
      const need = (y, h) => { if (y + h <= PH - 42) return y; RP.page('LEDs · light plan', 'p'); return 80; };

      // ---- page 1
      RP.page('LEDs · light plan', 'p');
      T('Light plan', ML, 86, { m: true, s: 20 });
      T(`${S.led.n} × ${f.brand} ${f.model} per truss bay, ${v.label.toLowerCase()}, ${mountTxt}, ${nf(cfg.ledFace - g.crop, 2)} m above the crop`, ML, 104, { c: STEEL, s: 10, w: CW });
      const kp = [
        ['LIGHT ON THE CROP', `${nf(r.avg)}`, 'µmol/m²s', S.volt.on ? `${pct(r.avg / nom)} of ${nf(nom)} sent · ${nf(rf.avg)} without Voltiris` : `${pct(r.avg / nom)} of ${nf(nom)} sent`],
        ['UNIFORMITY', nf(r.uMinAvg, 2), 'min/avg', S.volt.on ? `${nf(rf.uMinAvg, 2)} without Voltiris` : `min/max ${nf(r.uMinMax, 2)}`],
        ['DAILY LIGHT', nf(dli, 1), 'mol/m²/day', `${S.led.hours} h of LED light`],
        ['BLOCKED BY VOLTIRIS', S.volt.on ? pct(lost, lost > 0 && lost < 0.1 ? 1 : 0) : '–', '', S.volt.on ? (lost < 0.0005 ? 'LEDs below every part' : `modules ${S.volt.pose === 'park' ? 'parked at 60°' : 'flat'} at night`) : 'Voltiris off'],
      ];
      const kw = (CW - 3 * 10) / 4;
      kp.forEach((k, i) => {
        const x = ML + i * (kw + 10), y = 120;
        doc.setFillColor(...TINT); doc.roundedRect(x, y, kw, 66, 5, 5, 'F');
        T(k[0], x + 10, y + 16, { c: STEEL, s: 7.5 });
        T(k[1], x + 10, y + 40, { m: true, s: 18 });
        doc.setFont('LexendMedium', 'normal'); doc.setFontSize(18); const vw = doc.getTextWidth(k[1]);
        if (k[2]) T(k[2], x + 14 + vw, y + 40, { c: STEEL, s: 8 });
        T(k[3], x + 10, y + 56, { c: STEEL, s: 7.5, w: kw - 16 });
      });
      // section image
      T('Section', ML, 208, { m: true, s: 11 });
      T(`Chapels of ${nf(g.W, 2)} m, seen along the truss. Teal: LED light; grey: share stopped by Voltiris parts.`, ML + 50, 208, { c: STEEL, s: 8.5 });
      const secW = CW, secH = 200, k = 3;
      const sc = document.createElement('canvas'); sc.width = secW * k; sc.height = secH * k;
      const sctx = sc.getContext('2d'); sctx.scale(k, k);
      drawSection(sctx, secW, secH, palette(true), cfg, r, { fs: 8 });
      doc.addImage(sc.toDataURL('image/png'), 'PNG', ML, 216, secW, secH);
      // map + comparison
      const mapW = 300, mc = document.createElement('canvas');
      const MG = mapGeom(mapW); mc.width = mapW * k; mc.height = MG.Hpx * k;
      const mctx = mc.getContext('2d'); mctx.scale(k, k);
      drawMap(mctx, mapW, r, cfg, palette(true));
      T('Light on the crop', ML, 440, { m: true, s: 11 });
      T(`${nf(g.W, 2)} × ${nf(g.L, 1)} m, truss in the middle. Ring: darkest spot.`, ML, 452, { c: STEEL, s: 8 });
      doc.addImage(mc.toDataURL('image/png'), 'PNG', ML, 460, mapW, MG.Hpx);
      const legY = 460 + MG.Hpx + 10;
      const lb = document.createElement('canvas'); lb.width = 400; lb.height = 20; drawLegendBar(lb);
      T(nf(LO * nom), ML, legY + 6, { c: STEEL, s: 7.5 });
      doc.addImage(lb.toDataURL('image/png'), 'PNG', ML + 26, legY, 120, 7);
      T(`${nf(HI * nom)} µmol/m²s`, ML + 152, legY + 6, { c: STEEL, s: 7.5 });
      // comparison table
      const tx = ML + mapW + 22, tw = CW - mapW - 22;
      T('Where to hang them', tx, 440, { m: true, s: 11 });
      T('Same LEDs, three cases', tx, 452, { c: STEEL, s: 8 });
      const curK = !S.volt.on ? (S.led.mount === 'truss' ? 'none' : '') : S.led.mount === 'truss' ? 'truss' : (Math.abs(hBelow() - G.hBelowMax) < 0.01 ? 'below' : '');
      const pickR = k2 => k2 === curK ? r : R.cmp[k2];
      const cmpRows = [['On the truss', G.hTruss, pickR('truss'), true], ['Below Voltiris', G.hBelowMax, pickR('below'), true], ['No Voltiris', G.hTruss, pickR('none'), false]];
      const keys = ['truss', 'below', 'none'];
      RP.tbl({ startY: 462, tableWidth: tw, margin: { left: tx }, compact: true,
        head: [['Case', RP.right('Height'), RP.right('Light'), RP.right('U'), RP.right('Blocked')]],
        body: cmpRows.map(([name, h, rr, vOn]) => { const lo = rr ? avgLost(rr) : null; return [name, nf(h, 2) + ' m', rr ? nf(rr.avg) : '–', rr ? nf(rr.uMinAvg, 2) : '–', !vOn ? '–' : rr ? pct(lo, lo > 0 && lo < 0.1 ? 1 : 0) : '–']; }),
        columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
        didParseCell: d => { if (d.section === 'body' && keys[d.row.index] === curK) { d.cell.styles.fillColor = [217, 247, 240]; d.cell.styles.font = 'LexendMedium'; } } });
      const ty = doc.lastAutoTable.finalY - 6;
      T('Light in µmol/m²s on the top of the crop. U = darkest spot ÷ average.', tx, ty + 20, { c: STEEL, s: 7.5, w: tw });
      // settings
      let sy = Math.max(legY + 30, ty + 44);
      T('Settings', ML, sy, { m: true, s: 11 }); sy += 8;
      const set = [
        ['Greenhouse', `From the Structure tab: chapel ${nf(g.W, 2)} m, trusses every ${nf(g.L, 2)} m. Truss top ${nf(g.top, 2)} m, depth ${nf(g.depth, 2)} m. Top of the crop ${nf(g.crop, 2)} m.`],
        ['Voltiris', S.volt.on ? `${G.lines} module lines per chapel at ${lineXs().map(x => nf(x, 2)).join(', ')} m from the left pillar. At night the modules are ${S.volt.pose === 'park' ? 'parked at 60°' : 'flat'}. Lowest part ${nf(G.zLow, 2)} m.` : 'Not installed.'],
        ['LEDs', `${f.brand} ${f.model}, ${v.label}. ${nf(v.ppf)} µmol/s${S.led.dim < 100 ? ` at ${S.led.dim}% output (${nf(ppf)})` : ''}, ${f.wattTxt || nf(v.watt)} W. ${S.led.n} per truss per chapel at ${cfg.slots.map(s => nf(s, 2)).join(', ')} m across, ${mountTxt}, face at ${nf(cfg.ledFace, 2)} m${S.led.rot ? ', turned 90°' : ''}.`],
        ['Power', `${nf(wm2, 1)} W/m² installed, ${nf(wm2 * 10)} kW/ha, ${nf(S.led.n / area * 10000)} LEDs/ha.`],
      ];
      for (const [kk, val] of set) {
        sy += 14;
        T(kk, ML, sy, { m: true, s: 8.5 });
        T(val, ML + 80, sy, { s: 8.5, w: CW - 80 });
        sy += wrapH(val, CW - 80, 8.5) - 8.5 * 1.3;
        doc.setDrawColor(...LINE); doc.setLineWidth(0.5); doc.line(ML, sy + 5, PW - ML, sy + 5);
      }

      // ---- page 2
      RP.page('LEDs · calculation', 'p');
      T('How the numbers are calculated', ML, 86, { m: true, s: 16 });
      let y = 108;
      const block = (title, lines) => {
        T(title, ML, y, { m: true, s: 10.5 }); y += 14;
        for (const ln of lines) {
          if (ln.f) { const h = wrapH(ln.f, CW - 20, 9.5) + 8; doc.setFillColor(...TINT); doc.roundedRect(ML, y - 10, CW, h, 3, 3, 'F'); T(ln.f, ML + 10, y + 1, { s: 9.5, w: CW - 20 }); y += h + 4; }
          else { T(ln, ML, y, { s: 9, c: STEEL, w: CW }); y += wrapH(ln, CW, 9) + 3; }
        }
        y += 5;
      };
      block('1. Light sent', [{ f: `${S.led.n} LEDs × ${nf(ppf)} µmol/s ÷ (${nf(g.W, 2)} m × ${nf(g.L, 1)} m) = ${nf(nom)} µmol/m²s` }, 'The most the crop could get if every photon landed on it.']);
      block('2. Light on the crop', [{ f: `Light at a spot = sum over all LEDs of  PPF × I / I total × T × cos(angle) / d²` }, { f: `Average over the bay = ${nf(r.avg)} µmol/m²s, ${pct(r.avg / nom)} of the light sent` },
        `I is the beam strength toward the spot and I total its sum over all directions, T = 1 where a ray passes and 0 where it hits a Voltiris part, the angle is measured from straight down and d is the distance to the LED. Nearby LEDs are split into ${faceN(R.cfg, 15)} × 2 points over their face, so thin parts cast soft shadows as with a real fixture; for further LEDs the shadows are averaged over 7 × 2 face points. Rays at least every 1.5° in angle and 3° around, interpolated in between. LEDs up to 6 chapels and 8 bays away are added. Grid: ${nf(r.nx * r.ny)} spots, ${nf(r.res * 100)} cm apart.${S.volt.on ? ` Without Voltiris the same LEDs give ${nf(rf.avg)} µmol/m²s.` : ''}`]);
      block('3. Uniformity', [{ f: `U = E min / E avg = ${nf(r.min)} / ${nf(r.avg)} = ${nf(r.uMinAvg, 2)}      (min/max = ${nf(r.uMinMax, 2)})` }, S.volt.on ? `Without Voltiris: ${nf(rf.uMinAvg, 2)}.` : 'Darkest spot divided by the average.']);
      block('4. Daily light', [{ f: `DLI = ${nf(r.avg)} µmol/m²s × ${S.led.hours} h × 3,600 s/h / 1,000,000 = ${nf(dli, 2)} mol/m²/day` }, 'From the LEDs only. Sunlight comes on top.']);
      if (S.volt.on) block('5. Light blocked by Voltiris', [{ f: lost < 0.0005 ? 'Blocked = 0%: the LEDs hang below every Voltiris part.' : `Blocked = sum of I × (1 − T) / sum of I, over all rays = ${r.blocked.map(b => pct(b, 1)).join(', ')} per LED, ${pct(lost, 1)} on average` },
        `Parts tested: module frame, receiver, tracker, I-structure, profile, rods, optimisers, as boxes from our 3D model. Lamellas let PAR through. Night position: ${S.volt.pose === 'park' ? 'parked at 60°' : 'flat'}.`]);
      block(S.volt.on ? '6. Installed power' : '5. Installed power', [{ f: `${S.led.n} × ${nf(v.watt)} W / ${nf(area, 1)} m² = ${nf(wm2, 1)} W/m² = ${nf(wm2 * 10)} kW/ha` }]);
      // LED datasheet with beam
      y += 2; y = need(y, 130); T('LED fixture', ML, y, { m: true, s: 10.5 }); y += 8;
      const pc = document.createElement('canvas'); pc.width = 480; pc.height = 250;
      drawPolar(pc.getContext('2d'), pc.width, pc.height, palette(true), beamDist(v.beam), { lw: 3, top: 10 });
      doc.addImage(pc.toDataURL('image/png'), 'PNG', PW - ML - 168, y + 4, 168, 87.5);
      T('Along the fixture (C0)', PW - ML - 168, y + 102, { c: STEEL, s: 7.5 }); T('Across (C90)', PW - ML, y + 102, { c: [0, 116, 95], s: 7.5, a: 'right' });
      const src = f.src ? SRC[f.src] : null;
      const ds = [['Maker', f.brand], ['Fixture', f.model], ['Version', v.label], ['PPF', `${f.wattTxt ? 'up to ' : ''}${nf(v.ppf)} µmol/s`], ['Power', `${f.wattTxt || nf(v.watt)} W`], ['Efficacy', v.eff ? v.eff + ' µmol/J' : '–'], ['Size', `${f.size[0]} × ${f.size[1]} × ${f.size[2]} mm`], ['Weight', f.kg != null ? nf(f.kg, 1) + ' kg' : '–'], ['Beam', v.beam.dist ? 'from the loaded photometric file' : v.beam.curve ? 'measured curve (Signify DIALux diagram)' : `smooth curve with half its peak at ${v.beam.angle / 2}° from straight down (from the ${v.beam.angle}° beam angle)`]];
      let dy = y + 12;
      for (const [kk, val] of ds) { T(kk, ML, dy, { s: 8.5, c: STEEL }); T(val, ML + 62, dy, { s: 8.5, w: CW - 62 - 186 }); dy += Math.max(12, wrapH(val, CW - 62 - 186, 8.5) + 1); }
      if (f.note) { T(f.note, ML, dy + 2, { s: 8, c: STEEL, w: CW - 186 }); dy += wrapH(f.note, CW - 186, 8) + 4; }
      if (src) { T('Source: ' + src.name, ML, dy + 2, { s: 8, c: STEEL, w: CW - 186 }); dy += wrapH('Source: ' + src.name, CW - 186, 8); doc.setTextColor(0, 116, 95); doc.setFont('LexendLight', 'normal'); doc.setFontSize(7.5); doc.textWithLink(src.url.length > 95 ? src.url.slice(0, 92) + '…' : src.url, ML, dy + 4, { url: src.url }); dy += 12; }
      y = Math.max(dy, y + 112) + 9;
      const asum = [
        'The greenhouse repeats chapel after chapel and bay after bay; edge rows and gable walls are not modelled.',
        'No reflections from glass, screens, walls or the crop. Light is counted on the top of the crop.',
        'Voltiris parts are boxes from the DEV7 3D model. The lamellas pass PAR. Modules at their night position.',
        'Beam shapes: where the maker gives only a beam angle, a smooth curve with half its peak at that angle. Real optics may be wider; the IES or LDT file settles it.',
        'All LEDs at the same output. Power at full output from the datasheet.',
      ];
      // keep the assumptions together
      y = need(y, 14 + asum.reduce((t, a) => t + wrapH('·  ' + a, CW, 8.5) + 2, 0) - 13);
      T('Assumptions', ML, y, { m: true, s: 10.5 }); y += 14;
      for (const a of asum) { T('·  ' + a, ML, y, { s: 8.5, c: STEEL, w: CW }); y += wrapH('·  ' + a, CW, 8.5) + 2; }
    }
  }



  // ------------------------------------------------------------------ 3D view: the shared greenhouse, plus the LEDs, the light on the crop and one LED's rays
  const XR = [-1, 2], YR = [-1, 1];
  function initThree() {
    three = GHD.Scene3D.viewer($('#view3d')); three.view = '3d';
    GHD.util.bindFullscreen($('#view3dWrap'), $('#view3dFull'));
    rebuild3d();
  }
  function schedule3d() { if (!three) return; clearTimeout(t3timer); t3timer = setTimeout(rebuild3d, 90); }
  function rebuild3d() {
    if (!three) return;
    const g = GH(), W = g.W, L = g.L, mats = three.mats;
    GHD.Scene3D.addGreenhouse(three, { chapels: XR, trusses: [YR[0], YR[1] + 1], voltiris: S.volt.on, pose: Model.pose() });
    const box = (sx, sy, sz, m) => new THREE.Mesh(new THREE.BoxGeometry(Math.max(sx, 1e-3), Math.max(sy, 1e-3), Math.max(sz, 1e-3)), m);
    const nx = XR[1] - XR[0], ny = YR[1] - YR[0] + 1;
    const cfg = cfgFor({}), f = cfg.fix, ld = three.group('leds');
    for (let i = XR[0]; i < XR[1]; i++) for (let j = YR[0]; j <= YR[1] + 1; j++) for (const sx of cfg.slots) {
      const b = box(cfg.rot90 ? f.W : f.L, cfg.rot90 ? f.L : f.W, f.H, mats.led); b.position.set(i * W + sx, j * L, cfg.ledFace + f.H / 2); ld.add(b);
    }
    const cr = three.group('crop'), tex = document.createElement('canvas'); tex.width = 8; tex.height = 8;
    const t = new THREE.CanvasTexture(tex); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(nx, ny);
    const mat = new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.92 });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(nx * W, ny * L), mat); plane.userData.ownMat = true;
    plane.position.set((XR[0] + nx / 2) * W, YR[0] * L + ny * L / 2, g.crop); cr.add(plane);
    three.crop = { tex, t };
    updateCrop3d(); updateBeam3d(cfg);
    if (three.view !== 'free') setView3d(three.view);
  }
  function updateCrop3d() {
    if (!three || !three.crop || !R.main || !R.main.E) return;
    const r = R.main, { tex, t } = three.crop, nx = r.nx, ny = r.ny, nom = nominal();
    const off = document.createElement('canvas'); off.width = nx + 2; off.height = ny + 2;
    const og = off.getContext('2d'), img = og.createImageData(nx + 2, ny + 2);
    for (let py = 0; py < ny + 2; py++) for (let px = 0; px < nx + 2; px++) {
      const ix = (px - 1 + nx) % nx, iy = (ny - 1 - (py - 1) + ny) % ny;
      const c = ramp(r.E[iy * nx + ix] / nom), o = (py * (nx + 2) + px) * 4;
      img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
    }
    og.putImageData(img, 0, 0);
    const k = 6; tex.width = nx * k; tex.height = ny * k;
    const g2 = tex.getContext('2d'); g2.imageSmoothingEnabled = true; g2.imageSmoothingQuality = 'high';
    g2.drawImage(off, -k, -k, (nx + 2) * k, (ny + 2) * k);
    t.needsUpdate = true;
  }
  // one LED's light as a fan of rays drawn in proportion to its beam: yellow reaches the crop, red ends on a Voltiris part
  function updateBeam3d(cfg) {
    const boxes = S.volt.on ? Engine.buildBoxes(cfg, KIT, -2, 2, -2, 1).filter(b => b.tau < 0.5) : [];
    const rayBox = (p, d, b) => {
      let t0 = 1e-4, t1 = 1e9;
      for (let a = 0; a < 3; a++) {
        const ux = b.u[3 * a], uy = b.u[3 * a + 1], uz = b.u[3 * a + 2];
        const e = (p[0] - b.c[0]) * ux + (p[1] - b.c[1]) * uy + (p[2] - b.c[2]) * uz, f = d[0] * ux + d[1] * uy + d[2] * uz, h = b.h[a];
        if (Math.abs(f) < 1e-9) { if (Math.abs(e) > h) return null; continue; }
        let ta = (-h - e) / f, tb = (h - e) / f; if (ta > tb) { const q = ta; ta = tb; tb = q; }
        if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) return null;
      }
      return t0;
    };
    let seed = 7; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    let mx = 0; for (let g = 0.5; g < 90; g += 1) for (let C = 0; C < 360; C += 5) mx = Math.max(mx, Engine.intensity(cfg.dist, g, C) * Math.sin(g * D2R));
    const N = 200, fl = (cfg.fix && cfg.fix.L) || 1, rot = cfg.rot90 ? 90 : 0, sx = cfg.slots[0], pass = [], hit = [];
    let n = 0, guard = 0;
    while (n < N && guard++ < 2e5) {
      const g = rnd() * 89.5, C = rnd() * 360;
      if (rnd() * mx > Engine.intensity(cfg.dist, g, C) * Math.sin(g * D2R)) continue;
      n++;
      const u = (rnd() - 0.5) * fl * 0.9, p = cfg.rot90 ? [sx, cfg.ledY + u, cfg.ledFace] : [sx + u, cfg.ledY, cfg.ledFace];
      const Cw = (C + rot) * D2R, d = [Math.sin(g * D2R) * Math.cos(Cw), Math.sin(g * D2R) * Math.sin(Cw), -Math.cos(g * D2R)];
      let th = (cfg.ledFace - GH().crop) / Math.cos(g * D2R), blocked = false;
      for (const b of boxes) { const t = rayBox(p, d, b); if (t !== null && t < th) { th = t; blocked = true; } }
      (blocked ? hit : pass).push([p, [p[0] + d[0] * th, p[1] + d[1] * th, p[2] + d[2] * th]]);
    }
    const grp = three.group('beam');
    const up = new THREE.Vector3(0, 1, 0), m = new THREE.Matrix4();
    const fan = (list, color, opacity) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.008, 0.008, 1, 6, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }), list.length);
      list.forEach(([a0, b0], i) => {
        const a = new THREE.Vector3(...a0), b = new THREE.Vector3(...b0), dir = b.clone().sub(a);
        m.compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(up, dir.clone().normalize()), new THREE.Vector3(1, dir.length(), 1)); im.setMatrixAt(i, m);
      });
      im.instanceMatrix.needsUpdate = true; im.userData.ownMat = true; grp.add(im);
    };
    fan(pass, '#ffb000', 0.55); fan(hit, '#ff2d55', 0.95);
    if (hit.length) {
      const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff2d55' }), hit.length);
      hit.forEach(([, b0], i) => { m.makeTranslation(...b0); dots.setMatrixAt(i, m); });
      dots.instanceMatrix.needsUpdate = true; dots.userData.ownMat = true; grp.add(dots);
    }
  }
  function setView3d(view) {
    if (!three) return;
    three.view = view;
    const c = three.camera, t = three.controls, g = GH(), W = g.W, L = g.L, cfg = R.cfg || cfgFor({}), cx = cfg.slots[cfg.slots.length - 1] || W / 2, zc = (g.top + g.crop) / 2;
    if (view === 'section') { c.position.set(cx + 0.8, -15, zc + 0.4); t.target.set(cx + 1.6, 0, zc + 0.2); }
    else if (view === 'top') { c.position.set(W / 2, L / 2 - 0.01, 22); t.target.set(W / 2, L / 2, 2); }
    else { c.position.set(cx - 7.5, -9.5, g.top + 2.3); t.target.set(cx + 1.2, 1.2, zc + 0.7); }
    t.update();
    $$('#viewSeg [data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  }
  $$('#viewSeg [data-view]').forEach(b => b.addEventListener('click', () => setView3d(b.dataset.view)));

  // ------------------------------------------------------------------ tab life cycle
  Model.on(section => {
    if (section === 'loaded') {   // a design file was opened: put its values in the controls
      ranges.forEach(r => r.sync());
      for (const [id, key] of [['cPpf', 'ppf'], ['cW', 'watt'], ['cAngle', 'angle']]) $('#' + id).value = S.custom[key];
      $('#cLen').value = `${S.custom.L} × ${S.custom.W}`; $('#ledRot').checked = S.led.rot;
      $('#iesNote').textContent = "Load the supplier's IES or LDT file to replace the beam shape. The PPF stays as set above.";
    }
    if (section === 'structure' || section === 'volt' || section === 'loaded') { renderStatic(); renderCompare(); if (active) drawAll(); schedule(); }
  });
  const summaryText = () => {
    const f = fixture(), v = variant(), r = R.main, mount = S.led.mount === 'truss' ? 'on the truss' : 'below Voltiris';
    const base = `${S.led.n} × ${f.brand} ${f.model} per truss in each chapel, ${v.label.toLowerCase()}, ${mount}, ${nf((R.cfg || cfgFor({})).ledFace - GH().crop, 2)} m above the crop.`;
    return r && r.stage === 'full' ? `${base} ${nf(r.avg)} µmol/m²s on the crop, uniformity ${nf(r.uMinAvg, 2)}, ${nf(r.avg * S.led.hours * 3600 / 1e6, 1)} mol/m²/day${S.volt.on ? `, ${pct(avgLost(r), 1)} blocked by Voltiris` : ''}.` : base;
  };

  // ------------------------------------------------------------------ start
  drawLegendBar($('#legBar'));
  $('#buildInfo').textContent = 'Light engine 2026-11 · datasheets checked ' + DATA.built;
  const ro = new ResizeObserver(() => { if (!active) return; cancelAnimationFrame(ro._f); ro._f = requestAnimationFrame(drawAll); });
  ro.observe($('#secCanvas').parentElement); ro.observe($('#mapBox'));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { renderStatic(); drawAll(); });
  new MutationObserver(() => { renderStatic(); drawAll(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  try { initThree(); } catch (e) { three = null; $('#view3d').innerHTML = '<p class="noview">The 3D view needs WebGL, which this browser does not offer here. Everything else works.</p>'; }
  renderStatic(); renderCompare();

  GHD.LedTab = {
    shown() { active = true; drawAll(); if (stale) schedule(0); if (three && !three.placed) { setView3d('3d'); three.placed = true; } },
    hidden() { active = false; },
    ready: () => !!(R.main && R.main.stage === 'full' && R.ref && !stale && !R.busy),
    ensure() { if (!stale && R.busy) return; forced = true; schedule(0); forced = false; },
    summary: () => `${S.led.n} × ${fixture().model}${R.main && !stale ? ` · ${nf(R.main.avg)} µmol/m²s` : ''}`,
    summaryText, reportPages,
    _debug: { S, R, cfgFor, geo, lineXs, setView3d, rebuild3d, get three() { return three; } },
  };
})();
