// Browser smoke test: the manual check from CLAUDE.md, run in headless Chrome or Edge.
// Opens each tab, changes a structure value and checks the other tabs follow, uses the LED controls, pop-ups and map probe,
// makes the PDF report and saves and opens a design. Fails on any console error or uncaught exception.
//
//   node tests/smoke.mjs                      run the checks
//   node tests/smoke.mjs --save base.json     also store a snapshot (texts, canvas pixels, PDF pages)
//   node tests/smoke.mjs --compare base.json  run the checks and compare with a stored snapshot (for refactors)
//
// Browser: set CHROME to its path if it is not found. No npm dependencies (Node 22+ for the built-in WebSocket).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const SAVE = arg('--save'), COMPARE = arg('--compare');
const PORT = 8000 + Math.floor(Math.random() * 900), DPORT = 9300 + Math.floor(Math.random() * 600);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function findBrowser() {
  const c = [process.env.CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
  return c.find(p => p && fs.existsSync(p));
}
async function until(fn, ms, what) {
  const t0 = Date.now();
  for (;;) { try { const v = await fn(); if (v) return v; } catch (e) { /* not yet */ } if (Date.now() - t0 > ms) throw new Error('timed out: ' + what); await sleep(150); }
}

// ---------- Chrome DevTools protocol, the few calls needed
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.wait = new Map(); this.handlers = [];
    ws.addEventListener('message', ev => { const m = JSON.parse(ev.data);
      if (m.id && this.wait.has(m.id)) { const { res, rej } = this.wait.get(m.id); this.wait.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
      else if (m.method) this.handlers.forEach(h => h(m)); }); }
  send(method, params) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params: params || {} })); return new Promise((res, rej) => this.wait.set(id, { res, rej })); }
  on(fn) { this.handlers.push(fn); }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    return r.result.value;
  }
}

