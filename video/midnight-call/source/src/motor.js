// Scene 2: TEFC induction motor driving a centrifugal pump in a plant. Units: meters.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { noiseTexture, canvas, makeNoise2, fbm } from './textures.js';
import { T, seg, lerp, easeInOutSine, easeInOutCubic, smooth, mulberry32 } from './timeline.js';

const GREEN = new THREE.Color(0x11a84b);
const AMBER = new THREE.Color(0xffa51f);

function grilleTexture() {
  const S = 1024, c = canvas(S, S), ctx = c.getContext('2d');
  ctx.fillStyle = '#2b5888';
  ctx.fillRect(0, 0, S, S);
  const cx = S / 2, cy = S / 2;
  // concentric rings of slots
  ctx.fillStyle = '#070a0f';
  const rings = [[0.18, 18], [0.27, 26], [0.36, 34], [0.45, 42], [0.54, 50], [0.63, 58], [0.72, 66], [0.81, 74]];
  for (const [rr, n] of rings) {
    const r = rr * S / 2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      ctx.save();
      ctx.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      ctx.rotate(a + Math.PI / 2);
      const w = (2 * Math.PI * r / n) * 0.55, h = S * 0.03;
      ctx.beginPath();
      ctx.roundRect(-w / 2, -h / 2, w, h, Math.min(w, h) / 2);
      ctx.fill();
      ctx.restore();
    }
  }
  // hub
  ctx.fillStyle = '#30608f';
  ctx.beginPath(); ctx.arc(cx, cy, S * 0.07, 0, Math.PI * 2); ctx.fill();
  // outer rim darker ring
  ctx.strokeStyle = '#264f7c'; ctx.lineWidth = S * 0.03;
  ctx.beginPath(); ctx.arc(cx, cy, S * 0.47, 0, Math.PI * 2); ctx.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function concreteTexture(seed = 3) {
  const S = 1024, c = canvas(S, S), ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const n = makeNoise2(seed), n2 = makeNoise2(seed + 9);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const v = 0.5 * fbm(n, x / 160, y / 160, 5) + 0.5 * fbm(n2, x / 30, y / 30, 3);
    const speck = n2(x / 1.6, y / 1.6);
    let val = 58 + 34 * (v - 0.5) + 10 * (speck - 0.5);
    const o = (y * S + x) * 4;
    img.data[o] = val; img.data[o + 1] = val * 1.005; img.data[o + 2] = val * 1.015; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // saw-cut joint
  ctx.strokeStyle = 'rgba(10,10,10,0.55)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(S, 2); ctx.moveTo(2, 0); ctx.lineTo(2, S); ctx.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

function alongX(geo) { geo.rotateZ(-Math.PI / 2); return geo; } // cylinder/lathe Y axis -> +X

export class Motor {
  constructor(renderer, envTex) {
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a1626);
    scene.environment = envTex;
    scene.environmentIntensity = 0.13;
    scene.fog = new THREE.FogExp2(0x0a1626, 0.06);
    this.camera = new THREE.PerspectiveCamera(25, 16 / 9, 0.1, 80);

    const paint = new THREE.MeshStandardMaterial({ color: 0x2c5a8c, roughness: 0.5, metalness: 0.16 });   // industrial motor blue
    const paintDark = new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.55, metalness: 0.15 });
    const guardPaint = new THREE.MeshStandardMaterial({ color: 0xd9a422, roughness: 0.55, metalness: 0.06 });  // safety yellow
    const pumpPaint = new THREE.MeshStandardMaterial({ color: 0x434a53, roughness: 0.45, metalness: 0.2 });
    const steel = new THREE.MeshStandardMaterial({ color: 0xa9b0b6, roughness: 0.35, metalness: 1.0 });
    const blackRubber = new THREE.MeshStandardMaterial({ color: 0x1a1c1e, roughness: 0.7 });
    const concrete = new THREE.MeshStandardMaterial({ map: noiseTexture(512, 512, 31, 66, 12, 1.2), roughness: 0.92 });

    const add = (geo, mat, x = 0, y = 0, z = 0, parent = scene, shadow = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      if (shadow) { m.castShadow = true; m.receiveShadow = true; }
      parent.add(m);
      return m;
    };

    // ---------------- Plinth + baseplate
    add(new RoundedBoxGeometry(2.4, 0.22, 1.04, 2, 0.02), concrete, 0.38, 0.11, 0);
    add(new RoundedBoxGeometry(2.08, 0.11, 0.76, 2, 0.012), paintDark, 0.38, 0.22 + 0.055, 0);
    // anchor bolts on baseplate
    const hexBolt = new THREE.CylinderGeometry(0.018, 0.018, 0.014, 6);
    for (const bx of [-0.6, 1.36]) for (const bz of [-0.32, 0.32]) add(hexBolt, steel, bx, 0.337, bz);

    const Hc = 0.60; // shaft centerline height
    const motor = this.motorGroup = new THREE.Group();
    motor.position.set(0, Hc, 0);
    scene.add(motor);

    // ---------------- Frame with axial cooling fins
    const R0 = 0.205, FH = 0.042, FT = 0.0095, FL = 0.58;
    add(alongX(new THREE.CylinderGeometry(R0, R0, 0.6, 128, 1, true)), paint, 0, 0, 0, motor);
    const fins = [];
    const NF = 44;
    for (let i = 0; i < NF; i++) {
      const th = (i / NF) * Math.PI * 2 + 0.035; // angle from +Z toward +Y
      const ang = Math.atan2(Math.sin(th), Math.cos(th));
      const dBottom = Math.abs(ang - (-Math.PI / 2)), dTop = Math.abs(ang - Math.PI / 2);
      if (dBottom < 0.42 || dTop < 0.22) continue;
      const g = new THREE.BoxGeometry(FL, FH, FT);
      g.rotateX(Math.PI / 2 - th);
      const r = R0 + FH / 2 - 0.003;
      g.translate(0, Math.sin(th) * r, Math.cos(th) * r);
      fins.push(g);
    }
    add(mergeGeometries(fins), paint, 0, 0, 0, motor);
    // end flanges
    for (const fx of [-0.3, 0.3]) add(alongX(new THREE.CylinderGeometry(0.252, 0.252, 0.028, 128)), paint, fx, 0, 0, motor);
    // terminal box pad
    add(new RoundedBoxGeometry(0.23, 0.05, 0.21, 2, 0.008), paint, 0.02, R0 + 0.012, 0, motor);

    // ---------------- End bells
    const bellPts = [[0.252, 0], [0.249, 0.012], [0.238, 0.03], [0.215, 0.05], [0.18, 0.068], [0.14, 0.08], [0.115, 0.088], [0.108, 0.094],
      [0.108, 0.104], [0.098, 0.11], [0.07, 0.114], [0.0, 0.114]].map(([r, y]) => new THREE.Vector2(r, y));
    const deBell = add(alongX(new THREE.LatheGeometry(bellPts, 128)), paint, 0.3, 0, 0, motor);
    const ndeBellG = new THREE.LatheGeometry(bellPts, 128); ndeBellG.rotateZ(Math.PI / 2);
    add(ndeBellG, paint, -0.3, 0, 0, motor);
    // bearing cap bolts on DE
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      add(alongX(new THREE.CylinderGeometry(0.011, 0.011, 0.012, 6)), steel, 0.413, Math.sin(a) * 0.082, Math.cos(a) * 0.082, motor);
    }
    // shaft (short exposed part before guard)
    add(alongX(new THREE.CylinderGeometry(0.038, 0.038, 0.06)), steel, 0.44, 0, 0, motor);

    // ---------------- Fan cover (NDE)
    const fcLen = 0.21, fcX = -0.33 - fcLen / 2;
    add(alongX(new THREE.CylinderGeometry(0.247, 0.252, fcLen, 128, 1, true)), paint, fcX, 0, 0, motor).material.side = THREE.DoubleSide;
    for (const rx of [-0.39, -0.48]) add(new THREE.TorusGeometry(0.251, 0.006, 8, 128).rotateY(Math.PI / 2), paint, rx, 0, 0, motor);
    const capMat = new THREE.MeshStandardMaterial({ map: grilleTexture(), roughness: 0.48, metalness: 0.18, color: 0xffffff });
    const cap = add(new THREE.CircleGeometry(0.247, 128), capMat, -0.33 - fcLen, 0, 0, motor);
    cap.rotation.y = -Math.PI / 2;
    add(new THREE.TorusGeometry(0.247, 0.01, 10, 128).rotateY(Math.PI / 2), paint, -0.33 - fcLen, 0, 0, motor);

    // ---------------- Terminal box
    const tbx = 0.02, tby = R0 + 0.035 + 0.065;
    add(new RoundedBoxGeometry(0.25, 0.13, 0.24, 3, 0.014), paint, tbx, tby, 0, motor);
    add(new RoundedBoxGeometry(0.262, 0.024, 0.252, 3, 0.009), paint, tbx, tby + 0.065 + 0.012, 0, motor);
    for (const sx of [-0.105, 0.105]) for (const sz of [-0.1, 0.1]) add(new THREE.CylinderGeometry(0.008, 0.008, 0.008, 12), steel, tbx + sx, tby + 0.065 + 0.027, sz, motor);
    // cable gland + conduit
    add(alongX(new THREE.CylinderGeometry(0.026, 0.03, 0.04, 6)), steel, tbx + 0.145, tby - 0.005, 0, motor);
    const condPts = [[tbx + 0.16, tby - 0.005, 0], [tbx + 0.24, tby - 0.0, 0], [tbx + 0.29, tby + 0.07, 0.0], [tbx + 0.305, tby + 0.3, -0.02], [tbx + 0.31, tby + 1.2, -0.05], [tbx + 0.31, tby + 2.4, -0.05]]
      .map((p) => new THREE.Vector3(...p));
    add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(condPts), 120, 0.021, 14, false), blackRubber, 0, 0, 0, motor);
    // nameplate
    const np = add(new THREE.PlaneGeometry(0.13, 0.075), new THREE.MeshStandardMaterial({ color: 0xc9ced3, roughness: 0.35, metalness: 0.8 }), -0.08, 0.02, 0.0, motor);
    np.position.set(-0.1, 0.035, R0 + FH + 0.002);
    np.visible = false; // fins in front; skip

    // ---------------- Eyebolts
    for (const ex of [-0.21, 0.215]) {
      add(new THREE.CylinderGeometry(0.014, 0.016, 0.032, 16), steel, ex, R0 + 0.012, 0, motor);
      const ring = add(new THREE.TorusGeometry(0.032, 0.009, 12, 40), steel, ex, R0 + 0.06, 0, motor);
    }

    // ---------------- Feet
    for (const fx of [-0.2, 0.2]) for (const fz of [-0.168, 0.168]) {
      add(new THREE.BoxGeometry(0.075, 0.15, 0.05), paint, fx, -0.18, fz, motor);
      add(new RoundedBoxGeometry(0.12, 0.024, 0.13, 2, 0.004), paint, fx, -0.25, fz + Math.sign(fz) * 0.02, motor);
      add(new THREE.BoxGeometry(0.115, 0.008, 0.125), steel, fx, -0.266, fz + Math.sign(fz) * 0.02, motor);
      add(new THREE.CylinderGeometry(0.024, 0.024, 0.004, 24), steel, fx, -0.236, fz + Math.sign(fz) * 0.045, motor);
      add(hexBolt, steel, fx, -0.228, fz + Math.sign(fz) * 0.045, motor);
    }

    // ---------------- Coupling guard
    const gShape = new THREE.Shape();
    const gw = 0.16, gb = -0.27, gTop = 0.06;
    gShape.moveTo(-gw, gb); gShape.lineTo(gw, gb); gShape.lineTo(gw, gTop);
    gShape.absarc(0, gTop, gw, 0, Math.PI, false);
    gShape.lineTo(-gw, gb);
    const gGeo = new THREE.ExtrudeGeometry(gShape, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 48 });
    gGeo.rotateY(Math.PI / 2);
    add(gGeo, guardPaint, 0.45, 0, 0, motor);

    // ---------------- Pump
    const pump = new THREE.Group();
    pump.position.set(0, Hc, 0);
    scene.add(pump);
    add(alongX(new THREE.CylinderGeometry(0.085, 0.095, 0.28, 64)), pumpPaint, 0.9, 0, 0, pump);
    add(new THREE.BoxGeometry(0.16, 0.2, 0.2), pumpPaint, 0.92, -0.17, 0, pump);
    const volPts = [[0.07, -0.075], [0.21, -0.075], [0.245, -0.062], [0.262, -0.035], [0.266, 0], [0.262, 0.035], [0.245, 0.062], [0.21, 0.075], [0.07, 0.075]]
      .map(([r, y]) => new THREE.Vector2(r, y));
    add(alongX(new THREE.LatheGeometry(volPts, 96)), pumpPaint, 1.16, 0, 0, pump);
    add(alongX(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 64)), pumpPaint, 1.06, 0, 0, pump);
    // discharge (up)
    add(new THREE.CylinderGeometry(0.06, 0.07, 0.3, 48), pumpPaint, 1.16, 0.38, -0.12, pump);
    add(new THREE.CylinderGeometry(0.11, 0.11, 0.03, 48), pumpPaint, 1.16, 0.54, -0.12, pump);
    add(new THREE.CylinderGeometry(0.07, 0.07, 2.4, 48), steel, 1.16, 1.75, -0.12, pump);
    // suction (+x)
    add(alongX(new THREE.CylinderGeometry(0.08, 0.08, 0.22, 48)), pumpPaint, 1.36, 0, 0, pump);
    add(alongX(new THREE.CylinderGeometry(0.13, 0.13, 0.03, 48)), pumpPaint, 1.47, 0, 0, pump);
    add(alongX(new THREE.CylinderGeometry(0.085, 0.085, 3.0, 48)), steel, 2.98, 0, 0, pump);

    // ---------------- Plant environment
    const floorTex = concreteTexture();
    floorTex.repeat.set(10, 10);
    const floor = add(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.55, metalness: 0.0, envMapIntensity: 0.6 }), 0, 0, 0, scene);
    floor.rotation.x = -Math.PI / 2;
    floor.castShadow = false;
    const lineMat = new THREE.MeshStandardMaterial({ color: 0xc9970f, roughness: 0.65 });
    for (const lz of [1.45, -2.0]) { const ln = add(new THREE.PlaneGeometry(30, 0.09), lineMat, 0, 0.002, lz, scene); ln.rotation.x = -Math.PI / 2; ln.castShadow = false; }

    const colMat = new THREE.MeshStandardMaterial({ color: 0x46505c, roughness: 0.55, metalness: 0.3 });
    const column = (x, z) => {
      const g = new THREE.Group(); g.position.set(x, 0, z);
      add(new THREE.BoxGeometry(0.32, 9, 0.025), colMat, 0, 4.5, -0.15, g);
      add(new THREE.BoxGeometry(0.32, 9, 0.025), colMat, 0, 4.5, 0.15, g);
      add(new THREE.BoxGeometry(0.02, 9, 0.3), colMat, 0, 4.5, 0, g);
      add(new THREE.BoxGeometry(0.6, 0.03, 0.6), colMat, 0, 0.015, 0, g);
      scene.add(g);
    };
    column(-3.4, -3.2); column(3.0, -3.6); column(-9.0, -4.0); column(9.0, -4.5);
    const pipeMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.35, metalness: 0.7 });
    const redPipe = new THREE.MeshStandardMaterial({ color: 0xc0352b, roughness: 0.45, metalness: 0.1 });   // fire main
    const greenPipe = new THREE.MeshStandardMaterial({ color: 0x2f9a5c, roughness: 0.45, metalness: 0.1 }); // cooling water
    for (const [py, pz, pr, m] of [[2.55, -2.7, 0.11, greenPipe], [2.85, -2.9, 0.08, pipeMat], [2.62, -3.3, 0.16, pipeMat], [3.2, -3.0, 0.07, redPipe]]) {
      add(alongX(new THREE.CylinderGeometry(pr, pr, 30, 32)), m, 0, py, pz, scene);
    }
    // vertical drop
    add(new THREE.CylinderGeometry(0.08, 0.08, 2.6, 32), pipeMat, -1.6, 1.3, -2.9, scene);
    add(alongX(new THREE.CylinderGeometry(0.08, 0.08, 1.2, 32)), pipeMat, -1.0, 0.25, -2.9, scene);
    // cable tray
    add(new THREE.BoxGeometry(30, 0.06, 0.45), new THREE.MeshStandardMaterial({ color: 0x7c8287, roughness: 0.5, metalness: 0.6 }), 0, 2.25, -1.8, scene);

    // background equipment silhouettes
    const tank = add(new THREE.CylinderGeometry(1.3, 1.3, 5, 48), new THREE.MeshStandardMaterial({ color: 0x3c4146, roughness: 0.5, metalness: 0.3 }), 5.6, 2.5, -8.5, scene);
    const bgMotor = new THREE.Group(); bgMotor.position.set(-4.4, 0.55, -5.0); scene.add(bgMotor);
    add(alongX(new THREE.CylinderGeometry(0.25, 0.25, 0.9, 48)), paint, 0, 0, 0, bgMotor);
    add(new THREE.BoxGeometry(1.8, 0.3, 0.7), paintDark, 0.4, -0.4, 0, bgMotor);
    add(alongX(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 48)), pumpPaint, 1.0, 0, 0, bgMotor);
    // MCC lineup with indicator lights
    const mccMat = new THREE.MeshStandardMaterial({ color: 0x3f454b, roughness: 0.5, metalness: 0.3 });
    const indW = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(3.0) });
    const indG = new THREE.MeshBasicMaterial({ color: GREEN.clone().multiplyScalar(3.0) });
    const indA = new THREE.MeshBasicMaterial({ color: AMBER.clone().multiplyScalar(3.0) });
    const indR = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3b2f).multiplyScalar(3.0) });
    const rnd = mulberry32(5);
    for (let i = 0; i < 9; i++) {
      const x = -7.5 + i * 0.85;
      add(new THREE.BoxGeometry(0.82, 2.3, 0.5), mccMat, x, 1.15, -9.0, scene);
      for (let j = 0; j < 2; j++) {
        if (rnd() < 0.35) continue;
        const r = rnd(); const m = add(new THREE.CircleGeometry(0.03, 16), r < 0.45 ? indG : r < 0.65 ? indR : r < 0.8 ? indA : indW, x - 0.2 + j * 0.12, 1.75 - rnd() * 0.4, -8.74, scene, false);
      }
    }
    // back wall
    add(new THREE.PlaneGeometry(80, 20), new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.9 }), 0, 10, -13, scene, false);
    // high-bay fixtures (emissive)
    const hb = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd9a8).multiplyScalar(6.0) });
    for (const [hx, hz] of [[-5, -4], [0, -5], [5, -5.5], [-9, -8], [9, -8], [-2, -10], [3, -11]]) {
      const d = add(new THREE.CylinderGeometry(0.28, 0.28, 0.06, 32), hb, hx, 6.4, hz, scene, false);
    }

    // ---------------- Lights
    scene.add(new THREE.HemisphereLight(0x5f80b4, 0x1a1510, 0.42));
    const key = new THREE.SpotLight(0xfff0dc, 2.7, 0, 0.34, 0.8, 0);
    key.position.set(-0.6, 5.0, 3.0); key.target.position.set(0.2, 0.45, 0.05);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0002; key.shadow.normalBias = 0.015; key.shadow.radius = 3;
    key.shadow.camera.near = 1; key.shadow.camera.far = 12;
    scene.add(key, key.target);
    const rimL = new THREE.SpotLight(0x7fb4ff, 15.0, 0, 0.3, 0.6, 0);
    rimL.position.set(0.9, 4.2, -3.6); rimL.target.position.set(0.1, 0.6, 0);
    scene.add(rimL, rimL.target);
    const top = new THREE.RectAreaLight(0xfff3e4, 5.0, 1.6, 0.5);
    top.position.set(0.25, 3.0, 0.4); top.lookAt(0.25, 0, 0.2);
    scene.add(top);
    // pools of light in the background from high-bays
    for (const [px, pz, pi, pc] of [[-4.6, -5.0, 3.2, 0xffb36b], [3.4, -6.0, 2.8, 0x9cc4ff], [-0.6, -3.4, 1.6, 0xffc48a], [7.5, -9.0, 2.4, 0xffa95e]]) {
      const sp = new THREE.SpotLight(pc, pi, 0, 0.55, 0.9, 0);
      sp.position.set(px, 6.3, pz); sp.target.position.set(px, 0, pz);
      scene.add(sp, sp.target);
    }

    this.anchors = {};
    this.Hc = Hc;
  }

  update(t) {
    const cam = this.camera;
    // camera: close "running normally" detail -> pull back to the 3/4 hero shot -> slow orbit
    const k1 = seg(t, T.m0, T.mPull[1]);
    const k2 = easeInOutSine(seg(t, T.mPull[0], T.mOut[1]));
    const close = { az: lerp(0.62, 0.5, k1), dist: lerp(1.3, 1.16, k1), el: lerp(0.15, 0.12, k1), tx: 0.3, ty: 0.7, tz: 0.15 };
    const wide = { az: lerp(0.72, 0.56, k2), dist: lerp(4.05, 3.68, k2), el: lerp(0.215, 0.19, k2), tx: lerp(0.2, 0.24, k2), ty: lerp(0.6, 0.62, k2), tz: 0 };
    const p = easeInOutCubic(seg(t, T.mPull[0], T.mPull[1]));
    const az = lerp(close.az, wide.az, p);
    const dist = Math.exp(lerp(Math.log(close.dist), Math.log(wide.dist), p));
    const el = lerp(close.el, wide.el, p);
    const tgt = new THREE.Vector3(lerp(close.tx, wide.tx, p), lerp(close.ty, wide.ty, p), lerp(close.tz, wide.tz, p));
    cam.position.set(tgt.x - Math.sin(az) * Math.cos(el) * dist, tgt.y + Math.sin(el) * dist, tgt.z + Math.cos(az) * Math.cos(el) * dist);
    cam.lookAt(tgt);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    this.scene.updateMatrixWorld(true);

    this.anchors = {};

    // focus on the target; defocus in from the previous shot and out to the next
    const v = tgt.clone().applyMatrix4(cam.matrixWorldInverse);
    let focus = -v.z;
    const inK = smooth(seg(t, T.mIn[0], T.mIn[1]));
    const outK = smooth(seg(t, T.mOut[0], T.mOut[1]));
    const near = 0.3;
    focus = lerp(near, focus, inK);
    focus = lerp(focus, near, outK);
    const exposure = lerp(0.12, 1.0, smooth(seg(t, T.mIn[0], T.mIn[1] - 0.1))) * lerp(1.0, 1.9, outK);

    return {
      exposure, vignette: 0.4, vigPow: 2.1, sat: 1.05, contrast: 1.06,
      lift: [0.004, 0.008, 0.018], gain: [1, 1, 1],
      dof: { focus, cocScale: 95, deadZone: 0.02, maxCoc: 26, radScale: 0.8 },
      bloom: { strength: 0.18, radius: 0.45, threshold: 1.5 },
      grain: 0.013,
    };
  }
}
