// Runs the light engine off the main thread (loaded by app.js as a Web Worker).
self.window = self;
importScripts('engine.js');

// LED lab worker: runs the light engine off the main thread. Jobs of an older request stop at the next job boundary.
let KIT = null, CUR = 0, LAST = null;

function extremes(r) {
  let mn = Infinity, mx = -Infinity, kmn = 0, kmx = 0;
  for (let i = 0; i < r.E.length; i++) { const v = r.E[i]; if (v < mn) { mn = v; kmn = i; } if (v > mx) { mx = v; kmx = i; } }
  const at = k => ({ x: (k % r.nx + 0.5) * r.res, y: (Math.floor(k / r.nx) + 0.5) * r.res });
  return { minAt: at(kmn), maxAt: at(kmx) };
}

// light leaving every LED toward each side of the section (within 45° of it), and the share of it that passes Voltiris
function sectionRays(r, cfg) {
  const ng = r.ng, nc = r.nc, rot = r.rot, t = r.dist.t, h = cfg.ledFace - cfg.crop;
  let tmax = 0; for (let i = 0; i < t.length; i++) if (t[i] > tmax) tmax = t[i];
  const half = Math.round(nc * 45 / 360), leds = [];
  for (let s = 0; s < cfg.slots.length; s++) {
    const per = r.maps[s].far, rays = [];
    for (const side of [1, -1]) {
      const c0 = side > 0 ? 0 : Math.round(nc / 2);
      for (let ig = 0; ig < ng; ig++) {
        let wI = 0, wIT = 0;
        for (let dc = -half; dc <= half; dc++) {
          const ic = (c0 + dc + nc) % nc, I = t[ig * nc + ((ic - rot + nc) % nc)];
          for (const m of per) { wI += I; wIT += I * m.T[ig * nc + ic]; }
        }
        const g = (ig + 0.5) * 90 / ng;
        rays.push({ g, dg: 90 / ng, side, I: t[ig * nc + ((c0 - rot + nc) % nc)] / (tmax || 1), T: wI > 0 ? wIT / wI : 1, tCrop: h / Math.cos(g * Math.PI / 180) });
      }
    }
    leds.push({ x: cfg.slots[s], z: cfg.ledFace, rays });
  }
  return leds;
}

function pack(r, key, cfg, withSection) {
  const ex = extremes(r);
  const out = { key, E: r.E, nx: r.nx, ny: r.ny, res: r.res, avg: r.avg, min: r.min, max: r.max, uMinAvg: r.uMinAvg, uMinMax: r.uMinMax,
    blocked: r.blocked, warn: r.warn, h: r.h, minAt: ex.minAt, maxAt: ex.maxAt };
  if (withSection) out.section = sectionRays(r, cfg);
  return out;
}

self.onmessage = async e => {
  const m = e.data;
  if (m.type === 'kit') { KIT = m.kit; return; }
  if (m.type === 'probe') {
    if (!LAST || LAST.id !== m.id) { self.postMessage({ type: 'probe', req: m.req, d: null }); return; }
    const d = LAST.r.probe(m.x, m.y);
    const list = d.list.slice(0, 12).map(p => ({ i: p.i, j: p.j, s: p.s, x: p.x, y: p.y, e: p.e, e0: p.e0, gamma: p.gamma, C: p.C, d: p.d, Irel: p.Irel, cos: p.cos, T: p.T }));
    self.postMessage({ type: 'probe', req: m.req, d: { e: d.e, e0: d.e0, n: d.list.length, list, h: d.h, ppf: d.ppf } });
    return;
  }
  if (m.type === 'optimise') {
    // most even LED positions: each LED moves inside its free range; coarse sweep twice, then a fine step
    const FASTO = { ng: 60, nc: 120, res: 0.2, smooth: true, reach: [5, 6], area: { nL: 7, nW: 1, ng: 40, nc: 80, near: 1, farN: [4, 1] } };
    const ev = xs => LedEngine.run(Object.assign({}, m.cfg, { slots: xs.slice().sort((a, b) => a - b) }), KIT, null, Object.assign({ noModules: m.noModules }, FASTO)).uMinAvg;
    let xs = m.start.slice(), best = ev(xs), k = 0;
    const movable = m.iv.filter(([a, b]) => b - a > 1e-6).length, total = Math.max(1, movable * 22);
    const tick = () => { k++; self.postMessage({ type: 'optprog', id: m.id, f: Math.min(1, k / total) }); };
    for (let pass = 0; pass < 2; pass++) for (let i = 0; i < m.iv.length; i++) {
      const [a, b] = m.iv[i]; if (b - a < 1e-6) continue;
      for (let t = 0; t <= 8; t++) { const tr = xs.slice(); tr[i] = a + (b - a) * t / 8; const u = ev(tr); if (u > best + 1e-5) { best = u; xs = tr; } tick(); }
    }
    for (let i = 0; i < m.iv.length; i++) {
      const [a, b] = m.iv[i]; if (b - a < 1e-6) continue; const st = (b - a) / 16;
      for (const d of [-2, -1, 1, 2]) { const tr = xs.slice(); tr[i] = Math.min(b, Math.max(a, xs[i] + d * st)); const u = ev(tr); if (u > best + 1e-5) { best = u; xs = tr; } tick(); }
    }
    self.postMessage({ type: 'optdone', id: m.id, xs, u: best });
    return;
  }
  if (m.type === 'run') {
    CUR = m.id;
    for (const job of m.jobs) {
      await new Promise(res => setTimeout(res, 0));
      if (CUR !== m.id) return;
      const t0 = performance.now();
      let r;
      try { r = LedEngine.run(job.cfg, KIT, null, job.opts); }
      catch (err) { self.postMessage({ type: 'error', id: m.id, key: job.key, message: String(err && err.message || err) }); continue; }
      if (job.opts.keep) LAST = { id: m.id, r };
      const out = pack(r, job.key, job.cfg, !!job.section);
      out.ms = Math.round(performance.now() - t0); out.stage = job.stage;
      self.postMessage({ type: 'result', id: m.id, res: out }, [out.E.buffer]);
    }
    self.postMessage({ type: 'done', id: m.id });
  }
};