const browser = findBrowser();
if (!browser) { console.error('No Chrome or Edge found. Set CHROME to the browser path.'); process.exit(2); }
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ghd-smoke-'));
const server = spawn(process.execPath, ['serve.mjs', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
const chrome = spawn(browser, ['--headless=new', `--remote-debugging-port=${DPORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--window-size=1400,1000', '--force-device-scale-factor=1', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: 'ignore' });
let failed = 0;
const errors = [], snap = {};
const ok = msg => console.log('  ok    ' + msg);
const bad = msg => { failed++; console.log('  FAIL  ' + msg); };
const check = (cond, msg) => (cond ? ok(msg) : bad(msg));

async function main() {
  await until(() => fetch(`http://127.0.0.1:${PORT}/index.html`).then(r => r.ok), 10000, 'local server');
  const target = await until(() => fetch(`http://127.0.0.1:${DPORT}/json/list`).then(r => r.json()).then(l => l.find(t => t.type === 'page')), 15000, 'browser');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const cdp = new CDP(ws);
  cdp.on(m => {
    if (m.method === 'Runtime.exceptionThrown') errors.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) errors.push(`console.${m.params.type}: ` + m.params.args.map(a => a.value ?? a.description).join(' '));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push('log: ' + m.params.entry.text + (m.params.entry.url ? ' ' + m.params.entry.url : ''));
  });
  await cdp.send('Runtime.enable'); await cdp.send('Log.enable'); await cdp.send('Page.enable'); await cdp.send('DOM.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/#structure` });
  await until(() => cdp.eval('return !!(window.GHD && GHD.Shell && GHD.LedTab)'), 20000, 'page start');

  // helpers inside the page: canvas hash, text, captured downloads
  await cdp.eval(`
    window.__t = s => { const e = document.querySelector(s); return e ? e.textContent.replace(/\\s+/g, ' ').trim() : null; };
    window.__hash = async data => { const b = typeof data === 'string' ? new TextEncoder().encode(data) : data;
      const d = await crypto.subtle.digest('SHA-256', b); return [...new Uint8Array(d)].slice(0, 8).map(v => v.toString(16).padStart(2, '0')).join(''); };
    window.__canvas = s => __hash(document.querySelector(s).toDataURL());
    window.__blobs = []; const o = URL.createObjectURL; URL.createObjectURL = b => { __blobs.push(b); return o.call(URL, b); };
    window.__ready = () => GHD.LedTab.ready();`);
  const T = s => cdp.eval(`return __t(${JSON.stringify(s)})`);
  const show = async tab => { await cdp.eval(`GHD.Shell.show('${tab}')`); await sleep(300); };
  const lightReady = what => until(() => cdp.eval('return __ready()'), 180000, 'light: ' + what);
  const ledSnap = async prefix => {
    for (const s of ['#vPpfd', '#sPpfd', '#vU', '#sU', '#vDli', '#vLost', '#sLost', '#cmpTable tbody', '#ledWarn', '#ledGh', '#powerLine', '#ledSpecs', '#posNote', '#ledHo', '#sumLeds'])
      snap[`${prefix} ${s}`] = await T(s);
    for (const s of ['#secCanvas', '#mapCanvas', '#ledPolar', '#legBar']) snap[`${prefix} canvas ${s}`] = await cdp.eval(`return __canvas('${s}')`);
  };

  console.log('Tabs');
  await show('structure');
  check((await T('#sumStructure')).length > 0, 'Structure tab opens, summary filled');
  snap['structure #sSum'] = await T('#sSum'); snap['structure #sChecks'] = await T('#sChecks'); snap['structure #sTable'] = await T('#sTable');
  await show('voltiris');
  check((await T('#sumVoltiris')).length > 0, 'Voltiris tab opens, summary filled');
  snap['voltiris #vTable'] = await T('#vTable'); snap['voltiris #vChecks'] = await T('#vChecks');
  await show('leds');
  await lightReady('first run');
  check(/µmol/.test(await T('#vPpfd')), `LEDs tab: light calculated (${await T('#vPpfd')})`);
  check(/up to date/i.test(await T('#status')), 'header status says up to date');
  await ledSnap('default');

  console.log('Pop-ups');
  for (const kind of ['ppfd', 'u', 'dli', 'lost', 'section', 'map', 'compare']) {
    await cdp.eval(`document.querySelector('[data-pop="${kind}"]').click()`);
    const title = await T('#popTitle'), body = await T('#popBody');
    snap[`pop ${kind}`] = title + ' | ' + body;
    check(title && body && !/still running/.test(body), `pop-up ${kind}: ${title}`);
  }
  for (const id of ['#chooseLed', '#beamInfo']) {
    await cdp.eval(`document.querySelector('${id}').click()`);
    snap[`pop ${id}`] = await T('#popTitle') + ' | ' + await T('#popBody');
    check((await T('#popTitle')).length > 0, `pop-up from ${id}: ${await T('#popTitle')}`);
  }
  snap['pop beam canvas'] = await cdp.eval(`return __canvas('#popPolar')`);
  await cdp.eval(`document.querySelector('#pop').close()`);

  console.log('Crop map');
  await cdp.eval(`const c = document.querySelector('#mapCanvas'), r = c.getBoundingClientRect();
    c.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + r.width * 0.3, clientY: r.top + r.height * 0.4 }));`);
  await until(async () => /LEDs that light it most/.test(await T('#popBody')), 10000, 'map probe');
  snap['probe'] = await T('#popBody');
  check(true, 'a click on the map shows the spot calculation');
  await cdp.eval(`document.querySelector('#pop').close()`);

  console.log('LED controls');
  await cdp.eval(`document.querySelector('[data-mount="below"]').click()`); await sleep(200); await lightReady('below');
  await ledSnap('below');
  check(snap['below #vPpfd'] !== snap['default #vPpfd'] || snap['below #vLost'] !== snap['default #vLost'], `below Voltiris: result changes (${snap['below #vPpfd']}, blocked ${snap['below #vLost']})`);
  await cdp.eval(`document.querySelector('[data-mount="truss"]').click()`); await sleep(200);
  await cdp.eval(`document.querySelector('#perBaySeg [data-n="3"]') && document.querySelector('#perBaySeg [data-n="3"]').click()`); await sleep(200); await lightReady('3 per bay');
  await ledSnap('n3');
  await cdp.eval(`document.querySelector('#perBaySeg [data-n="2"]').click()`); await sleep(200);
  await cdp.eval(`document.querySelector('#posSeg [data-pos="manual"]').click()`); await sleep(200);
  check(await cdp.eval(`return !document.querySelector('#posFields').hidden && document.querySelectorAll('#posFields input').length === 2`), 'manual positions: one field per LED');
  await cdp.eval(`const i = document.querySelector('#posFields input'); i.value = '1.2'; i.dispatchEvent(new Event('change', { bubbles: true }));`); await sleep(200); await lightReady('manual');
  snap['manual #posNote'] = await T('#posNote'); snap['manual #vPpfd'] = await T('#vPpfd');
  check(await cdp.eval('return GHD.Model.S.led.xs[0] === 1.2'), 'manual position stored');
  await cdp.eval(`document.querySelector('#posSeg [data-pos="even"]').click()`);
  await until(async () => /^Most even positions/.test(await T('#posNote')), 240000, 'most even positions');
  check(true, `most even positions found: ${await T('#posNote')}`);
  snap['even #posNote'] = await T('#posNote');
  await lightReady('even'); snap['even #vU'] = await T('#vU');
  await cdp.eval(`document.querySelector('#posSeg [data-pos="centred"]').click()`); await sleep(200);
  await cdp.eval(`const s = document.querySelector('#ledDim'); s.value = '80'; s.dispatchEvent(new Event('input', { bubbles: true }));`); await sleep(200); await lightReady('dim 80');
  snap['dim80 #vPpfd'] = await T('#vPpfd');
  await cdp.eval(`const s = document.querySelector('#ledDim'); s.value = '100'; s.dispatchEvent(new Event('input', { bubbles: true }));`); await sleep(200);
  for (const v of ['top', 'section', '3d']) await cdp.eval(`document.querySelector('#viewSeg [data-view="${v}"]').click()`);
  await lightReady('back to default');
  check(await T('#vPpfd') === snap['default #vPpfd'], 'back to the default settings gives the default result');

  console.log('Structure change reaches the other tabs');
  await show('structure');
  await cdp.eval(`const i = document.querySelector('#sL'); i.value = '9600'; i.dispatchEvent(new Event('input', { bubbles: true }));`);
  await sleep(200);
  check(/stale|not calculated/i.test(await T('#status')), 'LED light marked stale while its tab is closed');
  await show('voltiris');
  snap['L9600 #vTable'] = await T('#vTable');
  await show('leds'); await lightReady('L 9600');
  check(/9\.60 m/.test(await T('#ledGh')), `LEDs tab sees the new chapel width: ${await T('#ledGh')}`);
  await ledSnap('L9600');
  check(snap['L9600 #vPpfd'] !== snap['default #vPpfd'], `light follows the structure (${snap['default #vPpfd']} -> ${snap['L9600 #vPpfd']})`);
  await show('structure');
  await cdp.eval(`const i = document.querySelector('#sL'); i.value = '8530'; i.dispatchEvent(new Event('input', { bubbles: true }));`);

  console.log('PDF report');
  await show('voltiris');   // the report must start the light itself when the LEDs tab is closed
  await cdp.eval(`__blobs.length = 0; document.querySelector('#pdfBtn').click();`);
  await until(async () => /^Saved .*\.pdf/.test(await T('#reportNote')), 240000, 'PDF');
  const pdf = await cdp.eval(`const b = __blobs.find(b => b.type === 'application/pdf'); const t = new Uint8Array(await b.arrayBuffer());
    const s = new TextDecoder('latin1').decode(t);
    const stripped = s.replace(/\\/CreationDate \\(D:[^)]*\\)/g, '').replace(/\\/ID \\[[^\\]]*\\]/g, '');
    return { size: t.length, pages: (s.match(/\\/Type \\/Page[^s]/g) || []).length, hash: await __hash(new TextEncoder().encode(stripped)) };`);
  check(pdf.pages >= 4, `PDF made: ${pdf.pages} pages, ${Math.round(pdf.size / 1024)} kB`);
  snap['pdf pages'] = pdf.pages; snap['pdf hash'] = pdf.hash;

  console.log('Save and open a design');
  await cdp.eval(`__blobs.length = 0; document.querySelector('#saveBtn').click();`);
  await until(async () => /^Saved .*\.json/.test(await T('#reportNote')), 5000, 'save design');
  const saved = await cdp.eval(`return await __blobs.find(b => b.type === 'application/json').text();`);
  const before = await cdp.eval(`return JSON.stringify([GHD.Model.S.structure, GHD.Model.S.led, GHD.Model.S.volt])`);
  const file = path.join(profile, 'design.json'); fs.writeFileSync(file, saved);
  await cdp.eval(`GHD.Model.set('structure', { L: 9100 }); GHD.Model.set('led', { n: 4 });`);
  const { root } = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#openFile' });
  await cdp.send('DOM.setFileInputFiles', { nodeId, files: [file] });
  await until(async () => /^Opened design\.json/.test(await T('#reportNote')), 5000, 'open design');
  check(await cdp.eval(`return JSON.stringify([GHD.Model.S.structure, GHD.Model.S.led, GHD.Model.S.volt])`) === before, 'the opened design equals the saved one');
  check(await cdp.eval(`return document.querySelector('#sL').value`) === '8530', 'Structure fields show the opened design');

  console.log('Console');
  check(!errors.length, errors.length ? `${errors.length} console errors:\n        ` + errors.join('\n        ') : 'no console errors or warnings');
  ws.close();
}

try { await main(); }
catch (e) { bad(e.message); if (errors.length) console.log('        console: ' + errors.join('\n        ')); }
finally { chrome.kill(); server.kill(); await sleep(300); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* in use */ } }

if (SAVE) { fs.writeFileSync(SAVE, JSON.stringify(snap, null, 1)); console.log(`Snapshot saved to ${SAVE} (${Object.keys(snap).length} values)`); }
if (COMPARE) {
  const base = JSON.parse(fs.readFileSync(COMPARE, 'utf8')), keys = new Set([...Object.keys(base), ...Object.keys(snap)]);
  const diff = [...keys].filter(k => JSON.stringify(base[k]) !== JSON.stringify(snap[k]));
  console.log(`Compared with ${COMPARE}: ${keys.size - diff.length} of ${keys.size} values identical`);
  for (const k of diff) { failed++; console.log(`  DIFF  ${k}\n        was: ${String(base[k]).slice(0, 300)}\n        now: ${String(snap[k]).slice(0, 300)}`); }
}
console.log(failed ? `\n${failed} problem(s)` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
