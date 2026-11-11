// Loads the data files, then the tabs in order. Needs to be served over http (see README).
(async function () {
  const get = name => fetch('data/' + name).then(r => { if (!r.ok) throw new Error(name + ': HTTP ' + r.status); return r.json(); });
  const load = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error(src + ' did not load')); document.body.appendChild(s); });
  try {
    const [kit, mesh, curves, assets, lib] = await Promise.all(['kit.json', 'mesh.json', 'curves.json', 'assets.json', 'led-library.json'].map(get));
    const GHD = window.GHD = window.GHD || {};
    GHD.DATA = { kit, mesh, curves, logo: assets.logo, fonts: assets.fonts, built: assets.built };
    GHD.LIB = lib;
    document.documentElement.style.setProperty('--logo', `url(data:image/png;base64,${assets.logo})`);
    for (const src of [
      'js/core/util.js', 'js/structure/geometry.js', 'js/structure/drawing.js', 'js/core/model.js', 'js/core/scene3d.js', 'js/core/report.js',
      'js/structure/tab.js', 'js/voltiris/tab.js', 'js/leds/photometry.js', 'js/leds/tab.js', 'js/core/shell.js',
    ]) await load(src);
  } catch (e) {
    document.body.insertAdjacentHTML('afterbegin', '<p style="margin:24px;font:14px system-ui">Could not start (' + e.message + '). Open this page through a web server, not by double-clicking the file. See README.md.</p>');
    console.error(e);
  }
})();
