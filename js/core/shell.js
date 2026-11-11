/* Page shell: the three tabs in order (Structure, Voltiris, LEDs), their one-line summaries and the PDF report. */
(function () {
  'use strict';
  const GHD = window.GHD, M = GHD.Model, { $, $$ } = GHD.util;
  const TABS = ['structure', 'voltiris', 'leds'];
  const mod = { structure: GHD.StructureTab, voltiris: GHD.VoltTab, leds: GHD.LedTab };
  let cur = null;

  function show(name) {
    if (!TABS.includes(name)) name = 'structure';
    if (cur && cur !== name && mod[cur].hidden) mod[cur].hidden();
    const changed = cur !== name; cur = name;
    for (const t of TABS) {
      const on = t === name;
      $('#panel-' + t).hidden = !on;
      const b = $('#tab-' + t); b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
    }
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
    if (changed) window.scrollTo(0, 0);
    if (mod[name].shown) mod[name].shown();
  }
  function summaries() {
    $('#sumStructure').textContent = GHD.StructureTab.summary();
    $('#sumVoltiris').textContent = GHD.VoltTab.summary();
    $('#sumLeds').textContent = GHD.LedTab.summary();
  }

  $$('[role="tab"]').forEach(b => {
    b.addEventListener('click', () => show(b.dataset.tab));
    b.addEventListener('keydown', e => {
      const k = TABS.indexOf(b.dataset.tab), d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return; const n = TABS[(k + d + TABS.length) % TABS.length]; show(n); $('#tab-' + n).focus();
    });
  });
  document.addEventListener('click', e => { const b = e.target.closest('[data-goto]'); if (b) { e.preventDefault(); show(b.dataset.goto); } });
  window.addEventListener('hashchange', () => show(location.hash.slice(1)));

  // PDF: the light plan needs a finished calculation; start it if needed and wait (up to two minutes)
  $('#pdfBtn').addEventListener('click', async e => {
    const btn = e.currentTarget, note = $('#reportNote');
    if (!GHD.LedTab.ready()) {
      GHD.LedTab.ensure(); btn.disabled = true; note.textContent = 'Calculating the light for the report…';
      const t0 = Date.now();
      while (!GHD.LedTab.ready() && Date.now() - t0 < 120000) await new Promise(r => setTimeout(r, 400));
      btn.disabled = false;
      if (!GHD.LedTab.ready()) { note.textContent = 'The light calculation did not finish. Open the LEDs tab, wait for Light up to date, then try again.'; return; }
    }
    GHD.Report.make(btn, note);
  });

  // design files: every parameter in one JSON file, to keep versions or share a design
  $('#saveBtn').addEventListener('click', async () => {
    const note = $('#reportNote'), today = new Date().toISOString().slice(0, 10);
    const name = `${(M.S.project.name || 'greenhouse').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'greenhouse'}_GH-design_${today}.json`;
    const res = await GHD.util.saveFile(new Blob([M.toFile()], { type: 'application/json' }), name);
    note.textContent = res === 'saved' ? `Saved ${name}. Open it with Open design to get this design back.` : res === 'declined' ? 'Download cancelled.' : 'Downloads are not available in this view.';
  });
  $('#openFile').addEventListener('change', e => {
    const file = e.target.files && e.target.files[0], note = $('#reportNote'); if (!file) return;
    const rd = new FileReader();
    rd.onload = () => { const err = M.fromFile(String(rd.result)); note.textContent = err ? `Could not open ${file.name}: ${err}.` : `Opened ${file.name}.`; e.target.value = ''; };
    rd.readAsText(file);
  });

  M.on(() => summaries());
  GHD.Shell = { show, summaries };
  GHD.StructureTab.start();
  GHD.VoltTab.start();
  summaries();
  show(location.hash.slice(1));
})();
