// Loads the data files, then starts the app. Needs to be served over http (see README).
(async function () {
  const get = name => fetch('data/' + name).then(r => { if (!r.ok) throw new Error(name + ': HTTP ' + r.status); return r.json(); });
  try {
    const [kit, mesh, curves, assets, lib] = await Promise.all(['kit.json', 'mesh.json', 'curves.json', 'assets.json', 'led-library.json'].map(get));
    window.LEDLAB_DATA = { kit, mesh, curves, logo: assets.logo, fonts: assets.fonts, built: assets.built };
    window.LEDLAB_LIB = lib;
  } catch (e) {
    document.body.insertAdjacentHTML('afterbegin', '<p style="margin:24px;font:14px system-ui">Could not load the data files (' + e.message + '). Open this page through a web server, not by double-clicking the file. See README.md.</p>');
    return;
  }
  const s = document.createElement('script'); s.src = 'js/app.js'; document.body.appendChild(s);
})();
