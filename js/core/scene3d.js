/* 3D greenhouse shared by the Structure, Voltiris and LEDs tabs.
   viewer() sets up three.js in a box (left drag pans, right drag turns, wheel zooms; one finger turns, two zoom and pan).
   addGreenhouse() draws the structure from the Structure tab (pillars, real truss members, gutter and culture lines,
   I attachments, bracket) and, when asked, the Voltiris installation (line parts, parts at the I, modules).
   Frame: metres, x across the chapels from the outer face of the left pillar, y along the greenhouse, z up from the floor. */
(function () {
  'use strict';
  const GHD = window.GHD;
  const { css } = GHD.util;
  const D2R = Math.PI / 180;

  function b64arr(str, Type) { const bin = atob(str); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Type(u.buffer); }
  let meshGeos = null;   // Voltiris module meshes, shared by every viewer
  function moduleGeos() {
    if (meshGeos) return meshGeos;
    meshGeos = {};
    for (const [name, p] of Object.entries(GHD.DATA.mesh.parts)) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(b64arr(p.v, Float32Array), 3));
      g.setIndex(new THREE.BufferAttribute(b64arr(p.f, Uint32Array), 1));
      g.computeVertexNormals(); meshGeos[name] = { g, moving: p.moving };
    }
    return meshGeos;
  }

  function materials() {
    const M = o => new THREE.MeshStandardMaterial(o);
    return {
      lamellas: M({ color: 0x8fbaf5, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false, roughness: 0.3 }),
      frame: M({ color: 0x3a4757, roughness: 0.6 }), pv_arm: M({ color: 0x3a4757, roughness: 0.6 }), pv_reel: M({ color: 0x1f2a44, roughness: 0.4 }), tracker: M({ color: 0x55606e, roughness: 0.6 }),
      truss: M({ color: 0x9aa7b8, metalness: 0.2, roughness: 0.7 }), pillar: M({ color: 0x7d8ba0, metalness: 0.2, roughness: 0.7 }),
      steel: M({ color: 0x6b7787, roughness: 0.6 }), opt: M({ color: 0x2b2f36, roughness: 0.5 }),
      iPart: M({ color: 0x00a88a, roughness: 0.5 }), iWarn: M({ color: 0xd0603a, roughness: 0.5 }), ubolt: M({ color: 0x40598a, metalness: 0.6, roughness: 0.35 }),
      bracket: M({ color: 0x00745f, roughness: 0.5 }), gutterLine: M({ color: 0x40598a, roughness: 0.6 }), culture: M({ color: 0x00a88a, roughness: 0.6 }),
      led: M({ color: 0xe8590c, emissive: 0xff7a1a, emissiveIntensity: 0.6 }), roof: M({ color: 0xc4ccd8, roughness: 0.8 }), floor: M({ color: 0xc9d2dc, roughness: 1 }),
      edge: new THREE.LineBasicMaterial({ color: 0x33445c, transparent: true, opacity: 0.55 }),
    };
  }

  function viewer(host) {
    if (!window.THREE || !THREE.OrbitControls) throw new Error('three.js did not load');
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(42, 1, 0.05, 400);
    camera.up.set(0, 0, 1);
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.12; controls.screenSpacePanning = true;
    controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.85));
    const sun = new THREE.DirectionalLight(0xffffff, 0.55); sun.position.set(-6, -10, 14); scene.add(sun);
    const v = { renderer, scene, camera, controls, mats: materials(), groups: {}, visible: true, host };
    const resize = () => { const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px'; camera.aspect = w / h; camera.updateProjectionMatrix(); };
    new ResizeObserver(resize).observe(host); resize();
    try { new IntersectionObserver(es => { v.visible = es[0].isIntersecting; }).observe(host); } catch (e) { /* always draw */ }
    const loop = () => { if (v.visible && host.offsetParent !== null) { controls.update(); renderer.setClearColor(css('--view-bg') || '#EEF3FA'); renderer.render(scene, camera); } requestAnimationFrame(loop); };
    loop();
    v.drop = k => {
      const g = v.groups[k]; if (!g) return;
      scene.remove(g);
      g.traverse(o => { if (o.geometry && !o.userData.shared) o.geometry.dispose(); if (o.material && o.userData.ownMat) o.material.dispose(); });
      delete v.groups[k];
    };
    v.group = k => { v.drop(k); const g = new THREE.Group(); scene.add(g); v.groups[k] = g; return g; };
    v.look = (pos, target) => { camera.position.set(...pos); controls.target.set(...target); controls.update(); };
    // image of the current view for the PDF report
    v.snapshot = (w, h) => {
      const ow = host.clientWidth, oh = host.clientHeight;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
      renderer.setClearColor('#EEF3FA'); renderer.render(scene, camera);
      const url = renderer.domElement.toDataURL('image/png');
      renderer.setSize(ow, oh, false); camera.aspect = ow / oh; camera.updateProjectionMatrix();
      return url;
    };
    return v;
  }

  const box = (sx, sy, sz, m) => new THREE.Mesh(new THREE.BoxGeometry(Math.max(sx, 1e-3), Math.max(sy, 1e-3), Math.max(sz, 1e-3)), m);
  function instanced(geo, mat, mats4) {
    const im = new THREE.InstancedMesh(geo, mat, mats4.length);
    mats4.forEach((m, i) => im.setMatrixAt(i, m)); im.instanceMatrix.needsUpdate = true; return im;
  }
  const at = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);

  // o: { chapels: [i0, i1) , trusses: [j0, j1] (inclusive), voltiris: bool, pose: {el, az}, roof, floor }
  function addGreenhouse(v, o) {
    const T = THREE, M = GHD.Model, gh = M.greenhouse(), g = gh.geom, p = M.S.structure, mats = v.mats, KIT = GHD.DATA.kit;
    const W = gh.W, L = gh.L, tb = gh.tb, top = gh.top, zW = gh.zW, pw = gh.pw;
    const [i0, i1] = o.chapels, [j0, j1] = o.trusses;
    const ys = []; for (let j = j0; j <= j1; j++) ys.push(j * L);
    const yA = j0 * L - (j1 > j0 ? 0 : 1.2), yB = j1 * L + (j1 > j0 ? 0 : 1.2), yC = (yA + yB) / 2, yLen = yB - yA;
    const PZ = gh.pivot;
    const grp = v.group('greenhouse');

    if (o.floor !== false) {
      const fl = new T.Mesh(new T.PlaneGeometry((i1 - i0) * W + 2, yLen + 2), mats.floor);
      fl.position.set((i0 + i1) / 2 * W, yC, 0); grp.add(fl);
    }
    // truss: the members of the Structure tab, extruded to the structure thickness
    const shapes = g.members.map(m => new T.Shape(m.pts.map(([x, y]) => new T.Vector2(x / 1000, tb + y / 1000))));
    const tg = new T.ExtrudeGeometry(shapes, { depth: zW, bevelEnabled: false });
    tg.rotateX(Math.PI / 2); tg.translate(0, zW / 2, 0);
    const tm = []; for (let i = i0; i < i1; i++) for (const y of ys) tm.push(at(i * W, y, 0));
    grp.add(instanced(tg, mats.truss, tm));
    const eg = new T.EdgesGeometry(tg, 25);
    tm.forEach((m, k) => { const e = new T.LineSegments(eg, mats.edge); e.applyMatrix4(m); e.userData.shared = k > 0; grp.add(e); });
    // pillars up to the truss top, at every truss
    const pm = []; for (let i = i0; i <= i1; i++) for (const y of ys) pm.push(at(i * W + pw / 2, y, top / 2));
    grp.add(instanced(new T.BoxGeometry(pw, zW, top), mats.pillar, pm));
    if (o.roof !== false) for (let i = i0; i <= i1; i++) { const r = box(0.25, yLen, 0.12, mats.roof); r.position.set(i * W + pw / 2, yC, top + 0.12); grp.add(r); }

    // gutter lines hang to the gutter; culture lines are drawn 0.35 m long (their length is not set yet)
    for (let i = i0; i < i1; i++) {
      for (const gx of gh.gutters) {
        const X = i * W + gx;
        for (const y of ys) { const h = box(0.006, 0.006, tb - gh.gutterZ, mats.gutterLine); h.position.set(X, y, (tb + gh.gutterZ) / 2); grp.add(h); }
        const b = box(0.11, yLen, 0.06, mats.gutterLine); b.position.set(X, yC, gh.gutterZ - 0.03); grp.add(b);
      }
      for (const cx of gh.cultures) {
        const X = i * W + cx, cz = tb - 0.35;
        for (const y of ys) { const h = box(0.004, 0.004, 0.35, mats.culture); h.position.set(X, y, tb - 0.175); grp.add(h); }
        const c = new T.Mesh(new T.CylinderGeometry(0.008, 0.008, yLen, 8), mats.culture); c.position.set(X, yC, cz); grp.add(c);
      }
    }

    // I attachments: plate under the lower beam, two U-bolts over it, the I bar down to the Voltiris cross profile
    const iPart = KIT.at_I.find(q => q.name === 'i_structure');
    const iz0 = gh.iBottom, half = p.plate / 2000, ub = (p.plate / 2 - p.ubIn) / 1000, rr = Math.max(p.rod / 2000, 0.002), tc = p.tc / 1000;
    const plateM = [], plateW = [], barM = [], barW = [], ubM = [];
    for (let i = i0; i < i1; i++) for (const I of g.Is) for (const y of ys) {
      const X = i * W + I.x / 1000;
      (I.clash ? plateW : plateM).push(at(X, y, tb - 0.002));
      (I.clash ? barW : barM).push(at(X, y, (iz0 + tb - 0.004) / 2));
      ubM.push(at(X - ub, y, 0), at(X + ub, y, 0));
    }
    const plateG = new T.BoxGeometry(half * 2, zW + 0.06, 0.004), barG = new T.BoxGeometry(iPart.x[1] - iPart.x[0], iPart.y[1] - iPart.y[0], tb - 0.004 - iz0);
    if (plateM.length) grp.add(instanced(plateG, mats.iPart, plateM));
    if (plateW.length) grp.add(instanced(plateG.clone(), mats.iWarn, plateW));
    if (barM.length) grp.add(instanced(barG, mats.iPart, barM));
    if (barW.length) grp.add(instanced(barG.clone(), mats.iWarn, barW));
    if (ubM.length) {
      const a = zW / 2 + rr, rb = Math.min(a * 0.6, 0.012), yt = tb + tc + rr, z0 = tb - 0.018, V = (yy, zz) => new T.Vector3(0, yy, zz), path = new T.CurvePath();
      path.add(new T.LineCurve3(V(-a, z0), V(-a, yt - rb)));
      path.add(new T.QuadraticBezierCurve3(V(-a, yt - rb), V(-a, yt), V(-a + rb, yt)));
      path.add(new T.LineCurve3(V(-a + rb, yt), V(a - rb, yt)));
      path.add(new T.QuadraticBezierCurve3(V(a - rb, yt), V(a, yt), V(a, yt - rb)));
      path.add(new T.LineCurve3(V(a, yt - rb), V(a, z0)));
      grp.add(instanced(new T.TubeGeometry(path, 40, rr, 6, false), mats.ubolt, ubM));
    }
    // bracket line: the same bar as an I (as in the light engine), held by an arm from the pillar face
    if (g.xb != null) {
      const left = p.brkSide === 'left', xb = g.xb / 1000, face = left ? pw : W, za = iz0 + 0.03;
      for (let i = i0; i < i1; i++) for (const y of ys) {
        const bar = new T.Mesh(barG, mats.bracket); bar.userData.shared = true; bar.position.set(i * W + xb, y, (iz0 + tb - 0.004) / 2); grp.add(bar);
        const x0 = i * W + Math.min(xb, face), x1 = i * W + Math.max(xb, face);
        const a = box(x1 - x0 + 0.03, 0.06, 0.06, mats.bracket); a.position.set((x0 + x1) / 2, y, za); grp.add(a);
        const s = box(0.06, 0.06, 0.25, mats.bracket); s.position.set(i * W + face + (left ? 0.03 : -0.03), y, za + 0.125); grp.add(s);
      }
    }

    // Voltiris installation on the module lines
    if (o.voltiris) {
      const pat = M.patterns(L), lines = gh.lines, q0 = new T.Quaternion(), one = new T.Vector3(1, 1, 1);
      const pose = o.pose || M.pose(), q = new T.Quaternion().setFromEuler(new T.Euler(pose.el * D2R, 0, pose.az * D2R, 'ZYX'));
      for (let i = i0; i < i1; i++) lines.forEach(ln => {
        const X = i * W + ln.x;
        for (const part of KIT.line) { const b = box(part.x[1] - part.x[0], yLen, part.z[1] - part.z[0], mats.steel); b.position.set(X + (part.x[0] + part.x[1]) / 2, yC, PZ + (part.z[0] + part.z[1]) / 2); grp.add(b); }
        for (const y of ys) for (const part of KIT.at_I) {
          if (part.name === 'i_structure') continue;   // drawn above with the structure
          const z0 = PZ + part.z[0], z1 = PZ + part.z[1];
          const b = box(part.x[1] - part.x[0], part.y[1] - part.y[0], z1 - z0, part.layer === 'optimizers' ? mats.opt : mats.steel);
          b.position.set(X + (part.x[0] + part.x[1]) / 2, y + (part.y[0] + part.y[1]) / 2, (z0 + z1) / 2); grp.add(b);
        }
      });
      const pos = [];
      for (let i = i0; i < i1; i++) lines.forEach((ln, k) => { for (let j = j0; j < j1; j++) pat[M.patternOf(i, k, lines.length)].forEach(y => pos.push([i * W + ln.x, j * L + y])); });
      if (pos.length) {
        const mtx = new T.Matrix4();
        for (const [name, gg] of Object.entries(moduleGeos())) {
          const im = new T.InstancedMesh(gg.g, mats[name], pos.length); im.userData.shared = true;
          pos.forEach((pp, n) => { mtx.compose(new T.Vector3(pp[0], pp[1], PZ), gg.moving ? q : q0, one); im.setMatrixAt(n, mtx); });
          im.instanceMatrix.needsUpdate = true; grp.add(im);
        }
      }
    }
    return { gh, PZ, yC, yLen };
  }

  GHD.Scene3D = { viewer, addGreenhouse };
})();
