/* LED photometry: beam shapes, IES and LDT files, the light colour ramp and the beam polar drawing.
   No access to the page state; used by the LEDs tab. */
(function () {
  'use strict';
  const GHD = window.GHD, Engine = window.LedEngine, D2R = Math.PI / 180;
  const DATA = GHD.DATA;

  // ---------- beams: a datasheet beam angle becomes a smooth cos^n curve; measured curves come from curves.json
  function cosnN(angle) { return Math.log(0.5) / Math.log(Math.cos(angle / 2 * D2R)); }
  const beamCache = new Map();
  function beamDist(beam) {
    if (beam.dist) return beam.dist;
    const key = beam.curve ? 'c:' + beam.curve : 'a:' + beam.angle;
    if (!beamCache.has(key)) {
      if (beam.curve) beamCache.set(key, DATA.curves[beam.curve]);
      else { const n = cosnN(beam.angle); beamCache.set(key, { sym: true, n, I: Array.from({ length: 91 }, (_, g) => g >= 90 ? 0 : Math.pow(Math.cos(g * D2R), n)) }); }
    }
    return beamCache.get(key);
  }


  // ---------- photometric files (IES type C, EULUMDAT), resampled on a 5° x 1° grid
  function gridFrom(fn) {
    const nC = 72, nG = 91, V = new Float32Array(nC * nG); let mx = 0;
    for (let c = 0; c < nC; c++) for (let g = 0; g < nG; g++) { const v = Math.max(0, fn(c * 5, g)); V[c * nG + g] = v; mx = Math.max(mx, v); }
    if (!(mx > 0)) throw new Error('the file holds no light below the fixture');
    for (let i = 0; i < V.length; i++) V[i] /= mx;
    return { grid: { nC, dC: 5, nG, dG: 1, V: Array.from(V) } };
  }
  function interp1(xs, ys, x) {
    if (x <= xs[0]) return ys[0];
    for (let i = 1; i < xs.length; i++) if (x <= xs[i]) { const f = (x - xs[i - 1]) / (xs[i] - xs[i - 1] || 1); return ys[i - 1] * (1 - f) + ys[i] * f; }
    return ys[ys.length - 1];
  }
  function planeLookup(Cs, Gs, rows) {
    return (C, g) => {
      if (Cs.length === 1) return interp1(Gs, rows[0], g);
      let i = 0; while (i < Cs.length - 2 && C > Cs[i + 1]) i++;
      const f = Math.max(0, Math.min(1, (C - Cs[i]) / (Cs[i + 1] - Cs[i] || 1)));
      return interp1(Gs, rows[i], g) * (1 - f) + interp1(Gs, rows[i + 1], g) * f;
    };
  }
  function parseIES(text) {
    const t = text.indexOf('TILT=');
    if (t < 0) throw new Error('there is no TILT line, so this is not an IES file');
    const lineEnd = text.indexOf('\n', t), tilt = text.slice(t + 5, lineEnd).trim();
    let nums = text.slice(lineEnd + 1).replace(/,/g, ' ').trim().split(/\s+/).map(Number);
    if (/^INCLUDE/i.test(tilt)) { const n = nums[1]; nums = nums.slice(2 + 2 * n); }
    const nV = nums[3], nH = nums[4], type = nums[5];
    if (type !== 1) throw new Error('only type C photometry is supported');
    let p = 13;
    const V = nums.slice(p, p + nV); p += nV;
    const Hs = nums.slice(p, p + nH); p += nH;
    const rows = []; for (let h = 0; h < nH; h++) { rows.push(nums.slice(p, p + nV)); p += nV; }
    if (rows.some(r => r.length < nV || r.some(v => !isFinite(v)))) throw new Error('the candela table is incomplete');
    const look = planeLookup(Hs, V, rows), hMax = Hs[Hs.length - 1], hMin = Hs[0];
    return gridFrom((C, g) => {
      let c = C;
      if (nH === 1) c = hMin;
      else if (hMax <= 90.01) { c = C % 180; if (c > 90) c = 180 - c; }
      else if (hMin >= 89.99 && hMax <= 270.01) { if (c < 90) c = 180 - c; else if (c > 270) c = 540 - c; }
      else if (hMax <= 180.01) { if (c > 180) c = 360 - c; }
      return look(c, g);
    });
  }
  function parseLDT(text) {
    const L0 = text.split(/\r?\n/).map(s => s.trim());
    const num = i => parseFloat(String(L0[i]).replace(',', '.'));
    const isym = num(2), Mc = num(3), Ng = num(5), n = num(25);
    if (!(Mc > 0 && Ng > 0)) throw new Error('the header does not look like EULUMDAT');
    let p = 26 + 6 * n + 10;
    const Cs = []; for (let i = 0; i < Mc; i++) Cs.push(num(p + i)); p += Mc;
    const Gs = []; for (let i = 0; i < Ng; i++) Gs.push(num(p + i)); p += Ng;
    const nPl = isym === 1 ? 1 : isym === 0 ? Mc : isym === 4 ? Mc / 4 + 1 : Mc / 2 + 1;
    let c0 = 0; if (isym === 3) c0 = Math.round(3 * Mc / 4);
    const vals = L0.slice(p).filter(s => s !== '').map(s => parseFloat(s.replace(',', '.')));
    if (vals.length < nPl * Ng) throw new Error('the intensity table is incomplete');
    const rows = [], Cp = [];
    for (let k = 0; k < nPl; k++) { rows.push(vals.slice(k * Ng, (k + 1) * Ng)); Cp.push(Cs[(c0 + k) % Mc]); }
    if (isym === 3) { for (let k = 0; k < Cp.length; k++) if (Cp[k] >= 180) Cp[k] -= 360; }
    const look = planeLookup(Cp, Gs, rows);
    return gridFrom((C, g) => {
      let c = C;
      if (isym === 1) c = 0;
      else if (isym === 2) { if (c > 180) c = 360 - c; }
      else if (isym === 3) { if (c > 180) c -= 360; if (c > 90) c = 180 - c; if (c < -90) c = -180 - c; }
      else if (isym === 4) { c = c % 180; if (c > 90) c = 180 - c; }
      return look(c, g);
    });
  }
  // light relative to what the LEDs send: deep blue (little) through teal and green to pale yellow (most), as in the Le Doux Pur simulator
  const STOPS = [[0.4, [24, 34, 74]], [0.6, [36, 86, 140]], [0.8, [24, 150, 150]], [1.0, [120, 205, 140]], [1.2, [248, 238, 160]]];
  const LO = STOPS[0][0], HI = STOPS[STOPS.length - 1][0];
  function ramp(rel) {
    rel = Math.max(STOPS[0][0], Math.min(STOPS[STOPS.length - 1][0], rel));
    for (let i = 1; i < STOPS.length; i++) if (rel <= STOPS[i][0]) {
      const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i], t = (rel - a) / (b - a);
      return [0, 1, 2].map(k => Math.round(ca[k] * (1 - t) + cb[k] * t));
    }
    return STOPS[STOPS.length - 1][1];
  }

  function drawPolar(ctx, Wpx, Hpx, pal, dist, opts) {
    opts = opts || {};
    ctx.save(); ctx.fillStyle = opts.transparent ? 'rgba(0,0,0,0)' : pal.bg; ctx.clearRect(0, 0, Wpx, Hpx); if (!opts.transparent) ctx.fillRect(0, 0, Wpx, Hpx);
    const top = opts.top || 6, R0 = Math.min(Wpx / 2 - 4, Hpx - top - 4), cx = Wpx / 2, cy = top;
    const I = (g, C) => Engine.intensity(dist, g, C);
    let mx = 0; for (let g = 0; g <= 90; g++) mx = Math.max(mx, I(g, 0), I(g, 90));
    ctx.strokeStyle = pal.line; ctx.lineWidth = 1;
    for (const r of [0.5, 1]) { ctx.beginPath(); ctx.arc(cx, cy, r * R0, 0, Math.PI); ctx.stroke(); }
    for (const a of [0, 30, 60]) for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + s * Math.sin(a * D2R) * R0, cy + Math.cos(a * D2R) * R0); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(cx - R0, cy); ctx.lineTo(cx + R0, cy); ctx.stroke();
    const curve = (C, side, color, lw) => {
      ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.beginPath();
      for (let g = 0; g <= 90; g++) { const r = I(g, C) / mx * R0, x = cx + side * Math.sin(g * D2R) * r, y = cy + Math.cos(g * D2R) * r; g ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke();
    };
    curve(0, -1, pal.steel, opts.lw || 1.6);
    curve(90, 1, pal.accent, opts.lw || 1.6);
    ctx.restore();
  }


  GHD.LedPhoto = { cosnN, beamDist, parseIES, parseLDT, ramp, LO, HI, drawPolar };
})();
