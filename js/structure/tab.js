/* Structure tab: truss, pillars, gutter and culture lines, bracket line and I attachments.
   Reads and writes Model.S.structure (mm) and Model.S.project; everything else is derived from Model.geometry(). */
(function () {
  'use strict';
  const GHD = window.GHD, M = GHD.Model, { $, $$, esc, bindFullscreen } = GHD.util;
  const { iWin, iCaption, nearTxt, fmt } = GHD.StructureGeo;
  const { drawView, toSVG, windows } = GHD.StructureDraw;
  const fmtA = v => Number.isFinite(v) ? v.toFixed(1) + '°' : 'n/a';
  const panel = $('#panel-structure');
  const fields = [...panel.querySelectorAll('[data-k]')], pfields = [...panel.querySelectorAll('[data-p]')];
  const NUMS = Object.keys(M.DEF.structure).filter(k => typeof M.DEF.structure[k] === 'number');
  let iSel = 0;

  // ---------- form <-> state
  function fill() {
    const p = M.S.structure;
    for (const el of fields) { const k = el.dataset.k; if (el.type === 'checkbox') el.checked = !!p[k]; else el.value = p[k]; }
    for (const el of pfields) el.value = M.S.project[el.dataset.p] || '';
    manualList();
  }
  function read() {
    const p = {}, D = M.DEF.structure;
    for (const el of fields) {
      const k = el.dataset.k;
      if (el.type === 'checkbox') p[k] = el.checked;
      else if (el.type === 'number') { const v = parseFloat(el.value); p[k] = Number.isFinite(v) ? Math.max(0, v) : D[k]; }
      else p[k] = el.value;
    }
    p.man = [...panel.querySelectorAll('[data-m]')].map(el => { const v = parseFloat(el.value); return Number.isFinite(v) ? Math.max(0, v) : 0; });
    return p;
  }
  // one distance field per I in manual mode
  function manualList() {
    const p = M.S.structure, box = $('#sManual'), n = Math.min(200, Math.floor(p.nI) || 0);
    if (box.querySelectorAll('[data-m]').length === n && box.dataset.brk === String(p.brk)) return;
    const vals = p.man.slice(0, n); while (vals.length < n) vals.push(vals.length ? vals[vals.length - 1] : 1100);
    box.dataset.brk = String(p.brk);
    box.innerHTML = vals.map((v, i) => `<label class="num"><span>I${i + 1} from ${i ? 'I' + i : (p.brk ? 'bracket line' : 'left pillar')}</span><span class="in"><input type="number" id="sm${i}" data-m="${i}" min="0" step="any" value="${v}"><i>mm</i></span></label>`).join('');
    box.querySelectorAll('[data-m]').forEach(el => el.addEventListener('input', onInput));
  }
  function onInput() {
    Object.assign(M.S.structure, read());
    manualList();
    Object.assign(M.S.structure, read());
    M.changed('structure');
  }
  fields.forEach(el => el.addEventListener('input', onInput));
  // the crop can not sit below the gutters: raise it when the field is left
  $('#scrop').addEventListener('change', () => {
    const p = M.S.structure, gz = p.pH - p.H - p.gHang;
    if (p.gutter && p.crop < gz) { $('#scrop').value = Math.round(gz); onInput(); }
  });
  pfields.forEach(el => el.addEventListener('input', () => M.set('project', { [el.dataset.p]: el.value })));
  $('#sReset').addEventListener('click', () => { $('#sManual').innerHTML = ''; M.reset('structure'); fill(); });

  // ---------- results
  function results(g) {
    const p = g.p, r = [
      ['Triangles per side', String(g.n)], ['Triangles cut by the edge posts', String(g.nCut)], ['Triangles total', String(g.n * 2)],
      ['Clear span between pillars', fmt(g.xr - g.xl) + ' mm'],
      ['Edge post to first triangle', g.endGap >= -0.5 ? fmt(g.endGap) + ' mm' : `cut by ${fmt(-g.endGap)} mm`],
      ['Truss underside above ground', fmt(p.pH - p.H) + ' mm'], ['Clear height between beams', fmt(g.h) + ' mm'],
      ['Top of the crop', fmt(M.greenhouse().crop * 1000) + ' mm'], ['I bottom above ground', fmt(p.pH - p.H - p.hI) + ' mm'],
      ['Leg length (outer edge)', fmt(g.legLen) + ' mm'], ['Leg angle to beam', fmtA(g.theta * 180 / Math.PI)], ['Apex angle', fmtA(180 - 2 * g.theta * 180 / Math.PI)]];
    if (p.gutter) { r.push(['Gutter lines', String(g.nG)]); if (g.nG > 1) r.push(['Gutter line pitch', fmt(g.gPitch) + ' mm']); r.push(['Gutter above ground', fmt(p.pH - p.H - p.gHang) + ' mm']); }
    if (p.culture) { r.push(['Culture lines', String(g.nC)]); if (p.gutter) r.push(['Culture to gutter line', fmt(p.cDist) + ' mm']); else if (g.nC > 1) r.push(['Culture line pitch', fmt(g.cPitch) + ' mm']); }
    if (g.Is.length) { r.push(['I placed', `${g.Is.length} of ${Math.floor(p.nI)}`], ['I on a structure reference', `${g.nRef} of ${g.Is.length}`]); if (Number.isFinite(g.minSpace)) r.push(['Smallest module line spacing', fmt(g.minSpace) + ' mm']); }
    return r;
  }
  function iRows(g) {
    const p = g.p;
    return (g.lines || []).map(l => {
      const I = l.I; let locate;
      if (I) locate = I.refs.length ? I.refs.map(r => ({ part: r.part, how: r.how })) : [{ part: 'Measure', how: `${fmt(I.x)} mm from the outer face of the left pillar` }];
      else if (l.rep) locate = [{ part: 'Adjacent bay', how: `bracket line on the ${p.brkSide === 'left' ? 'next' : 'previous'} pillar (the pattern repeats)` }];
      else locate = [{ part: 'Bracket', how: `on the ${p.brkSide} pillar, ${fmt(p.brkDist)} mm from its face` }];
      return { id: l.id, kind: I ? 'i' : l.rep ? 'adj' : 'brk', x: l.x, gap: l.gap, short: l.gap != null && l.gap < p.dmin - 0.5,
        ubL: I ? I.x - g.ig.ub : null, ubR: I ? I.x + g.ig.ub : null, locate, free: !!(I && !I.refs.length),
        nearL: I && !I.refs.length ? I.near.left : null, nearR: I && !I.refs.length ? I.near.right : null,
        status: !I ? '' : I.clash ? 'Check' : I.refs.length ? 'Referenced' : 'Free' };
    });
  }
  const iSummary = g => `${g.Is.length} of ${Math.floor(g.p.nI)} I placed · ${g.nRef} on a structure reference · smallest spacing ${Number.isFinite(g.minSpace) ? fmt(g.minSpace) : 'n/a'} mm (limit ${fmt(g.p.dmin)} mm)`;
  const summary = () => { const g = M.geometry(); return `${(g.p.L / 1000).toFixed(2)} m chapel · ${g.p.brk ? 'bracket + ' : ''}${g.Is.length} I`; };

  // ---------- 2D views
  function renderViews() {
    const g = M.geometry(), w = windows(g);
    const put = (id, o) => { const el = $(id), W = Math.max(el.clientWidth || 0, o.minW); el.innerHTML = toSVG(drawView(g, Object.assign({ W, fs: 11, dotR: 3.2 }, o))); };
    put('#sOverall', { xmin: 0, xmax: g.p.L + g.p.pw, minW: 760 });
    put('#sMid', Object.assign({ detail: true, minW: 420 }, w.mid));
    put('#sEnd', Object.assign({ detail: true, minW: 420 }, w.end));
    const n = g.Is.length; $('#sIPanel').hidden = !n; if (!n) return;
    iSel = Math.max(0, Math.min(iSel, n - 1)); const I = g.Is[iSel];
    const wI = Math.max($('#sI').clientWidth || 0, 420); put('#sI', Object.assign({ detail: true, minW: 420 }, iWin(g, I, wI)));
    $('#sILbl').textContent = `${I.id} of ${n}`; $('#sIPrev').disabled = iSel === 0; $('#sINext').disabled = iSel === n - 1;
    $('#sICap').textContent = iCaption(I);
  }
  $('#sIPrev').addEventListener('click', () => { iSel--; renderViews(); });
  $('#sINext').addEventListener('click', () => { iSel++; renderViews(); });

  // ---------- 3D (structure only: one truss, its pillars, lines and I attachments)
  let v3 = null, t3 = 0;
  function view3(kind) {
    if (!v3) return;
    const gh = M.greenhouse(), W = gh.W, cx = (W + gh.pw) / 2, z = gh.tb;
    if (kind === 'front') v3.look([cx, -W * 1.15, z], [cx, 0, z]);
    else if (kind === 'side') v3.look([-W * 0.9, 0, z], [cx, 0, z - 0.5]);
    else if (kind === 'top') v3.look([cx, -0.01, gh.top + W * 1.1], [cx, 0, z]);
    else v3.look([cx - W * 0.55, -W * 0.8, gh.top + 1.2], [cx, 0, z - 0.6]);
  }
  function build3() {
    if (!v3) return;
    GHD.Scene3D.addGreenhouse(v3, { chapels: [0, 1], trusses: [0, 0], voltiris: false, roof: false });
  }
  try {
    v3 = GHD.Scene3D.viewer($('#s3d'));
    $$('#s3dBar [data-view]').forEach(b => b.addEventListener('click', () => view3(b.dataset.view)));
    bindFullscreen($('#s3dWrap'), $('#s3dFull'));
  } catch (e) { v3 = null; $('#s3d').innerHTML = '<p class="noview">The 3D view needs WebGL, which this browser does not offer here. Everything else works.</p>'; }

  // ---------- render
  // checks of the structure: those of the geometry, plus the crop and the number of module lines
  function warnings() {
    const p = M.S.structure, g = M.geometry(), out = g.warn.slice(), gz = p.pH - p.H - p.gHang;
    if (p.gutter && p.crop < gz - 0.5) out.push(`The top of the crop (${fmt(p.crop)} mm) is below the gutters (${fmt(gz)} mm above the ground): the crop is taken at the gutters.`);
    const n = g.Is.length + (g.xb != null ? 1 : 0);
    if (n !== 5) out.push(`A chapel has ${n} module lines; the design assumes 5 (the bracket line and 4 I, or 5 I).`);
    if (!(p.hI > 0)) out.push('Set an installation height for the I.');
    return out;
  }
  function render() {
    const p = M.S.structure, g = M.geometry();
    $('#scrop').min = p.gutter ? Math.round(p.pH - p.H - p.gHang) : 0;
    $('#sGutter').hidden = !p.gutter;
    $('#sCultureWithG').hidden = !(p.culture && p.gutter);
    $('#sCultureAlone').hidden = !(p.culture && !p.gutter);
    $('#sFixHint').hidden = !(p.culture || p.gutter);
    $('#sBrk').hidden = !p.brk; $('#sBrkHint').hidden = !p.brk; $('#sNoBrkHint').hidden = p.brk;
    $('#sUniform').hidden = p.iMode !== 'uniform'; $('#sManual').hidden = p.iMode !== 'manual'; $('#sOptimal').hidden = p.iMode !== 'optimal';
    $('#sULbl').textContent = p.brk ? 'First I from bracket line' : 'First I from left pillar';
    $('#sExample').hidden = !NUMS.every(k => p[k] === M.DEF.structure[k]);
    renderViews();
    clearTimeout(t3); t3 = setTimeout(build3, 60);
    $('#sKf').innerHTML = results(g).map(([a, b]) => `<div><small>${esc(a)}</small><b>${esc(b)}</b></div>`).join('');
    const warn = warnings(), nw = warn.length;
    $('#sStatus').innerHTML = nw ? `<span class="pill w">${nw} to check</span>` : '<span class="pill m">Geometry consistent</span>';
    $('#sLinesCard').hidden = !(g.lines && g.lines.length);
    if (g.lines && g.lines.length) {
      $('#sSum').textContent = iSummary(g);
      $('#sTable').innerHTML = '<thead><tr><th>Line</th><th class="n">Position x</th><th class="n">Spacing to previous</th><th class="n">Left U-bolt x</th><th class="n">Right U-bolt x</th><th>How to locate it</th><th>Nearest fixed point, left</th><th>Nearest fixed point, right</th><th>Status</th></tr></thead><tbody>' +
        iRows(g).map(r => `<tr class="${r.kind}"><td>${esc(r.id)}</td><td class="n">${fmt(r.x)}</td><td class="n${r.short ? ' bad' : ''}">${r.gap != null ? fmt(r.gap) + (r.short ? ' (below limit)' : '') : ''}</td><td class="n">${r.ubL != null ? fmt(r.ubL) : ''}</td><td class="n">${r.ubR != null ? fmt(r.ubR) : ''}</td><td class="loc">${r.locate.map(q => `<div><b>${esc(q.part)}</b> ${esc(q.how)}</div>`).join('')}</td>${['nearL', 'nearR'].map(k => `<td class="near">${r.free ? (r[k] ? `<b>${fmt(r[k].d)} mm</b><div>${esc(r[k].desc)}</div>` : 'none') : ''}</td>`).join('')}<td>${r.status ? `<span class="pill${r.status === 'Check' ? ' w' : r.status === 'Free' ? '' : ' m'}">${r.status}</span>` : ''}</td></tr>`).join('') + '</tbody>';
    }
    $('#sChecks').innerHTML = nw ? warn.map(w => `<li>${esc(w)}</li>`).join('') : '<li class="ok">No conflicts found. All members fit, no fixation sits over a pillar and every I is clear.</li>';
  }
  let firstView = true;
  M.on(section => { if (section === 'structure') render(); if (section === 'loaded') { $('#sManual').innerHTML = ''; fill(); render(); } });

  // ---------- report pages (landscape)
  function reportPages(R) {
    const { doc, T, tbl } = R, g = M.geometry(), p = g.p, PW = 842, Mg = 36, dW = (PW - 2 * Mg - 20) / 2;
    const { drawPdf } = GHD.StructureDraw;
    const mode = { optimal: 'Optimal', uniform: `Uniform, first at ${fmt(p.uFirst)} mm`, manual: 'Manual' }[p.iMode];
    // page 1: elevation, inputs, results
    R.page('Structure · elevation', 'l');
    const vO = drawView(g, { xmin: 0, xmax: p.L + p.pw, W: PW - 2 * Mg, fs: 7, dotR: 2 });
    drawPdf(doc, vO, Mg, 92);
    const y = 92 + vO.H + 10, colW = (PW - 2 * Mg - 20) / 2;
    const inputs = [['Truss length (chapel width)', fmt(p.L) + ' mm'], ['Truss height (outer)', fmt(p.H) + ' mm'], ['Beam thickness', fmt(p.tc) + ' mm'], ['Structure thickness', fmt(p.zW) + ' mm'],
      ['Pillars', `${fmt(p.pw)} mm wide, ${fmt(p.pH)} mm ground to truss top`], ['Edge post width', fmt(p.te) + ' mm'], ['Truss spacing', fmt(p.bay) + ' mm'], ['Top of the crop', fmt(p.crop) + ' mm'],
      ['Triangles per side', String(Math.floor(p.nSide))], ['Triangle length (base, outer)', fmt(p.w) + ' mm'], ['Triangle bar thickness', fmt(p.td) + ' mm'],
      ['Middle reinforcement', fmt(p.tm) + ' mm'], ['Gap middle / between triangles', `${fmt(p.offMid)} / ${fmt(p.offBtw)} mm`],
      ['Gutter lines', p.gutter ? `${Math.floor(p.gCount)}, first at ${fmt(p.gFirst)} mm, ${fmt(p.gHang)} mm below truss` : 'None'],
      ['Culture lines', !p.culture ? 'None' : p.gutter ? `${fmt(p.cDist)} mm each side of every gutter line` : `${Math.floor(p.cCount)}, first at ${fmt(p.cFirst)} mm`],
      ['Bracket line', p.brk ? `${p.brkSide === 'left' ? 'Left' : 'Right'} pillar, ${fmt(p.brkDist)} mm` : 'None'],
      ['I attachments', `${Math.floor(p.nI)}, ${mode}, at least ${fmt(p.dmin)} mm apart`], ['I installation height / plate / U-bolt inset / rod', `${fmt(p.hI)} / ${fmt(p.plate)} / ${fmt(p.ubIn)} / ${fmt(p.rod)} mm`]];
    tbl({ startY: y, head: [['Input', R.right('Value')]], body: inputs, tableWidth: colW, compact: true, columnStyles: { 1: { halign: 'right' } } });
    tbl({ startY: y, head: [['Result', R.right('Value')]], body: results(g), tableWidth: colW, compact: true, margin: { left: Mg + colW + 20 }, columnStyles: { 1: { halign: 'right' } } });
    // page 2: details and module lines
    R.page('Structure · details', 'l');
    const w = windows(g);
    const vM = drawView(g, Object.assign({ W: dW, fs: 7, dotR: 2, detail: true }, w.mid)), vE = drawView(g, Object.assign({ W: dW, fs: 7, dotR: 2, detail: true }, w.end));
    T('Middle', Mg, 90, { s: 8, c: R.STEEL }); T('Left end (right end is symmetric)', Mg + dW + 20, 90, { s: 8, c: R.STEEL });
    drawPdf(doc, vM, Mg, 96); drawPdf(doc, vE, Mg + dW + 20, 96);
    let y2 = 96 + Math.max(vM.H, vE.H) + 14;
    T('Gutter lines (squares), culture lines (circles) and I base plates are fixed to the underside of the lower beam. I bars are drawn shortened.', Mg, y2, { s: 8, c: R.STEEL }); y2 += 10;
    if (g.lines && g.lines.length) {
      T('Module lines · ' + iSummary(g), Mg, y2 + 12, { s: 8, c: R.STEEL });
      tbl({ startY: y2 + 18, head: [['Line', R.right('Position x'), R.right('Spacing to previous'), R.right('Left U-bolt x'), R.right('Right U-bolt x'), 'How to locate it', 'Nearest fixed point, left', 'Nearest fixed point, right', 'Status']],
        body: iRows(g).map(r => [r.id, fmt(r.x), r.gap != null ? fmt(r.gap) + (r.short ? ' (below limit)' : '') : '', r.ubL != null ? fmt(r.ubL) : '', r.ubR != null ? fmt(r.ubR) : '', r.locate.map(q => q.part + ' ' + q.how).join('\n'), r.free ? nearTxt(r.nearL) : '', r.free ? nearTxt(r.nearR) : '', r.status]),
        columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { cellWidth: 190 }, 6: { cellWidth: 115 }, 7: { cellWidth: 115 } } });
    }
    // page 3: every I
    let yEnd = null;
    if (g.Is.length) {
      R.page('Structure · I attachments', 'l');
      let yy = 84, col = 0, rowH = 0;
      for (const I of g.Is) {
        const v = drawView(g, Object.assign({ W: dW, fs: 7, dotR: 2, detail: true }, iWin(g, I)));
        doc.setFont('LexendLight', 'normal'); doc.setFontSize(7.5);
        const cap = doc.splitTextToSize(iCaption(I), dW), need = v.H + 12 + cap.length * 10;
        if (col === 0 && yy + need > 595 - 40) { R.page('Structure · I attachments', 'l'); yy = 84; }
        const ox = Mg + col * (dW + 20); drawPdf(doc, v, ox, yy); T(cap, ox, yy + v.H + 8, { s: 7.5, c: R.STEEL });
        rowH = Math.max(rowH, need); col++; if (col === 2) { col = 0; yy += rowH + 10; rowH = 0; }
      }
      yEnd = (col ? yy + rowH : yy) + 6;
    }
    R.checks('Structure checks', warnings(), yEnd);
  }

  GHD.StructureTab = {
    start() { fill(); render(); },
    shown() { renderViews(); if (firstView) { view3('iso'); firstView = false; } },
    summary, reportPages, resize: renderViews, view3,
  };
})();
