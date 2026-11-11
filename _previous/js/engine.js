
// LED light through the Voltiris zone: geometry, shadow maps and crop irradiance.
// Frame: metres; x across chapels, y along the greenhouse (module lines), z up from the floor.
// One periodic cell = one chapel (W) x one section (L); trusses at y = j*L.
(function (root) {
  'use strict';
  const D2R = Math.PI / 180;

  function defaults() {
    return {
      W: 8.53, L: 5.0, lines: 5, patA: [1.319, 3.069], patB: [2.019, 3.769],
      trussTop: 5.92, trussDepth: 0.50, crop: 1.80,
      envTop: 0.669, envR: 1.1275,   // DEV7 sweep envelope (CAD sphere 2255 mm, cut at +-0.669 m)
      fix: { W: 0.17, L: 1.00, H: 0.14 },
      slots: [1.5 * 8.53 / 5, 3.5 * 8.53 / 5], ledY: 0, ledFace: 5.28,
      ppf: 5100, dist: 'mx150', rot90: false,
      pose: { el: 75, az: 0 },
      layers: { line: true, rods: true, iparts: true, optimizers: true, tracker: true, moving: true, modules: true },
      tau: 1.0, res: 0.1, reach: [6, 8], nsub: 3, ng: 180, nc: 360,
    };
  }

  // ---------- light distributions ----------
  // A beam is one of:
  //   { sym: true, I: [91 values, gamma 0..90] }                rotationally symmetric
  //   { I0: [...], I90: [...] }                                  two planes (C0 red, C90 blue), blended cos²/sin²
  //   { grid: { nC, dC, nG, dG, V } }                            full photometry, V[ci*nG+gi], C from 0 step dC, gamma 0 step dG
  // C is measured from +x, the long side of the lamp.
  function intensity(d, g, Cdeg) {
    if (d.grid) {
      const q = d.grid, gi = Math.min(g / q.dG, q.nG - 1.000001), g0 = Math.floor(gi), fg = gi - g0;
      let ci = ((Cdeg % 360) + 360) % 360 / q.dC; const c0 = Math.floor(ci) % q.nC, c1 = (c0 + 1) % q.nC, fc = ci - Math.floor(ci);
      const v = (c, k) => q.V[c * q.nG + k];
      const a = v(c0, g0) * (1 - fg) + v(c0, g0 + 1) * fg, b = v(c1, g0) * (1 - fg) + v(c1, g0 + 1) * fg;
      return a * (1 - fc) + b * fc;
    }
    const lo = Math.min(Math.floor(g), 89), f = g - lo, hi = lo + 1;
    if (d.sym) return d.I[lo] * (1 - f) + d.I[hi] * f;
    const a = d.I0[lo] * (1 - f) + d.I0[hi] * f, b = d.I90[lo] * (1 - f) + d.I90[hi] * f;
    const C = Cdeg * D2R, c = Math.cos(C), s = Math.sin(C);
    return a * c * c + b * s * s;
  }
  function makeDist(d, ng, nc) {
    // table of relative intensity on the (gamma, C) ray grid; C from +x (fixture long axis)
    const t = new Float32Array(ng * nc);
    for (let ig = 0; ig < ng; ig++) {
      const g = (ig + 0.5) * 90 / ng;
      for (let ic = 0; ic < nc; ic++) t[ig * nc + ic] = intensity(d, g, (ic + 0.5) * 360 / nc);
    }
    // flux of the table (relative units) over the lower hemisphere
    let phi = 0;
    const dg = 90 / ng * D2R, dc = 360 / nc * D2R;
    for (let ig = 0; ig < ng; ig++) {
      const sg = Math.sin((ig + 0.5) * 90 / ng * D2R);
      for (let ic = 0; ic < nc; ic++) phi += t[ig * nc + ic] * sg * dg * dc;
    }
    return { t, phi, ng, nc };
  }

  // ---------- geometry ----------
  function pivotZ(cfg) { return cfg.trussTop - cfg.envTop; }

  function rotMat(el, az) {
    const e = el * D2R, a = az * D2R;
    const ce = Math.cos(e), se = Math.sin(e), ca = Math.cos(a), sa = Math.sin(a);
    // R = Rz(a) * Rx(e)
    return [ca, -sa * ce, sa * se, sa, ca * ce, -ca * se, 0, se, ce];
  }
  function mulMV(R, v) { return [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]]; }

  function boxAA(name, x0, x1, y0, y1, z0, z1, tau) {
    return { name, c: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], u: [1, 0, 0, 0, 1, 0, 0, 0, 1], h: [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2], tau: tau || 0 };
  }

  // All blocking boxes for chapels ci0..ci1 and sections cj0..cj1 (world frame).
  function buildBoxes(cfg, kit, ci0, ci1, cj0, cj1) {
    const out = [];
    if (!cfg.layers.modules) return out;
    const PZ = pivotZ(cfg), W = cfg.W, L = cfg.L, tb = cfg.trussTop - cfg.trussDepth;
    // moving parts rotated per pose; cfg.poses (optional) gives one pose per module position k*2+m
    const cache = new Map();
    const movingFor = p => {
      const key = p.el + '/' + p.az;
      if (!cache.has(key)) {
        const R = rotMat(p.el, p.az);
        cache.set(key, kit.moving.map(b => {
          const u = b.u, rows = [[u[0][0], u[0][1], u[0][2]], [u[1][0], u[1][1], u[1][2]], [u[2][0], u[2][1], u[2][2]]];
          const ur = rows.map(r => mulMV(R, r));
          return { name: b.name, c: mulMV(R, b.c), u: [].concat(ur[0], ur[1], ur[2]), h: b.h, tau: b.name.startsWith('lamellas') ? cfg.tau : b.tau };
        }));
      }
      return cache.get(key);
    };
    const poseOf = (k, m) => (cfg.poses && cfg.poses[k * 2 + m]) || cfg.pose;
    for (let i = ci0; i <= ci1; i++) {
      for (let k = 0; k < cfg.lines; k++) {
        const X = i * W + (cfg.lineOffset || 0) + k * W / cfg.lines;
        const ys = k % 2 === 0 ? cfg.patA : cfg.patB;
        if (cfg.layers.line) {
          for (const p of kit.line) if (p.name === 'profile' || cfg.layers.rods) out.push(boxAA(p.name, X + p.x[0], X + p.x[1], cj0 * L - 1, (cj1 + 1) * L + 1, PZ + p.z[0], PZ + p.z[1]));
        }
        for (let j = cj0; j <= cj1 + 1; j++) {
          const Y0 = j * L;
          if (cfg.layers.iparts) {
            for (const p of kit.at_I) {
              if (p.layer === 'optimizers' && !cfg.layers.optimizers) continue;
              const z1 = p.z[1] === 'top' ? tb : PZ + p.z[1];
              out.push(boxAA(p.name, X + p.x[0], X + p.x[1], Y0 + p.y[0], Y0 + p.y[1], PZ + p.z[0], z1));
            }
          }
          if (j > cj1) continue;
          for (let m = 0; m < ys.length; m++) {
            const P = [X, Y0 + ys[m], PZ];
            if (cfg.layers.tracker) for (const b of kit.static) out.push({ name: b.name, c: [P[0] + b.c[0], P[1] + b.c[1], P[2] + b.c[2]], u: [].concat(b.u[0], b.u[1], b.u[2]), h: b.h, tau: 0 });
            if (cfg.layers.moving) for (const b of movingFor(poseOf(k, m))) {
              if (b.tau >= 0.999) continue;  // fully transparent lamellas
              out.push({ name: b.name, c: [P[0] + b.c[0], P[1] + b.c[1], P[2] + b.c[2]], u: b.u, h: b.h, tau: b.tau });
            }
          }
        }
      }
    }
    return out;
  }

  // ---------- ray casting ----------
  function corners(b) {
    const r = [];
    for (let sx = -1; sx <= 1; sx += 2) for (let sy = -1; sy <= 1; sy += 2) for (let sz = -1; sz <= 1; sz += 2) {
      r.push([b.c[0] + sx * b.h[0] * b.u[0] + sy * b.h[1] * b.u[3] + sz * b.h[2] * b.u[6],
        b.c[1] + sx * b.h[0] * b.u[1] + sy * b.h[1] * b.u[4] + sz * b.h[2] * b.u[7],
        b.c[2] + sx * b.h[0] * b.u[2] + sy * b.h[1] * b.u[5] + sz * b.h[2] * b.u[8]]);
    }
    return r;
  }

  function inside(b, p) {
    const d = [p[0] - b.c[0], p[1] - b.c[1], p[2] - b.c[2]];
    for (let a = 0; a < 3; a++) {
      const q = d[0] * b.u[3 * a] + d[1] * b.u[3 * a + 1] + d[2] * b.u[3 * a + 2];
      if (Math.abs(q) > b.h[a]) return false;
    }
    return true;
  }

  // Transmission map T[ig*nc+ic] seen from point s (rays going down).
  function hullXY(pts) {
    const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    const h = lo.slice(0, -1).concat(up.slice(0, -1));
    return h.length ? h : [P[0]];
  }
  function segDist(a, b) {         // distance from the origin to segment ab
    const vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy;
    let t = L2 > 0 ? -(a[0] * vx + a[1] * vy) / L2 : 0; t = Math.max(0, Math.min(1, t));
    return Math.hypot(a[0] + t * vx, a[1] + t * vy);
  }
  function shadowMap(boxes, s, ng, nc) {
    const T = new Float32Array(ng * nc).fill(1);
    const bins = Array.from({ length: nc }, () => []);
    let insideHit = null;
    for (const b of boxes) {
      if (inside(b, s)) { insideHit = b.name; continue; }
      const cs = corners(b);
      if (cs.every(p => p[2] >= s[2])) continue;           // fully above the source
      // does the box's xy footprint contain the source's xy?  (then all azimuths)
      let full = false;
      { const d = [s[0] - b.c[0], s[1] - b.c[1], 0]; let ok = true;
        for (let a = 0; a < 3 && ok; a++) {
          // project the vertical line through s: inside if for each axis the vertical line meets the slab
          const ux = b.u[3 * a], uy = b.u[3 * a + 1], uz = b.u[3 * a + 2];
          const q = d[0] * ux + d[1] * uy;
          if (Math.abs(uz) < 1e-9 && Math.abs(q) > b.h[a]) ok = false;
        }
        full = ok; }
      let i0 = 0, i1 = nc - 1;
      if (!full) {
        const az = cs.map(p => Math.atan2(p[1] - s[1], p[0] - s[0]));
        // smallest arc covering all corner azimuths
        const sorted = az.map(a => (a + 2 * Math.PI) % (2 * Math.PI)).sort((a, b2) => a - b2);
        let gap = -1, gi = 0;
        for (let k = 0; k < sorted.length; k++) {
          const nxt = k === sorted.length - 1 ? sorted[0] + 2 * Math.PI : sorted[k + 1];
          if (nxt - sorted[k] > gap) { gap = nxt - sorted[k]; gi = k; }
        }
        const start = sorted[(gi + 1) % sorted.length], end = sorted[gi];
        i0 = Math.floor(start / (2 * Math.PI) * nc); i1 = Math.floor(end / (2 * Math.PI) * nc);
        if (i1 < i0) i1 += nc;
      }
      // elevation range the box can cover, seen from the source (conservative): rays outside it cannot hit it
      let gLo = 0, gHi = 90;
      { const zs = cs.map(p => s[2] - p[2]), dMax = Math.max(...zs), dMin = Math.min(...zs);
        const hd = cs.map(p => Math.hypot(p[0] - s[0], p[1] - s[1])), hMax = Math.max(...hd);
        if (!full) {
          // smallest horizontal distance from the source to the box footprint (corners and edge midpoints are not enough: use the footprint hull)
          const pts = cs.map(p => [p[0] - s[0], p[1] - s[1]]);
          const hull2 = hullXY(pts);
          let hMin = Infinity;
          for (let k = 0; k < hull2.length; k++) { const a1 = hull2[k], a2 = hull2[(k + 1) % hull2.length]; hMin = Math.min(hMin, segDist(a1, a2)); }
          gLo = dMax > 0 ? Math.atan2(hMin, dMax) / D2R : 90;
        }
        gHi = dMin > 0 ? Math.atan2(hMax, dMin) / D2R : 90;
      }
      const g0 = Math.max(0, Math.floor(gLo / 90 * ng) - 1), g1 = Math.min(ng - 1, Math.ceil(gHi / 90 * ng) + 1);
      const entry = { b, g0, g1 };
      for (let i = i0; i <= i1; i++) bins[i % nc].push(entry);
    }
    for (let ic = 0; ic < nc; ic++) {
      const list = bins[ic];
      if (!list.length) continue;
      const C = (ic + 0.5) * 360 / nc * D2R, cC = Math.cos(C), sC = Math.sin(C);
      for (let ig = 0; ig < ng; ig++) {
        const g = (ig + 0.5) * 90 / ng * D2R, sg = Math.sin(g);
        const dx = sg * cC, dy = sg * sC, dz = -Math.cos(g);
        let tr = 1;
        for (const en of list) {
          if (ig < en.g0 || ig > en.g1) continue;
          const b = en.b;
          // slab test in the box frame
          const ox = s[0] - b.c[0], oy = s[1] - b.c[1], oz = s[2] - b.c[2];
          let tmin = 0, tmax = 1e9, hit = true;
          for (let a = 0; a < 3; a++) {
            const ux = b.u[3 * a], uy = b.u[3 * a + 1], uz = b.u[3 * a + 2];
            const o = ox * ux + oy * uy + oz * uz, d = dx * ux + dy * uy + dz * uz, h = b.h[a];
            if (Math.abs(d) < 1e-12) { if (Math.abs(o) > h) { hit = false; break; } continue; }
            let t1 = (-h - o) / d, t2 = (h - o) / d;
            if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
            if (t1 > tmin) tmin = t1;
            if (t2 < tmax) tmax = t2;
            if (tmin > tmax) { hit = false; break; }
          }
          if (hit) { tr *= b.tau; if (tr <= 0) break; }
        }
        T[ig * nc + ic] = tr;
      }
    }
    return { T, insideHit };
  }

  // ---------- full run ----------
  // opts.area = { nL, nW, ng, nc, near, farN }: the fixture face is sampled nL x nW times for the lamp images within `near`
  // chapels/bays (soft shadows from the real fixture size). Further images use one map at the fixture centre, at full
  // resolution; with farN = [a, b] its transmission is the average over a x b face points, so far lamps are not treated
  // as a single point that may sit in a gap between parts. The blocked share then comes from that averaged map.
  // opts.smooth: bilinear look-up between the angular bins instead of the nearest bin.
  function run(cfg, kit, dists, opts) {
    opts = opts || {};
    if (opts.fast) opts = Object.assign({ ng: 48, nc: 96, nsub: 1, res: 0.25, reach: [4, 5] }, opts);
    const ng = opts.ng || cfg.ng, nc = opts.nc || cfg.nc, nsub = opts.nsub || cfg.nsub;
    let area = opts.area || null; const smooth = !!opts.smooth;
    if (area && opts.noModules) area = Object.assign({}, area, { nL: Math.min(area.nL, 5), nW: 1 });   // no shadows to soften
    const d0 = typeof cfg.dist === 'string' ? dists[cfg.dist] : cfg.dist;
    const dist = makeDist(d0, ng, nc);
    const distA = area ? makeDist(d0, area.ng || ng, area.nc || nc) : dist;
    const W = cfg.W, L = cfg.L;
    const boxes = opts.noModules ? [] : buildBoxes(cfg, kit, -2, 2, -2, 1);
    // rays of the near images only reach the neighbouring chapels and bays, so their maps need only those parts
    const boxesNear = opts.noModules || !area ? boxes : buildBoxes(cfg, kit, -1, 1, -1, 1);
    const fl = cfg.fix.L, fw = cfg.fix.W;
    const at = (s, u, v) => cfg.rot90 ? [cfg.slots[s] - v, cfg.ledY + u, cfg.ledFace] : [cfg.slots[s] + u, cfg.ledY + v, cfg.ledFace];
    const maps = [], blocked = [], warn = [];
    const mkMap = (src, w, dd, gN, cN, bx, sIdx, Tgiven) => {
      const sm = Tgiven ? { T: Tgiven } : shadowMap(bx || boxes, src, gN, cN);
      if (sm.insideHit) { const msg = `LED ${sIdx + 1} sits inside "${sm.insideHit}"`; if (!warn.includes(msg)) warn.push(msg); }
      const rotN = cfg.rot90 ? Math.round(cN / 4) : 0;
      const IT = new Float32Array(gN * cN);
      let num = 0, den = 0;
      for (let ig = 0; ig < gN; ig++) {
        const sg = Math.sin((ig + 0.5) * 90 / gN * D2R);
        for (let ic = 0; ic < cN; ic++) {
          const I = dd.t[ig * cN + ((ic - rotN + cN) % cN)], t = sm.T[ig * cN + ic];
          IT[ig * cN + ic] = I * t; num += I * t * sg; den += I * sg;
        }
      }
      return { src, w, IT, T: opts.keep ? sm.T : null, ng: gN, nc: cN, rot: rotN, dd, num, den };
    };
    for (let s = 0; s < cfg.slots.length; s++) {
      let far, near;
      if (area) {
        if (area.farN && !opts.noModules) {
          const [fA, fB] = area.farN, Tm = new Float32Array(ng * nc);
          for (let a = 0; a < fA; a++) for (let b = 0; b < fB; b++) {
            const sm = shadowMap(boxes, at(s, -fl / 2 + (a + 0.5) * fl / fA, -fw / 2 + (b + 0.5) * fw / fB), ng, nc);
            if (sm.insideHit) { const msg = `LED ${s + 1} sits inside "${sm.insideHit}"`; if (!warn.includes(msg)) warn.push(msg); }
            for (let q = 0; q < Tm.length; q++) Tm[q] += sm.T[q] / (fA * fB);
          }
          far = [mkMap(at(s, 0, 0), 1, dist, ng, nc, null, s, Tm)];
        } else far = [mkMap(at(s, 0, 0), 1, dist, ng, nc, null, s)];
        near = [];
        const nL = area.nL, nW = area.nW, gA = area.ng || ng, cA = area.nc || nc;
        for (let a = 0; a < nL; a++) for (let b = 0; b < nW; b++)
          near.push(mkMap(at(s, -fl / 2 + (a + 0.5) * fl / nL, -fw / 2 + (b + 0.5) * fw / nW), 1 / (nL * nW), distA, gA, cA, boxesNear, s));
      } else {
        far = [];
        for (let k = 0; k < nsub; k++) far.push(mkMap(at(s, -fl / 2 + (k + 0.5) * fl / nsub, 0), 1 / nsub, dist, ng, nc, null, s));
        near = far;
      }
      const set = area && !(area.farN && !opts.noModules) ? near : far;
      const num = set.reduce((a, m) => a + m.w * m.num / m.den, 0);
      maps.push({ far, near }); blocked.push(Math.max(0, 1 - num));
    }
    if (opts.blockedOnly) return { blocked, warn };
    const res = opts.res || cfg.res, nx = Math.round(W / res), ny = Math.round(L / res);
    const E = new Float32Array(nx * ny);
    const h0 = cfg.ledFace - cfg.crop;
    const [ri, rj] = opts.reach || cfg.reach;
    const nearR = area ? (area.near != null ? area.near : 1) : Infinity;
    // value of a folded table (IT, or the beam alone) toward direction g (deg from straight down), C (deg)
    const look = (m, arr, g, C, beamOnly) => {
      const gN = m.ng, cN = m.nc, rot = beamOnly ? m.rot : 0;
      if (g >= 90) return 0;
      if (!smooth) {
        const ig = Math.floor(g / 90 * gN), ic = Math.floor(C / 360 * cN) % cN;
        return arr[ig * cN + ((ic - rot + cN) % cN)];
      }
      const fg = g / 90 * gN - 0.5;
      const i0 = Math.max(0, Math.min(gN - 1, Math.floor(fg))), i1 = Math.min(gN - 1, i0 + 1), wg = fg <= 0 ? 0 : Math.min(1, fg - i0);
      let fc = C / 360 * cN - 0.5; fc = ((fc % cN) + cN) % cN;
      const c0 = Math.floor(fc) % cN, c1 = (c0 + 1) % cN, wc = fc - Math.floor(fc);
      const q0 = (c0 - rot + cN) % cN, q1 = (c1 - rot + cN) % cN;
      return (1 - wg) * ((1 - wc) * arr[i0 * cN + q0] + wc * arr[i0 * cN + q1]) + wg * ((1 - wc) * arr[i1 * cN + q0] + wc * arr[i1 * cN + q1]);
    };
    const pointE = (px, py, detail) => {
      let e = 0, e0 = 0; const parts = detail ? new Map() : null;
      for (let i = -ri; i <= ri; i++) for (let j = -rj; j <= rj; j++) for (let s = 0; s < cfg.slots.length; s++) {
        const list = Math.abs(i) <= nearR && Math.abs(j) <= nearR ? maps[s].near : maps[s].far;
        for (const m of list) {
          const dx = px - (m.src[0] + i * W), dy = py - (m.src[1] + j * L);
          const rh2 = dx * dx + dy * dy, d2 = rh2 + h0 * h0, d = Math.sqrt(d2);
          const g = Math.atan2(Math.sqrt(rh2), h0) / D2R;
          let C = Math.atan2(dy, dx) / D2R; if (C < 0) C += 360;
          const K = cfg.ppf * m.w / m.dd.phi, cosg = h0 / d;
          const v = K * look(m, m.IT, g, C) * cosg / d2, v0 = K * look(m, m.dd.t, g, C, true) * cosg / d2;
          e += v; e0 += v0;
          if (detail) {
            const key = i + ',' + j + ',' + s;
            let p = parts.get(key);
            if (!p) {
              const cx = cfg.slots[s] + i * W - px, cy = cfg.ledY + j * L - py, rr = Math.hypot(cx, cy), dd = Math.hypot(rr, h0);
              let CC = Math.atan2(-cy, -cx) / D2R; if (CC < 0) CC += 360;
              const gg = Math.atan2(rr, h0) / D2R;
              p = { i, j, s, x: cfg.slots[s] + i * W, y: cfg.ledY + j * L, e: 0, e0: 0, gamma: gg, C: CC, d: dd, Irel: look(maps[s].far[0], dist.t, gg, CC, true), cos: h0 / dd };
              parts.set(key, p);
            }
            p.e += v; p.e0 += v0;
          }
        }
      }
      if (!detail) return e;
      let tmax = 0; for (const v of dist.t) tmax = Math.max(tmax, v);
      const list = [...parts.values()].map(p => Object.assign(p, { Irel: p.Irel / (tmax || 1), T: p.e0 > 0 ? p.e / p.e0 : 1 })).sort((a, b) => b.e0 - a.e0);
      return { e, e0, list, nsub: area ? area.nL * area.nW : nsub, h: h0, ppf: cfg.ppf, phi: dist.phi, tmax };
    };
    if (opts.points) {
      const Ep = opts.points.map(p => pointE(p[0], p[1]));
      let sum = 0, mn = Infinity, mx = -Infinity; for (const v of Ep) { sum += v; mn = Math.min(mn, v); mx = Math.max(mx, v); }
      const avg = sum / Ep.length;
      return { Ep, avg, min: mn, max: mx, uMinAvg: mn / avg, uMinMax: mn / mx, blocked, warn, h: h0 };
    }
    for (let i = -ri; i <= ri; i++) for (let j = -rj; j <= rj; j++) for (let s = 0; s < cfg.slots.length; s++) {
      const list = Math.abs(i) <= nearR && Math.abs(j) <= nearR ? maps[s].near : maps[s].far;
      for (const m of list) {
        const lx = m.src[0] + i * W, ly = m.src[1] + j * L, K = cfg.ppf * m.w / m.dd.phi;
        for (let iy = 0; iy < ny; iy++) {
          const dy = (iy + 0.5) * res - ly;
          for (let ix = 0; ix < nx; ix++) {
            const dx = (ix + 0.5) * res - lx;
            const rh2 = dx * dx + dy * dy, d2 = rh2 + h0 * h0;
            const g = Math.atan2(Math.sqrt(rh2), h0) / D2R;
            if (g >= 90) continue;
            let C = Math.atan2(dy, dx) / D2R; if (C < 0) C += 360;
            E[iy * nx + ix] += K * look(m, m.IT, g, C) * (h0 / Math.sqrt(d2)) / d2;
          }
        }
      }
    }
    let sum = 0, mn = Infinity, mx = -Infinity;
    for (const v of E) { sum += v; if (v < mn) mn = v; if (v > mx) mx = v; }
    const avg = sum / E.length;
    const out = { E, nx, ny, res, avg, min: mn, max: mx, uMinAvg: mn / avg, uMinMax: mn / mx, blocked, warn, h: h0, boxes: boxes.length };
    if (opts.keep) { out.probe = (px, py) => pointE(px, py, true); out.at = (px, py) => pointE(px, py); out.maps = maps; out.dist = dist; out.ng = ng; out.nc = nc; out.rot = cfg.rot90 ? Math.round(nc / 4) : 0; out.boxList = boxes; }
    return out;
  }

  // Lamp clashes: inside a module sweep, touching a Voltiris part, in the truss or too close to the crop.
  function collide(cfg, kit, noModules) {
    const out = [], f = cfg.fix, H = f.H, tb = cfg.trussTop - cfg.trussDepth;
    if (cfg.ledFace + H > tb + 1e-6) out.push('the lamp reaches into the truss');
    if (cfg.ledFace - cfg.crop < 0.5) out.push('the lamp is less than 0.5 m above the crop');
    if (noModules || !cfg.layers.modules) return out;
    const PZ = pivotZ(cfg), envR = cfg.envR || 1.1275, W = cfg.W, L = cfg.L;
    const boxes = buildBoxes(Object.assign({}, cfg, { layers: Object.assign({}, cfg.layers, { line: true, rods: true, iparts: true, optimizers: cfg.layers.optimizers, tracker: true, moving: true }) }), kit, -1, 1, -1, 0);
    for (const sx of cfg.slots) {
      const hx = cfg.rot90 ? f.W / 2 : f.L / 2, hy = cfg.rot90 ? f.L / 2 : f.W / 2;
      const box = [sx - hx, sx + hx, cfg.ledY - hy, cfg.ledY + hy, cfg.ledFace, cfg.ledFace + H];
      let hitEnv = false;
      if (box[5] > PZ - cfg.envTop && box[4] < PZ + cfg.envTop) {
        for (let i = -1; i <= 1 && !hitEnv; i++) for (let k = 0; k < cfg.lines && !hitEnv; k++) {
          const X = i * W + (cfg.lineOffset || 0) + k * W / cfg.lines, ys = k % 2 === 0 ? cfg.patA : cfg.patB;
          for (let j = -1; j <= 1 && !hitEnv; j++) for (const yc of ys) {
            const dx = Math.max(box[0] - X, 0, X - box[1]), dy = Math.max(box[2] - (j * L + yc), 0, (j * L + yc) - box[3]);
            if (Math.hypot(dx, dy) < envR) { hitEnv = true; break; }
          }
        }
      }
      if (hitEnv) out.push('a lamp sits inside a module sweep');
      for (const b of boxes) {
        const ext = [0, 1, 2].map(a => Math.abs(b.u[a]) * b.h[0] + Math.abs(b.u[3 + a]) * b.h[1] + Math.abs(b.u[6 + a]) * b.h[2]);
        if (b.c[0] + ext[0] > box[0] && b.c[0] - ext[0] < box[1] && b.c[1] + ext[1] > box[2] && b.c[1] - ext[1] < box[3] && b.c[2] + ext[2] > box[4] && b.c[2] - ext[2] < box[5]) {
          out.push('a lamp touches ' + b.name.replace(/_/g, ' ')); break;
        }
      }
    }
    return [...new Set(out)];
  }

  // Sweep of park positions: blocked share (moving parts only change)
  function parkSweep(cfg, kit, dists, els, azs) {
    const out = [];
    for (const el of els) for (const az of azs) {
      const c2 = Object.assign({}, cfg, { pose: { el, az } });
      const r = run(c2, kit, dists, { ng: 45, nc: 90, nsub: 1, blockedOnly: true });
      out.push({ el, az, blocked: r.blocked.reduce((a, b) => a + b, 0) / r.blocked.length });
    }
    out.sort((a, b) => a.blocked - b.blocked);
    return out;
  }

  root.LedEngine = { defaults, run, parkSweep, buildBoxes, shadowMap, makeDist, intensity, collide, pivotZ, rotMat };
})(typeof module !== 'undefined' ? module.exports : (typeof window !== 'undefined' ? window : self));
