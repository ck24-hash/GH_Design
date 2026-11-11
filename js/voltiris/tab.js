/* Voltiris tab: the modules on the module lines set in the Structure tab (bracket line and I attachments).
   Owns Model.S.volt (on/off, night position). Module positions along each line come from the Voltiris kit. */
(function () {
  'use strict';
  const GHD = window.GHD, M = GHD.Model, { $, $$, nf, esc, m2, seg, bindFullscreen } = GHD.util;
  const KIT = GHD.DATA.kit, R_ENV = KIT.envelope.radius;

  $('#vOn').addEventListener('change', e => M.set('volt', { on: e.target.checked }));
  $$('#vPose [data-pose]').forEach(b => b.addEventListener('click', () => M.set('volt', { pose: b.dataset.pose })));

  // module lines with their pattern and the modules along one truss bay
  function lineInfo() {
    const gh = M.greenhouse(), pat = M.patterns(gh.L);
    const n = gh.lines.length;
    const lines = gh.lines.map((l, k) => { const a = M.patternOf(0, k, n), b = M.patternOf(1, k, n); return { ...l, pat: a, pat2: b, ys: pat[a] }; });
    lines.forEach((l, k) => { l.gap = k ? l.x - lines[k - 1].x : null; });
    return { gh, pat, lines };
  }
  function stats() {
    const { gh, lines } = lineInfo(), perBay = lines.length * 2, area = gh.W * gh.L;
    let minS = Infinity; for (let k = 1; k < lines.length; k++) minS = Math.min(minS, lines[k].gap);
    if (lines.length) minS = Math.min(minS, gh.W - lines[lines.length - 1].x + lines[0].x);   // across the pillar to the next chapel
    return { lines: lines.length, perBay, perHa: perBay / area * 10000, minS };
  }
  function checks() {
    const { gh, lines } = lineInfo(), out = [], s = M.S.structure;
    if (!lines.length) out.push('There are no module lines: add I attachments or the bracket line in the Structure tab.');
    if (s.nI > 0 && gh.geom.Is.length < Math.floor(s.nI)) out.push(`Only ${gh.geom.Is.length} of ${Math.floor(s.nI)} I could be placed in the Structure tab.`);
    if (lines.length && lines.length !== 5) out.push(`There are ${lines.length} module lines per chapel; the design assumes 5.`);
    // the sweep of a module reaches the truss when its pivot is closer to the truss than the sweep radius
    const yMin = Math.min(...M.patterns(gh.L).A, ...M.patterns(gh.L).B), toTruss = Math.min(yMin, gh.L - Math.max(...M.patterns(gh.L).A, ...M.patterns(gh.L).B)) - gh.zW / 2;
    if (lines.length && toTruss < R_ENV) out.push(`With trusses every ${nf(gh.L, 2)} m, the closest module pivot is ${nf(toTruss, 2)} m from the truss, inside the ${nf(R_ENV, 2)} m sweep radius.`);
    return out;
  }
  const summaryText = () => {
    if (!M.S.volt.on) return 'Not installed.';
    const st = stats();
    return `${st.lines} module lines per chapel, alternating A and B over the greenhouse, 2 modules per line in every truss bay (${st.perBay} per chapel and bay, ${nf(st.perHa)} per hectare). Night position: ${M.pose().label.toLowerCase()}. Pivot ${nf(M.greenhouse().pivot, 2)} m above the ground.`;
  };

  // ---------- 3D: three chapels, two truss bays
  let v3 = null, t3 = 0, view = 'iso';
  function look(kind) {
    if (!v3) return; view = kind;
    const gh = M.greenhouse(), W = gh.W, L = gh.L, zc = gh.top - 1.4;
    if (kind === 'section') v3.look([W / 2 + 0.8, -15, zc + 0.4], [W / 2 + 0.8, 0, zc]);
    else if (kind === 'top') v3.look([W / 2, L / 2 - 0.01, gh.top + 18], [W / 2, L / 2, gh.top - 1]);
    else v3.look([W * 0.05 - 6, -9.5, gh.top + 2.3], [W * 0.6, L * 0.3, zc]);
    seg('#v3dBar [data-view]', 'view', kind);
  }
  function build3() {
    if (!v3) return;
    GHD.Scene3D.addGreenhouse(v3, { chapels: [-1, 2], trusses: [-1, 1], voltiris: M.S.volt.on, pose: M.pose() });
  }
  try {
    v3 = GHD.Scene3D.viewer($('#v3d'));
    $$('#v3dBar [data-view]').forEach(b => b.addEventListener('click', () => look(b.dataset.view)));
    bindFullscreen($('#v3dWrap'), $('#v3dFull'));
  } catch (e) { v3 = null; $('#v3d').innerHTML = '<p class="noview">The 3D view needs WebGL, which this browser does not offer here. Everything else works.</p>'; }

  function render() {
    const V = M.S.volt, { gh, pat, lines } = lineInfo(), st = stats(), ck = checks();
    $('#vOn').checked = V.on;
    seg('#vPose [data-pose]', 'pose', V.pose);
    $('#vPoseField').hidden = !V.on;
    $('#vLinesNote').textContent = lines.length ? `${lines.length} module lines per chapel, set in the Structure tab: ${lines.map(l => l.id).join(', ')}.` : 'No module lines yet. Add I attachments or the bracket line in the Structure tab.';
    $('#vPattern').innerHTML = `<dt>Lines A</dt><dd>${pat.A.map(y => nf(y, 2)).join(' m, ')} m from the truss</dd><dt>Lines B</dt><dd>${pat.B.map(y => nf(y, 2)).join(' m, ')} m from the truss</dd>`;
    $('#vK1').innerHTML = `${st.lines}<small>per chapel</small>`;
    $('#vK2').innerHTML = `${st.perBay}<small>per chapel and bay</small>`;
    $('#vK3').innerHTML = `${nf(st.perHa)}<small>per ha</small>`;
    $('#vK4').innerHTML = Number.isFinite(st.minS) ? `${nf(st.minS, 3)}<small>m</small>` : '–';
    $('#vS4').textContent = `limit ${nf(M.S.structure.dmin / 1000, 3)} m, including the next chapel`;
    $('#vTable tbody').innerHTML = lines.map(l => `<tr><td>${esc(l.id)}</td><td>${l.kind === 'bracket' ? 'Bracket on the pillar' : 'I on the lower beam'}</td><td class="n">${nf(l.x, 3)}</td><td class="n">${l.gap != null ? nf(l.gap, 3) : ''}</td><td>${l.pat} / ${l.pat2}</td><td class="n">${l.ys.map(y => nf(y, 2)).join(' · ')}</td></tr>`).join('')
      || '<tr><td colspan="6">No module lines.</td></tr>';
    $('#vChecks').innerHTML = (V.on ? ck : ['Voltiris is switched off.']).map(c => `<li${!V.on ? ' class="ok"' : ''}>${esc(c)}</li>`).join('') || '<li class="ok">No conflicts found.</li>';
    clearTimeout(t3); t3 = setTimeout(build3, 60);
  }
  M.on(section => { if (section === 'structure' || section === 'volt' || section === 'loaded') render(); });

  // ---------- report page (portrait)
  function reportPages(R) {
    const { doc, T } = R, { lines } = lineInfo(), st = stats();
    R.page('Voltiris installation', 'p');
    T('Voltiris installation', 36, 86, { m: true, s: 16 });
    T(summaryText(), 36, 104, { c: R.STEEL, s: 9.5, w: 523 });
    let y = 132;
    if (v3 && M.S.volt.on) {
      try { look(view); const img = v3.snapshot(1046, 560); doc.addImage(img, 'PNG', 36, y, 523, 280); y += 290; } catch (e) { /* no image */ }
    }
    R.tbl({ startY: y + 6, head: [['Line', 'Support', R.right('x, m'), R.right('Spacing, m'), 'Positions, chapel 1 / 2', R.right('Modules along the bay (chapel 1), m from the truss')]],
      body: lines.map(l => [l.id, l.kind === 'bracket' ? 'Bracket on the pillar' : 'I on the lower beam', nf(l.x, 3), l.gap != null ? nf(l.gap, 3) : '', `${l.pat} / ${l.pat2}`, l.ys.map(v => nf(v, 2)).join(' · ')]) });
    R.tbl({ startY: doc.lastAutoTable.finalY + 12, head: [['Figure', R.right('Value')]], columnStyles: { 1: { halign: 'right' } },
      body: [['Module lines per chapel', String(st.lines)], ['Modules per chapel and truss bay', String(st.perBay)], ['Modules per hectare', nf(st.perHa)], ['Smallest spacing between module lines', Number.isFinite(st.minS) ? nf(st.minS, 3) + ' m' : '–'], ['Module pivot above the ground', nf(M.greenhouse().pivot, 2) + ' m'], ['Night position', M.pose().label]] });
    R.checks('Voltiris checks', M.S.volt.on ? checks() : ['Voltiris is switched off.']);
  }

  let first = true;
  GHD.VoltTab = {
    start() { render(); },
    shown() { if (first && v3) { look('iso'); first = false; } },
    summary: () => M.S.volt.on ? `${stats().lines} lines · ${nf(stats().perHa)} modules/ha` : 'Not installed',
    summaryText, reportPages,
  };
})();
