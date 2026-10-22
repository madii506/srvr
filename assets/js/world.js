// srvr's world. Server blocks whose status lights are their eyes: green awake, amber asleep, dark off.
// The intro: two eyes in the dark. The camera pulls back from that one block, and keeps pulling back until the dark
// is full of floating islands, one server for every coin, their eyes waking in a wave like a city at night, linked by
// faint lines with data running along them. A slow drift over them all, then a swoop down to srvr's own island, which
// builds itself as you land. After that the page's scroll drives the camera:
//   hero → "how it works" (a new block drops in · fees pulse up the cables · players hop onto the roof · sellers vanish)
//   → pulled back and veiled behind the tools.
import * as THREE from '../vendor/three.module.min.js';
import { RoundedBoxGeometry } from '../vendor/RoundedBoxGeometry.js';

const G = 0x3ee08f, A = 0xffb547;
const cl = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const seg = (t, a, b) => cl((t - a) / (b - a));
const io = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const sine = t => 0.5 - 0.5 * Math.cos(Math.PI * t);
const sm = t => t * t * (3 - 2 * t);
const out3 = t => 1 - Math.pow(1 - t, 3);
const back = t => { const c1 = 1.6, c3 = c1 + 1; return t <= 0 ? 0 : 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const lerp = (a, b, t) => a + (b - a) * t;
function drop(t) { // falls, lands, settles: 0 → 1 (1 = resting)
  if (t <= 0) return 0; if (t >= 1) return 1;
  if (t < 0.55) { const u = t / 0.55; return u * u; }
  const u = (t - 0.55) / 0.45; return 1 - Math.sin(u * Math.PI) * 0.06 * (1 - u);
}
const impact = t => (t < 0.55 || t >= 1 ? 0 : (u => Math.sin(u * Math.PI) * (1 - u))((t - 0.55) / 0.45)); // squash after landing

// the intro's clock (seconds)
export const INTRO = 5.0;
const T_FLY = [0.45, 4.75], T_TEXT = 4.3;

export function mountWorld(canvas, opt = {}) {
  const reduced = !!opt.reduced;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  r.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 1.75));
  r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.NeutralToneMapping; r.toneMappingExposure = 1;
  r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0a0a0c);
  scene.fog = new THREE.Fog(0x0a0a0c, 18, 70);

  // a studio for reflections: soft boxes around a dark room, so the rounded edges catch real highlights
  { const env = new THREE.Scene(); env.background = new THREE.Color(0x15161a);
    const soft = (w, h, x, y, z, i) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(i, i, i), side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m); };
    soft(8, 4, -4, 7, 5, 3.2); soft(4, 6, 7, 2, 2, 1.4); soft(10, 2, 0, -2, -8, 0.8);
    const pm = new THREE.PMREMGenerator(r); scene.environment = pm.fromScene(env, 0.035).texture; pm.dispose(); }
  const hemi = new THREE.HemisphereLight(0xffffff, 0x101114, 0.5);
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(-4, 8, 6); key.castShadow = true;
  key.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048); key.shadow.radius = 8; key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
  Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 0.5, far: 30 });
  const rim = new THREE.DirectionalLight(0xcfe0ff, 1.1); rim.position.set(5, 4, -7);
  scene.add(hemi, key, key.target, rim);
  const LIGHT = { hemi: 0.5, key: 2.2, rim: 1.1 };

  const shell = new THREE.MeshStandardMaterial({ color: 0xeef0f3, roughness: 0.42, metalness: 0, envMapIntensity: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.6 });
  const glow = c => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 2.6, roughness: 0.25 });
  const box = (w, h, d, m, x, y, z, parent, cast = true) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = cast; b.receiveShadow = true; parent.add(b); return b; };
  const shellGeo = new RoundedBoxGeometry(1, 1, 1, 6, 0.09);
  const ringGeo = new THREE.RingGeometry(0.62, 0.7, 48);

  // one srvr block: a white server with a face. It keeps all three faces and shows the one that matches its state.
  const blocks = [];
  function block(s, state, x, y, z, ry) {
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; g.scale.setScalar(s); scene.add(g);
    const m = new THREE.Mesh(shellGeo, shell); m.castShadow = true; m.receiveShadow = true; g.add(m);
    const eyes = new THREE.Group(); g.add(eyes);
    const awakeM = glow(G), sleepM = glow(A);
    const awake = new THREE.Group(), asleep = new THREE.Group(), off = new THREE.Group(); eyes.add(awake, asleep, off);
    for (const sx of [-0.15, 0.15]) {
      box(0.12, 0.2, 0.02, awakeM, sx, 0.1, 0.505, awake, false);
      box(0.14, 0.035, 0.02, sleepM, sx, 0.06, 0.505, asleep, false);
      box(0.12, 0.2, 0.012, dark, sx, 0.1, 0.502, off, false);
    }
    box(0.42, 0.03, 0.015, dark, 0, -0.2, 0.503, g, false);
    for (let i = 0; i < 7; i++) box(0.015, 0.46, 0.012, dark, 0.503, -0.02, -0.27 + i * 0.09, g, false).rotation.y = Math.PI / 2;
    const ringM = new THREE.MeshBasicMaterial({ color: 0xdfe3e8, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringM); ring.rotation.x = -Math.PI / 2; ring.position.set(x, y - s * 0.5, z); ring.visible = false; scene.add(ring);
    awake.visible = state === 'on'; asleep.visible = state === 'sleep'; off.visible = state === 'off';
    const b = { g, m, eyes, awake, asleep, off, awakeM, sleepM, ring, ringM, state, base: { x, y, z, s, ry }, phase: Math.random() * 6.28, blinkAt: 1 + Math.random() * 4, blink: 0, hop: 0, hopV: 0, wake: 0, land: 0, delay: 0, sq: 0 };
    m.userData.block = b; blocks.push(b); return b;
  }
  function person(parent, x, z, ry) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; parent.add(g);
    const body = new THREE.MeshStandardMaterial({ color: 0x24272c, roughness: 0.6 }), head = new THREE.MeshStandardMaterial({ color: 0xf2f3f5, roughness: 0.5 });
    box(0.045, 0.09, 0.045, body, -0.028, 0.045, 0, g); box(0.045, 0.09, 0.045, body, 0.028, 0.045, 0, g);
    box(0.11, 0.12, 0.065, body, 0, 0.15, 0, g); box(0.092, 0.092, 0.092, head, 0, 0.26, 0, g);
    return g;
  }
  // a little world on the hero block's roof: a cabin with a lit window, two trees, three people. Each piece pops in.
  const pieces = [], guests = [];
  function world(top) {
    const w = new THREE.Group(); w.position.y = 0.5; top.add(w);
    const wall = new THREE.MeshStandardMaterial({ color: 0xdfe2e7, roughness: 0.5 }), roof = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.55 });
    const leaf = new THREE.MeshStandardMaterial({ color: 0x2fbf77, roughness: 0.65 }), leaf2 = new THREE.MeshStandardMaterial({ color: 0x27a465, roughness: 0.65 }), bark = new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.7 });
    const piece = (x, z, list = pieces) => { const p = new THREE.Group(); p.position.set(x, 0, z); w.add(p); list.push(p); return p; };
    const cabin = piece(-0.2, -0.2);
    box(0.26, 0.17, 0.2, wall, 0, 0.085, 0, cabin); box(0.3, 0.05, 0.24, roof, 0, 0.195, 0, cabin);
    box(0.06, 0.06, 0.01, glow(A), 0.06, 0.09, 0.105, cabin, false); box(0.05, 0.1, 0.01, roof, -0.06, 0.05, 0.104, cabin, false);
    const tree = (x, z, h) => { const p = piece(x, z); box(0.035, h, 0.035, bark, 0, h / 2, 0, p); box(0.15, 0.13, 0.15, leaf, 0, h + 0.05, 0, p); box(0.09, 0.07, 0.09, leaf2, 0, h + 0.14, 0, p); };
    tree(0.25, -0.25, 0.11); tree(0.3, 0.05, 0.07);
    const folk = [];
    for (const [x, z, ry] of [[-0.02, 0.22, 0.4], [0.14, 0.3, -0.7], [-0.3, 0.18, 0.9]]) { const p = piece(x, z); folk.push(person(p, 0, 0, ry)); }
    for (const [x, z, ry] of [[0.33, 0.33, -0.3], [-0.36, 0.36, 0.6], [0.05, 0.05, 2.6], [0.36, -0.02, -1.4]]) { const p = piece(x, z, guests); folk.push(person(p, 0, 0, ry)); p.scale.setScalar(0.0001); }
    return folk;
  }

  // ---------------------------------------------------------------- srvr's island
  const CENTER = new THREE.Vector3(0.4, 0.12, -0.3);
  const AZ0 = Math.atan2(7.25, 9.4), EL0 = Math.asin(5.55 / Math.hypot(7.25, 5.55, 9.4));
  const hero = block(1.35, 'on', 0, -0.05, 0, -0.08);
  const folk = world(hero.g);
  const sats = [
    block(0.72, 'on', -1.55, -0.62, 0.55, 0.12),
    block(0.5, 'on', 1.1, 0.55, -1.2, 0.2),
    block(0.56, 'sleep', 2.0, -0.25, 0.6, -0.18),
    block(0.34, 'sleep', 2.35, 0.2, -0.4, 0.3),
    block(0.46, 'off', 2.6, 1.15, -2.0, -0.1),
    block(0.4, 'on', -1.25, 0.95, -1.7, 0.15),
    block(0.3, 'sleep', -2.35, 0.25, -0.35, 0.25),
  ];
  sats.forEach((b, i) => { b.delay = 3.15 + i * 0.1; });
  const fresh = block(0.62, 'on', -0.95, 0.15, 1.35, 0.3); fresh.g.visible = false;
  const cab = new THREE.MeshStandardMaterial({ color: 0x24272c, roughness: 0.75 }), cables = [], pulses = [];
  const pulseGeo = new THREE.SphereGeometry(0.035, 12, 8), pulseM = new THREE.MeshStandardMaterial({ color: G, emissive: G, emissiveIntensity: 3, roughness: 0.3 });
  for (const [x, z, dx] of [[-0.3, 0.2, -0.4], [0.25, -0.1, 0.35], [0.05, 0.35, 0.1]]) {
    const c = new THREE.CatmullRomCurve3([new THREE.Vector3(x, -0.85, z), new THREE.Vector3(x + dx * 0.3, -1.5, z), new THREE.Vector3(x + dx, -2.2, z + 0.15), new THREE.Vector3(x + dx * 1.3, -3.6, z + 0.2)]);
    const t = new THREE.Mesh(new THREE.TubeGeometry(c, 48, 0.028, 10), cab); scene.add(t); cables.push(t);
    for (let k = 0; k < 4; k++) { const m = new THREE.Mesh(pulseGeo, pulseM); m.userData = { c, u: k / 4 + Math.random() * 0.1 }; m.visible = false; scene.add(m); pulses.push(m); }
  }
  const NV = coarse ? 46 : 80, vox = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.7 }), NV);
  const voxG = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: G, emissive: G, emissiveIntensity: 1.4 }), 10);
  const VD = [], VG = [], dm = new THREE.Object3D();
  const spawn = () => { const a = Math.random() * 6.28, rr = 2.2 + Math.random() * 5; return { x: Math.cos(a) * rr, z: Math.sin(a) * rr - 1, y: -4 + Math.random() * 8, s: 0.025 + Math.random() * 0.05, v: 0.06 + Math.random() * 0.12, r: Math.random() * 6 }; };
  for (let i = 0; i < NV; i++) VD.push(spawn()); for (let i = 0; i < 10; i++) VG.push(spawn());
  scene.add(vox, voxG);
  function voxels(dt, vis) {
    for (const [arr, mesh] of [[VD, vox], [VG, voxG]]) {
      arr.forEach((p, i) => { p.y += p.v * dt; p.r += dt * 0.4; if (p.y > 4.5) { Object.assign(p, spawn()); p.y = -4.5; }
        dm.position.set(p.x, p.y, p.z); dm.rotation.set(p.r, p.r * 0.7, 0); dm.scale.setScalar(Math.max(0.0001, p.s * vis)); dm.updateMatrix(); mesh.setMatrixAt(i, dm.matrix); });
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  // ---------------------------------------------------------------- the archipelago: every coin's server, floating
  let seed = 9; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const heroDir = new THREE.Vector3(Math.sin(AZ0), 0, Math.cos(AZ0)), CAMZONE = CENTER.clone().addScaledVector(heroDir, 70).setY(30);
  const ISL = [];
  for (let tries = 0; ISL.length < 36 && tries < 4000; tries++) {
    const ang = rnd() * Math.PI * 2, rad = 15 + Math.pow(rnd(), 0.75) * 46, y = (rnd() - 0.5) * 16;
    const p = new THREE.Vector3(CENTER.x + Math.sin(ang) * rad, CENTER.y + y, CENTER.z + Math.cos(ang) * rad);
    const dh = new THREE.Vector3(p.x - CENTER.x, 0, p.z - CENTER.z).normalize();
    if (dh.dot(heroDir) > Math.cos(0.55)) continue;                       // keep the hero shot's line of sight clear
    if (dh.dot(new THREE.Vector3(-Math.sin(-0.08), 0, -Math.cos(-0.08))) > Math.cos(0.42)) continue;   // and the first close-up's background
    if (ISL.some(o => o.p.distanceTo(p) < 8)) continue;
    const q = rnd(), s = 1.3 + rnd() * 1.1, yaw = Math.atan2(CAMZONE.x - p.x, CAMZONE.z - p.z) + (rnd() - 0.5) * 0.9;
    const smalls = []; const ns = 2 + Math.floor(rnd() * 3);
    for (let k = 0; k < ns; k++) { const a2 = rnd() * Math.PI * 2, d2 = s * (1.0 + rnd() * 0.9); smalls.push({ o: new THREE.Vector3(Math.cos(a2) * d2, (rnd() - 0.6) * s, Math.sin(a2) * d2), s: s * (0.24 + rnd() * 0.26), ry: rnd() * 6 }); }
    ISL.push({ p, s, yaw, rad, state: q < 0.72 ? 'on' : q < 0.9 ? 'sleep' : 'off', tw: 0.85 + (rad - 15) / 46 * 1.5 + rnd() * 0.2, ph: rnd() * 6.28, smalls });
  }
  const NI = ISL.length, NS = ISL.reduce((n, o) => n + o.smalls.length, 0);
  const lowGeo = new RoundedBoxGeometry(1, 1, 1, 2, 0.09);
  const islM = new THREE.InstancedMesh(lowGeo, shell, NI + NS), islEye = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), NI * 2), islMouth = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), dark, NI);
  scene.add(islM, islEye, islMouth);
  const CG = new THREE.Color(0.32, 1.0, 0.62), CA = new THREE.Color(1.0, 0.68, 0.24), CD = new THREE.Color(0.06, 0.065, 0.075), tmpC = new THREE.Color(), tq = new THREE.Quaternion(), YUP = new THREE.Vector3(0, 1, 0), tv = new THREE.Vector3();
  { let k = NI; ISL.forEach(o => o.smalls.forEach(sm2 => { dm.position.copy(o.p).add(sm2.o); dm.rotation.set(0, sm2.ry, 0); dm.scale.setScalar(sm2.s); dm.updateMatrix(); islM.setMatrixAt(k++, dm.matrix); })); }
  // the network: each island linked to its two nearest, the near ones to srvr's island too; drawn as they wake
  const links = [];
  ISL.forEach((o, i) => {
    ISL.map((b, j) => [j, o.p.distanceTo(b.p)]).filter(x => x[0] !== i).sort((a, b) => a[1] - b[1]).slice(0, 2).forEach(([j]) => { if (!links.some(l => (l.a === i && l.b === j) || (l.a === j && l.b === i))) links.push({ a: i, b: j, t: Math.max(o.tw, ISL[j].tw) + 0.25 }); });
    if (o.rad < 30) links.push({ a: i, b: -1, t: o.tw + 0.15 });
  });
  links.sort((x, y) => x.t - y.t);
  const P = i => (i < 0 ? CENTER : ISL[i].p);
  const lp = new Float32Array(links.length * 6); links.forEach((l, k) => { lp.set([P(l.a).x, P(l.a).y, P(l.a).z, P(l.b).x, P(l.b).y, P(l.b).z], k * 6); });
  const lineGeo = new THREE.BufferGeometry(); lineGeo.setAttribute('position', new THREE.BufferAttribute(lp, 3));
  const lineM = new THREE.LineBasicMaterial({ color: G, transparent: true, opacity: 0.2, depthWrite: false });
  const lines = new THREE.LineSegments(lineGeo, lineM); lineGeo.setDrawRange(0, 0); scene.add(lines);
  // data running along the links
  const ND = 60, dp = new Float32Array(ND * 3), DT = Array.from({ length: ND }, () => ({ l: Math.floor(rnd() * links.length), u: rnd(), v: 0.18 + rnd() * 0.3, dir: rnd() < 0.5 ? 1 : -1 }));
  const dataGeo = new THREE.BufferGeometry(); dataGeo.setAttribute('position', new THREE.BufferAttribute(dp, 3));
  const data = new THREE.Points(dataGeo, new THREE.PointsMaterial({ color: G, size: 0.34, sizeAttenuation: true, transparent: true, opacity: 0.9, depthWrite: false })); scene.add(data);
  // stars, far behind everything
  { const n = coarse ? 700 : 1300, sp = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, rr = 150 + rnd() * 40, q2 = Math.sqrt(1 - u * u); sp.set([Math.cos(th) * q2 * rr, u * rr * 0.7, Math.sin(th) * q2 * rr], i * 3); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0x8e959d, size: 1.25, sizeAttenuation: false, transparent: true, opacity: 0.55, fog: false, depthWrite: false }))); }
  function archipelago(t, s, mx, my, dt) {
    for (let i = 0; i < NI; i++) {
      const o = ISL[i], k = seg(t, o.tw, o.tw + 0.35), bob = Math.sin(s * 0.6 + o.ph) * 0.18 * o.s;
      const sq = k > 0 && k < 1 ? Math.sin(k * Math.PI) * 0.1 : 0;
      dm.position.set(o.p.x, o.p.y + bob - sq * 0.3 * o.s, o.p.z); dm.rotation.set(0, o.yaw + Math.sin(s * 0.3 + o.ph) * 0.06, 0); dm.scale.set(o.s * (1 + sq * 0.5), o.s * (1 - sq), o.s * (1 + sq * 0.5)); dm.updateMatrix(); islM.setMatrixAt(i, dm.matrix);
      tq.setFromAxisAngle(YUP, dm.rotation.y);
      // its face: mouth, then eyes that wake in the wave and blink now and then
      tv.set(0, -0.2 * o.s, 0.507 * o.s).applyQuaternion(tq); dm.position.set(o.p.x + tv.x, o.p.y + bob + tv.y, o.p.z + tv.z); dm.scale.set(0.42 * o.s, 0.03 * o.s, 0.015 * o.s); dm.updateMatrix(); islMouth.setMatrixAt(i, dm.matrix);
      const blink = t > o.tw + 1 ? Math.max(0, Math.sin((s + o.ph * 3) * 0.7) - 0.985) * 60 : 0;
      const on = k > 0 && o.state !== 'off', sleep = o.state === 'sleep' && on;
      tmpC.copy(CD).lerp(o.state === 'sleep' ? CA : CG, on ? 0.2 + 0.8 * k : 0);
      for (let e = 0; e < 2; e++) {
        tv.set(((e ? 0.15 : -0.15) + mx * 0.03) * o.s, ((sleep ? 0.06 : 0.1) + my * 0.02) * o.s, 0.508 * o.s).applyQuaternion(tq);
        dm.position.set(o.p.x + tv.x, o.p.y + bob + tv.y, o.p.z + tv.z);
        dm.scale.set((sleep ? 0.14 : 0.12) * o.s, (sleep ? 0.035 : 0.2) * o.s * Math.max(0.08, 1 - 0.9 * Math.min(1, blink + (k > 0 && k < 1 ? Math.sin(k * Math.PI) : 0))), 0.02 * o.s); dm.updateMatrix();
        islEye.setMatrixAt(i * 2 + e, dm.matrix); islEye.setColorAt(i * 2 + e, tmpC);
      }
    }
    islM.instanceMatrix.needsUpdate = true; islMouth.instanceMatrix.needsUpdate = true; islEye.instanceMatrix.needsUpdate = true; islEye.instanceColor.needsUpdate = true;
    // links draw on as their islands wake; data runs along the drawn ones
    let n = 0; while (n < links.length && links[n].t <= t) n++;
    lineGeo.setDrawRange(0, n * 2);
    for (let i = 0; i < ND; i++) {
      const d = DT[i], l = links[d.l], vis = l.t + 0.3 <= t;
      d.u = (d.u + d.v * dt * d.dir + 1) % 1;
      if (!vis) { dp.set([0, -999, 0], i * 3); continue; }
      const a = P(l.a), b = P(l.b); dp.set([lerp(a.x, b.x, d.u), lerp(a.y, b.y, d.u), lerp(a.z, b.z, d.u)], i * 3);
    }
    dataGeo.attributes.position.needsUpdate = true;
  }

  // ---------------------------------------------------------------- camera: spherical keyframes around a target
  const cam = new THREE.PerspectiveCamera(22, 1, 0.1, 400);
  const K = {};
  const kf = (az, el, d, t, ox, oy, fov = 22) => ({ az, el, d, t: t.clone(), ox, oy, fov });
  const faceN = new THREE.Vector3(Math.sin(-0.08), 0, Math.cos(-0.08));
  const EYES = new THREE.Vector3(0, -0.05 + 0.1 * 1.35, 0).addScaledVector(faceN, 0.505 * 1.35);
  let W = 1, H = 1, wide = true;
  function frame() {
    W = innerWidth; H = innerHeight;
    r.setSize(W, H, false); cam.aspect = W / H; wide = cam.aspect > 1.05;
    const f = wide ? (cam.aspect > 2 ? 0.5 : 0.58) : 1.14, d = cl(17.2 / (f * cam.aspect), 15, 52), sd = wide ? 1 : 1.75;
    const OX = wide ? -0.2 : 0, OY = wide ? 0 : 0.2;
    K.start = kf(-0.08, 0.0, 5.2, EYES, 0, 0);
    K.far = kf(0.3, 0.62, wide ? 74 : 104, CENTER.clone().setY(-1.5), 0, 0, 40);
    K.far2 = kf(0.8, 0.5, wide ? 68 : 96, CENTER, 0, 0, 40);
    K.hero = kf(AZ0, EL0, d, CENTER, wide ? -0.205 : 0, wide ? -0.03 : 0.17);
    K.launch = kf(0.15, 0.32, 7.6 * sd, new THREE.Vector3(-0.35, 0.05, 0.5), OX, OY);
    K.rent = kf(0.95, 0.12, 9.8 * sd, new THREE.Vector3(0, -0.85, 0.1), OX, OY);
    K.join = kf(0.5, 0.88, 5.6 * sd, new THREE.Vector3(0, 0.78, 0), OX, OY);
    K.sell = kf(0.8, 0.42, 6.4 * sd, new THREE.Vector3(0.1, 0.55, 0), OX, OY);
    K.away = kf(0.95, 0.52, d * 1.12, CENTER, wide ? -0.3 : 0, wide ? 0.04 : 0.26);
    cam.updateProjectionMatrix();
  }
  frame();
  const C = { az: 0, el: 0, d: 0, t: new THREE.Vector3(), ox: 0, oy: 0, fov: 22 };
  // distance moves on a log scale, so pulling back from 5 to 90 feels like one steady glide
  function mix(a, b, u) { C.az = lerp(a.az, b.az, u); C.el = lerp(a.el, b.el, u); C.d = Math.exp(lerp(Math.log(a.d), Math.log(b.d), u)); C.t.lerpVectors(a.t, b.t, u); C.ox = lerp(a.ox, b.ox, u); C.oy = lerp(a.oy, b.oy, u); C.fov = lerp(a.fov, b.fov, u); }

  // ---------------------------------------------------------------- scroll state, set by the page
  const S = { heroP: 0, howF: 0, afterP: 0 };
  const SM = { heroP: 0, howF: 0, afterP: 0 };

  // ---------------------------------------------------------------- input: cursor look, hover, hop
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  let hovered = null;
  const shells = blocks.map(b => b.m);
  const busy = el => !!(el && el.closest && el.closest('a,button,input,select,textarea,label,summary,details,.form,.pcard,.board,.ownbox,.faq,dialog,.how-txt,.hero-in,#boot'));
  function pick(e) {
    ndc.set((e.clientX / W) * 2 - 1, -(e.clientY / H) * 2 + 1);
    mouse.tx = ndc.x; mouse.ty = ndc.y;
    if (busy(e.target) || SM.afterP > 0.5 || T < INTRO) return null;
    ray.setFromCamera(ndc, cam);
    const hit = ray.intersectObjects(shells, false)[0];
    return hit && hit.object.parent.visible ? hit.object.userData.block : null;
  }
  addEventListener('pointermove', e => {
    const b = pick(e); if (b !== hovered) { hovered = b; if (b) { b.hopV = Math.max(b.hopV, 2.2); b.wake = 1.6; } }
    document.documentElement.classList.toggle('over-block', !!b);
  }, { passive: true });
  addEventListener('pointerdown', e => { const b = pick(e); if (b) { b.hopV = 3.4; b.wake = 2.4; b.blink = 0; } });

  // ---------------------------------------------------------------- the clock (waits at the first frame until go())
  let T = reduced ? INTRO : 0, last = performance.now(), textCalled = false, doneCalled = false, running = true, paused = false, frameN = 0, waiting = !!opt.wait && !reduced;
  const skip = () => { if (!waiting && T < INTRO) T = INTRO - 0.001; };
  function go() {
    if (!waiting) return; waiting = false; last = performance.now();
    setTimeout(() => { for (const ev of ['keydown', 'wheel', 'touchstart', 'pointerdown']) addEventListener(ev, skip, { once: true, passive: true }); }, 900);
  }
  if (!opt.wait && !reduced) setTimeout(() => { for (const ev of ['keydown', 'wheel', 'touchstart', 'pointerdown']) addEventListener(ev, skip, { once: true, passive: true }); }, 300);

  const look = new THREE.Vector3();
  let fovNow = 22;
  function update(dt, now) {
    if (!waiting && T < INTRO + 1) T += dt;
    const t = T, s = now / 1000, inIntro = t < INTRO && !reduced;
    for (const k of ['heroP', 'howF', 'afterP']) SM[k] += (S[k] - SM[k]) * Math.min(1, dt * (reduced ? 60 : 5.5));
    const { heroP, howF, afterP } = SM;
    // light: eyes first, then the world comes up as you pull back
    const lit = reduced ? 1 : out3(seg(t, 0.35, 1.6));
    hemi.intensity = LIGHT.hemi * lit; key.intensity = LIGHT.key * lit; rim.intensity = LIGHT.rim * lit;
    shell.envMapIntensity = 0.9 * lit; scene.environmentIntensity = lit;
    mouse.x += (mouse.tx - mouse.x) * Math.min(1, dt * 3); mouse.y += (mouse.ty - mouse.y) * Math.min(1, dt * 3);
    // ---- the camera
    if (inIntro) {
      // one smooth flight: from the eyes out over every island and down onto srvr's, never stopping
      const w = seg(t, T_FLY[0], T_FLY[1]), u = io(w), h = Math.pow(Math.sin(Math.PI * sine(w)), 1.15);
      mix(K.start, K.hero, u);
      C.d *= Math.exp(h * Math.log(K.far.d / Math.exp(lerp(Math.log(K.start.d), Math.log(K.hero.d), 0.5))));
      C.el += h * 0.22; C.az += h * 0.35; C.fov += h * 16; C.t.y -= h * 1.4; C.ox *= u; C.oy *= u;
    } else if (afterP > 0.001) mix(K.sell, K.away, sm(afterP));
    else if (howF > 0.001) {
      const f = howF;
      if (f < 0.75) mix(K.launch, K.launch, 0);
      else if (f < 1.35) mix(K.launch, K.rent, sm(seg(f, 0.75, 1.35)));
      else if (f < 1.75) mix(K.rent, K.rent, 0);
      else if (f < 2.35) mix(K.rent, K.join, sm(seg(f, 1.75, 2.35)));
      else if (f < 2.75) mix(K.join, K.join, 0);
      else if (f < 3.35) mix(K.join, K.sell, sm(seg(f, 2.75, 3.35)));
      else mix(K.sell, K.sell, 0);
      C.az += Math.sin(f * Math.PI) * 0.04;
    } else mix(K.hero, K.launch, sm(heroP));
    const lk = coarse ? 0 : seg(t, INTRO - 0.2, INTRO + 0.8);
    const az = C.az + mouse.x * 0.05 * lk, el = C.el + mouse.y * 0.03 * lk;
    cam.position.set(C.t.x + C.d * Math.cos(el) * Math.sin(az), C.t.y + C.d * Math.sin(el), C.t.z + C.d * Math.cos(el) * Math.cos(az));
    look.copy(C.t);
    if (C.fov !== fovNow) { fovNow = C.fov; cam.fov = C.fov; }
    cam.lookAt(look);
    cam.setViewOffset(W, H, W * C.ox, H * C.oy, W, H);
    // the fog follows the camera out, so far islands fade but never vanish
    const cd = cam.position.distanceTo(CENTER); scene.fog.near = Math.max(18, cd * 0.85); scene.fog.far = Math.max(70, cd * 2.3);
    // ---- the archipelago
    archipelago(t, s, mouse.x, mouse.y, dt);
    lineM.opacity = lerp(0.12 + 0.12 * seg(t, 1.0, 2.2), 0.06, seg(t, 3.6, 4.8)) + 0.03 * Math.sin(s * 1.3);   // bright while you fly over them, faint behind the page
    // ---- srvr's island builds itself as you come back to it
    hero.awakeM.emissiveIntensity = 2.6;
    for (const b of sats) {
      const u = reduced ? 1 : seg(t, b.delay, b.delay + 0.75), y = drop(u);
      b.land = u >= 1 ? 1 : 0; b.g.visible = u > 0;
      b.g.position.y = b.base.y + (1 - y) * 7;
      b.sq = reduced ? 0 : impact(u);
      const on = reduced ? 1 : seg(t, b.delay + 0.7, b.delay + 0.95);
      b.awakeM.emissiveIntensity = 2.6 * on; b.sleepM.emissiveIntensity = 2.6 * on;
      const k = reduced ? 1 : seg(t, b.delay + 0.41, b.delay + 1.2);
      b.ring.visible = k > 0 && k < 1; b.ringM.opacity = 0.42 * (1 - k); b.ring.scale.setScalar(b.base.s * (0.7 + out3(k) * 1.5));
    }
    const u1 = afterP > 0 ? 1 : seg(howF, 0.15, 0.85);
    fresh.g.visible = u1 > 0; fresh.land = u1 > 0 ? 1 : 0;
    fresh.g.position.y = fresh.base.y + (1 - drop(u1)) * 6; fresh.sq = impact(u1);
    { const k = seg(u1, 0.55, 1); fresh.ring.visible = k > 0 && k < 1; fresh.ringM.opacity = 0.42 * (1 - k); fresh.ring.scale.setScalar(fresh.base.s * (0.7 + out3(k) * 1.5)); }
    const e2 = Math.min(sm(seg(howF, 1.05, 1.5)), 1 - 0.6 * sm(seg(howF, 1.95, 2.4)));
    const cg = reduced ? 1 : out3(seg(t, 3.6, 4.5));
    for (const c of cables) { const n = c.geometry.index.count; c.geometry.setDrawRange(0, Math.floor(n * cg / 6) * 6); c.visible = cg > 0; }
    pulseM.emissiveIntensity = 2 + e2 * 3;
    for (const p of pulses) {
      p.userData.u = (p.userData.u - dt * (0.1 + e2 * 0.42) + 1) % 1;
      const v = p.userData.u; p.userData.c.getPointAt(v, p.position);
      const vis = cg >= 1 ? (0.4 + e2 * 0.9) * sm(seg(v, 0, 0.12)) * sm(seg(1 - v, 0, 0.1)) : 0;
      p.visible = vis > 0.01; p.scale.setScalar(Math.max(0.001, vis));
    }
    pieces.forEach((p, i) => { const u = reduced ? 1 : back(seg(t, 3.85 + i * 0.06, 4.2 + i * 0.06)); p.scale.setScalar(Math.max(0.0001, u)); });
    guests.forEach((p, i) => {
      const inn = back(seg(howF, 2.05 + i * 0.12, 2.4 + i * 0.12)), gone = i % 2 === 0 ? sm(seg(howF, 3.05 + i * 0.1, 3.3 + i * 0.1)) : 0;
      const v = afterP > 0 ? (i % 2 === 0 ? 0 : 1) : inn * (1 - gone);
      p.scale.setScalar(Math.max(0.0001, v)); p.position.y = afterP > 0 ? 0 : gone * 0.25;
    });
    // ---- idle life: bob, blink, look, hop, wake, squash
    const idle = reduced ? 0 : seg(t, INTRO - 0.6, INTRO + 0.6);
    for (const b of blocks) {
      const isHero = b === hero;
      if (!isHero && !b.land && !reduced) continue;
      const bob = Math.sin(s * 0.9 + b.phase) * 0.035 * (b === fresh ? 1 : idle) * (isHero ? 0.6 : 1);
      b.hopV -= dt * 14; b.hop = Math.max(0, b.hop + b.hopV * dt * 0.12); if (b.hop === 0 && b.hopV < 0) b.hopV = 0;
      b.g.position.y = (isHero ? b.base.y : b.g.position.y) + bob + b.hop;
      b.g.rotation.y = b.base.ry + Math.sin(s * 0.5 + b.phase) * 0.03 * idle;
      const sq = b.sq || 0; b.g.scale.set(b.base.s * (1 + 0.14 * sq), b.base.s * (1 - 0.2 * sq), b.base.s * (1 + 0.14 * sq));
      if (t < INTRO) b.blinkAt = s + 0.6 + Math.random() * 3;
      else if (s > b.blinkAt) { b.blink = 1; b.blinkAt = s + 2.2 + Math.random() * 4.5; }
      b.blink = Math.max(0, b.blink - dt * 7);
      let sy = 1 - Math.sin(b.blink * Math.PI) * 0.9;
      if (isHero && inIntro) sy = 1 - 0.9 * (Math.sin(seg(t, 0.12, 0.26) * Math.PI) + Math.sin(seg(t, 4.5, 4.64) * Math.PI));
      b.eyes.scale.y = sy;
      b.eyes.position.x = mouse.x * 0.035 * Math.max(idle, isHero && t < 1 ? 1 : 0); b.eyes.position.y = mouse.y * 0.025 * Math.max(idle, isHero && t < 1 ? 1 : 0);
      b.wake = Math.max(0, b.wake - dt);
      const awakeNow = b.state === 'on' || b.wake > 0;
      b.awake.visible = awakeNow; b.asleep.visible = !awakeNow && b.state === 'sleep'; b.off.visible = !awakeNow && b.state === 'off';
      const big = hovered === b ? 1.18 : 1; b.eyes.scale.x += (big - b.eyes.scale.x) * Math.min(1, dt * 10);
    }
    folk.forEach((f, i) => { f.rotation.y += Math.sin(s * 0.7 + i * 2) * 0.004 * idle; f.position.y = Math.abs(Math.sin(s * 2.2 + i * 1.7)) * 0.012 * idle; });
    voxels(dt, reduced ? 1 : out3(seg(t, 3.4, 4.7)));
    if (!textCalled && t >= T_TEXT) { textCalled = true; opt.onText && opt.onText(); }
    if (!doneCalled && t >= INTRO) { doneCalled = true; opt.onDone && opt.onDone(); }
  }
  function loop(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now; frameN++;
    const half = SM.afterP >= 0.98;
    if (!paused && !document.hidden && (!half || frameN % 2 === 0)) { update(half ? Math.min(0.1, dt * 2) : dt, now); r.render(scene, cam); }
    requestAnimationFrame(loop);
  }
  addEventListener('resize', frame, { passive: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) last = performance.now(); });
  update(0, performance.now()); r.render(scene, cam);
  requestAnimationFrame(t => { last = t; requestAnimationFrame(loop); });
  if (opt.onReady) opt.onReady();
  return {
    skip, go, get t() { return T; }, INTRO,
    setScroll(o) { Object.assign(S, o); },
    freeze(t, o) { paused = true; waiting = false; T = t; if (o) { Object.assign(S, o); Object.assign(SM, o); } update(0, performance.now()); r.render(scene, cam); },
    step(dt, o, now) { paused = true; waiting = false; if (o) { Object.assign(S, o); Object.assign(SM, o); } update(dt, now); r.render(scene, cam); },
    play() { paused = false; }, stop() { running = false; },
  };
}
