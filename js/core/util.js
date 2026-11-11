/* Shared helpers for every tab: DOM shortcuts, number formats, canvas sizing, file saving, full screen. */
(function () {
  'use strict';
  const GHD = window.GHD = window.GHD || {};
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const nf = (v, d = 0) => (v == null || !isFinite(v)) ? '–' : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const pct = (v, d = 0) => nf(100 * v, d) + '%';
  const m2 = v => nf(v, 2) + ' m';
  const mm = v => (Number.isFinite(v) ? String(Math.round(v) || 0) : '–') + ' mm';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const isDark = () => css('--bg').toLowerCase() === '#07121e';

  // canvas drawn at device resolution, sized in CSS pixels
  function sizeCanvas(cv, cssW, cssH) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
    cv.style.height = cssH + 'px';
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return ctx;
  }

  // set aria-pressed on a segmented control
  function seg(selector, attr, value) { $$(selector).forEach(b => b.setAttribute('aria-pressed', String(b.dataset[attr] === String(value)))); }

  // saves a file: through the viewer's download capability when the page runs as a Claude artifact, otherwise a normal download
  async function saveFile(blob, filename) {
    if (window.claude && typeof window.claude.use === 'function') {
      let dl = null; try { dl = await window.claude.use('downloads'); } catch (e) { dl = null; }
      if (!dl) return 'unavailable';
      try { await dl.save({ filename, data: blob }); return 'saved'; }
      catch (e) { return e && (e.code === 'declined' || e.code === 'rate_limited') ? 'declined' : 'unavailable'; }
    }
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return 'saved';
  }

  // full screen for a viewer box: the browser's own full screen, or a fixed overlay where it is refused
  function bindFullscreen(wrap, btn, onChange) {
    const isFull = () => document.fullscreenElement === wrap || wrap.classList.contains('full');
    const sync = () => {
      btn.textContent = isFull() ? 'Exit full screen' : 'Full screen';
      document.body.style.overflow = wrap.classList.contains('full') ? 'hidden' : '';
      if (onChange) onChange();
    };
    btn.addEventListener('click', async () => {
      if (isFull()) { if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch (e) { /* ignore */ } } wrap.classList.remove('full'); sync(); return; }
      try { if (!wrap.requestFullscreen) throw 0; await wrap.requestFullscreen(); } catch (e) { wrap.classList.add('full'); }
      sync();
    });
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && wrap.classList.contains('full')) { wrap.classList.remove('full'); sync(); } });
  }

  GHD.util = { $, $$, nf, pct, m2, mm, esc, css, isDark, sizeCanvas, seg, saveFile, bindFullscreen };
})();
