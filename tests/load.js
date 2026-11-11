// Loads the browser scripts into Node for the unit tests: a fresh window.GHD with the data files and an in-memory localStorage.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const readJSON = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

function memoryStorage(init) {
  const m = new Map(Object.entries(init || {}));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), map: m };
}

// files: paths from the project root, loaded in this order (as js/main.js does)
function load(files, opts) {
  opts = opts || {};
  global.window = global;
  global.localStorage = opts.storage || memoryStorage();
  global.GHD = {
    DATA: { kit: readJSON('data/kit.json'), curves: readJSON('data/curves.json') },
    LIB: readJSON('data/led-library.json'),
  };
  global.LedEngine = require(path.join(ROOT, 'js/engine.js')).LedEngine;
  for (const f of files) vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
  return global.GHD;
}

module.exports = { load, memoryStorage, readJSON, ROOT };
