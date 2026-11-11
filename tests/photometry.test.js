// Beam shapes and photometric files (js/leds/photometry.js).
'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { load } = require('./load');

const GHD = load(['js/leds/photometry.js']);
const { cosnN, beamDist, parseIES, parseLDT, ramp, LO, HI } = GHD.LedPhoto;
const E = global.LedEngine;

test('a datasheet beam angle gives a curve at half its peak at half the angle', () => {
  for (const angle of [90, 120, 150]) {
    const d = beamDist({ angle });
    assert.ok(Math.abs(E.intensity(d, angle / 2, 0) - 0.5) < 0.01, `${angle}°`);
    assert.equal(E.intensity(d, 0, 0), 1);
    assert.ok(Math.abs(Math.pow(Math.cos(angle / 4 * Math.PI / 180), cosnN(angle)) - E.intensity(d, angle / 4, 0)) < 0.01);
  }
  assert.equal(beamDist({ angle: 120 }), beamDist({ angle: 120 }), 'cached');
});

test('a measured curve comes from curves.json', () => {
  assert.equal(beamDist({ curve: 'tlf20' }), GHD.DATA.curves.tlf20);
  const dist = { sym: true, I: [] };
  assert.equal(beamDist({ dist }), dist, 'a loaded file is used as it is');
});

const IES = `IESNA:LM-63-2002
[TEST] synthetic
TILT=NONE
1 1000 1 3 1 1 2 0.1 0.1 0.1
1 1 100
0 45 90
0
200 140 0
`;
test('IES file: type C, one plane, normalised to the peak', () => {
  const d = parseIES(IES);
  assert.equal(E.intensity(d, 0, 0), 1);
  assert.ok(Math.abs(E.intensity(d, 45, 77) - 0.7) < 1e-6, 'one plane: the same in every direction around');
  assert.ok(Math.abs(E.intensity(d, 22.5, 0) - 0.85) < 1e-6);
  assert.ok(Math.abs(E.intensity(d, 90, 0)) < 1e-6);
  assert.throws(() => parseIES('no tilt here'), /no TILT line/);
});

// EULUMDAT: 26 header lines, 6 lines per lamp set, 10 direct ratios, then C angles, gamma angles and values
const LDT = ['Test', '1', '1', '1', '0', '3', '45', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '1',
  '1', 'LED', '1000', '', '', '10', ...Array(10).fill('0.5'), '0', '0', '45', '90', '50', '25', '0'].join('\n');
test('LDT file: rotationally symmetric, normalised to the peak', () => {
  const d = parseLDT(LDT);
  assert.equal(E.intensity(d, 0, 200), 1);
  assert.ok(Math.abs(E.intensity(d, 45, 10) - 0.5) < 1e-6);
  assert.throws(() => parseLDT('x\n1\n1\n0'), /EULUMDAT/);
});

test('colour ramp: clamped to its ends, deep blue to pale yellow', () => {
  assert.deepEqual(ramp(0), ramp(LO));
  assert.deepEqual(ramp(5), ramp(HI));
  assert.ok(ramp(LO)[2] > ramp(LO)[0], 'blue at the low end');
  assert.ok(ramp(HI)[0] > 200 && ramp(HI)[1] > 200, 'pale yellow at the high end');
});
