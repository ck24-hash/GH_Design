/* One PDF report for the whole design: a cover with the summary, then the pages of each tab in order.
   Each tab gives reportPages(R); R is the shared page kit (fonts, header, footer, text, tables). */
(function () {
  'use strict';
  const GHD = window.GHD, M = GHD.Model, { nf, saveFile } = GHD.util;
  const NAVY = [0, 29, 59], STEEL = [64, 89, 138], TEAL = [0, 201, 165], LINE = [217, 226, 239], TINT = [238, 243, 250];

  function kit(doc) {
    const D = GHD.DATA, today = new Date().toISOString().slice(0, 10);
    const W = () => doc.internal.pageSize.getWidth(), H = () => doc.internal.pageSize.getHeight();
    let first = true;
    const T = (txt, x, y, o) => { o = o || {}; doc.setFont(o.m ? 'LexendMedium' : 'LexendLight', 'normal'); doc.setFontSize(o.s || 9.5); doc.setTextColor(...(o.c || NAVY)); doc.text(txt, x, y, { align: o.a || 'left', maxWidth: o.w, lineHeightFactor: o.lh || 1.3 }); };
    const wrapH = (txt, w, s) => { doc.setFont('LexendLight', 'normal'); doc.setFontSize(s || 9.5); return doc.splitTextToSize(txt, w).length * (s || 9.5) * 1.3; };
    const header = title => {
      const PW = W(), ML = 36;
      doc.setFillColor(...TEAL); doc.rect(0, 0, PW, 4, 'F');
      doc.addImage('data:image/png;base64,' + D.logo, 'PNG', ML, 22, 56, 20.2);
      T('GH design · ' + title, ML + 68, 36, { c: STEEL, s: 9.5 });
      doc.setDrawColor(...LINE); doc.setLineWidth(0.6); doc.line(ML, 52, PW - ML, 52);
    };
    // new page with header; orientation 'p' or 'l'
    const page = (title, orient) => {
      if (first) { first = false; if ((orient || 'p') === 'l') { doc.deletePage(1); doc.addPage('a4', 'l'); } }
      else doc.addPage('a4', orient || 'p');
      header(title); R.title = title; R.headed = doc.getNumberOfPages();
    };
    const right = c => ({ content: c, styles: { halign: 'right' } });
    const tbl = o => {
      const compact = o.compact; delete o.compact;
      doc.autoTable(Object.assign({ theme: 'plain',
        styles: { font: 'LexendLight', fontSize: compact ? 7.5 : 8, cellPadding: compact ? 2.2 : 3, textColor: NAVY, lineColor: LINE, lineWidth: { bottom: 0.5 } },
        headStyles: { font: 'LexendMedium', textColor: STEEL }, margin: { left: 36, right: 36, top: 66 },
        didDrawPage: () => { if (doc.getCurrentPageInfo().pageNumber > R.headed) { header(R.title + ' (continued)'); R.headed = doc.getCurrentPageInfo().pageNumber; } } }, o));
      return doc.lastAutoTable.finalY;
    };
    // y: where the list starts on the current page (default: under the last table)
    const checks = (title, list, y) => {
      if (y == null) y = (doc.lastAutoTable && doc.lastAutoTable.finalY || 70) + 14;
      if (y > H() - 90) { page(R.title, doc.internal.pageSize.getWidth() > doc.internal.pageSize.getHeight() ? 'l' : 'p'); y = 70; }
      tbl({ startY: y, head: [[title]], body: list.length ? list.map(s => [s]) : [['No conflicts found.']] });
    };
    const R = { doc, T, wrapH, page, right, tbl, checks, header, today, NAVY, STEEL, TEAL, LINE, TINT, W, H, headed: 0, title: '' };
    return R;
  }

  async function make(btn, note) {
    const J = window.jspdf && window.jspdf.jsPDF;
    if (!J) { note.textContent = 'The PDF library did not load. Reload the page.'; return; }
    if (!GHD.LedTab.ready()) { note.textContent = 'The light calculation is still running. Download again when the status shows Up to date.'; return; }
    btn.disabled = true; const old = btn.innerHTML; btn.textContent = 'Preparing…'; note.textContent = '';
    try {
      const doc = new J({ unit: 'pt', format: 'a4', compress: true });
      const D = GHD.DATA;
      doc.addFileToVFS('LexendLight.ttf', D.fonts.light); doc.addFont('LexendLight.ttf', 'LexendLight', 'normal');
      doc.addFileToVFS('LexendMedium.ttf', D.fonts.medium); doc.addFont('LexendMedium.ttf', 'LexendMedium', 'normal');
      const R = kit(doc);
      cover(R);
      GHD.StructureTab.reportPages(R);
      GHD.VoltTab.reportPages(R);
      GHD.LedTab.reportPages(R);
      const n = doc.getNumberOfPages();
      for (let i = 1; i <= n; i++) {
        doc.setPage(i); const PW = doc.internal.pageSize.getWidth(), PH = doc.internal.pageSize.getHeight();
        R.T(`${R.today} · page ${i} of ${n}`, PW - 36, 36, { a: 'right', c: STEEL, s: 9 });
        R.T('Voltiris SA · Lausanne · GH design, for planning. Geometry only, no structural verification. Light results are estimates; check the light plan with the LED supplier.', 36, PH - 22, { c: STEEL, s: 7 });
      }
      const P = M.S.project, name = `${(P.name || 'greenhouse').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'greenhouse'}_GH-design_${R.today}.pdf`;
      const res = await saveFile(doc.output('blob'), name);
      note.textContent = res === 'declined' ? 'Download cancelled.' : res === 'unavailable' ? 'Downloads are not available in this view.' : `Saved ${name}.`;
    } catch (err) { console.error(err); note.textContent = 'Could not make the PDF: ' + (err && err.message || err); }
    finally { btn.disabled = false; btn.innerHTML = old; }
  }

  function cover(R) {
    const P = M.S.project, gh = M.greenhouse(), g = gh.geom;
    R.page('summary', 'p');
    R.T(P.name || 'Greenhouse design', 36, 92, { m: true, s: 20 });
    R.T([`Truss ${P.ref || '-'}`, `Rev ${P.rev || '-'}`, P.author ? 'Prepared by ' + P.author : null].filter(Boolean).join('  ·  '), 36, 110, { c: STEEL, s: 10 });
    const rows = [
      ['Structure', `Chapels of ${nf(gh.W, 2)} m, trusses every ${nf(gh.L, 2)} m, truss top at ${nf(gh.top, 2)} m, truss ${nf(gh.depth * 1000)} mm deep. ${g.n * 2} triangles per truss. I installation height ${nf(M.S.structure.hI)} mm. Top of the crop ${nf(gh.crop, 2)} m. ${M.S.structure.gutter ? g.nG + ' gutter lines' : 'No gutter lines'}, ${M.S.structure.culture ? g.nC + ' culture lines' : 'no culture lines'}.`],
      ['Module lines', `${gh.lines.length} per chapel: ${gh.lines.map(l => `${l.id} ${nf(l.x, 3)} m`).join(', ')}.`],
      ['Voltiris', GHD.VoltTab.summaryText()],
      ['LEDs', GHD.LedTab.summaryText()],
    ];
    R.tbl({ startY: 130, head: [['Section', 'Summary']], body: rows, columnStyles: { 0: { cellWidth: 90, font: 'LexendMedium' } } });
    if (P.notes && P.notes.trim()) R.tbl({ startY: R.doc.lastAutoTable.finalY + 14, head: [['Notes']], body: [[P.notes.trim()]] });
  }

  GHD.Report = { make };
})();
