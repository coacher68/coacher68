// Scene 1 + 4: bedside table at night. Units: centimeters.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { woodTextures, noiseTexture, blindsTexture, roundedRectShapeArc, textTexture } from './textures.js';
import { seg, lerp, easeInOutSine, easeInOutCubic, smooth, clamp } from './timeline.js';

const DIGIT_COLOR = new THREE.Color(0xeef3f5);

// segment ids: a b c d e f g
const DIGITS = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc',
  '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', ' ': '',
};

function hexSegment(x1, y1, x2, y2, t) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len;
  const px = -uy, py = ux;
  const h = t / 2;
  const s = new THREE.Shape();
  s.moveTo(x1, y1);
  s.lineTo(x1 + ux * h + px * h, y1 + uy * h + py * h);
  s.lineTo(x2 - ux * h + px * h, y2 - uy * h + py * h);
  s.lineTo(x2, y2);
  s.lineTo(x2 - ux * h - px * h, y2 - uy * h - py * h);
  s.lineTo(x1 + ux * h - px * h, y1 + uy * h - py * h);
  s.closePath();
  return new THREE.ShapeGeometry(s);
}

function digitSegments(W, H, T, g) {
  const h2 = H / 2, t2 = T / 2;
  return {
    a: hexSegment(t2 + g, H - t2, W - t2 - g, H - t2, T),
    b: hexSegment(W - t2, h2 + g, W - t2, H - t2 - g, T),
    c: hexSegment(W - t2, t2 + g, W - t2, h2 - g, T),
    d: hexSegment(t2 + g, t2, W - t2 - g, t2, T),
    e: hexSegment(t2, t2 + g, t2, h2 - g, T),
    f: hexSegment(t2, h2 + g, t2, H - t2 - g, T),
    g: hexSegment(t2 + g, h2, W - t2 - g, h2, T),
  };
}

const PhoneGlassShader = {
  name: 'PhoneGlass',
  uniforms: {
    color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null },
    uStrength: { value: 1.0 }, uBase: { value: new THREE.Color(0x020203) }, uF0: { value: 0.045 },
    uSheen: { value: 0.0 }, uBlur: { value: 0.016 },
  },
  vertexShader: /* glsl */`
    uniform mat4 textureMatrix;
    varying vec4 vUv; varying vec3 vWorldPos; varying vec3 vN; varying vec2 vLocal;
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      vN = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
      vLocal = position.xy;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: /* glsl */`
    uniform vec3 color; uniform sampler2D tDiffuse; uniform float uStrength; uniform vec3 uBase; uniform float uF0; uniform float uSheen; uniform float uBlur;
    varying vec4 vUv; varying vec3 vWorldPos; varying vec3 vN; varying vec2 vLocal;
    void main() {
      vec3 V = normalize(cameraPosition - vWorldPos);
      float cosT = clamp(dot(V, vN), 0.0, 1.0);
      float F = uF0 + (1.0 - uF0) * pow(1.0 - cosT, 5.0);
      vec2 uv = vUv.xy / vUv.w;
      // soft, rough-coating reflection: mip-blurred + small disc kernel
      vec3 refl = vec3(0.0);
      for (int i = 0; i < 12; i++) {
        float a = float(i) * 2.39996;
        float rr = uBlur * sqrt((float(i) + 0.5) / 12.0);
        refl += texture2D(tDiffuse, uv + vec2(cos(a), sin(a) * 1.8) * rr, 3.5).rgb;
      }
      refl /= 12.0;
      // faint sheen gradient across the glass (oleophobic coating / room bounce)
      float sheen = uSheen * smoothstep(-7.5, 7.5, vLocal.y) * 0.5;
      gl_FragColor = vec4(uBase + refl * color * F * uStrength + vec3(sheen), 1.0);
    }`,
};

export class Bedroom {
  constructor(renderer, envTex) {
    this.renderer = renderer;
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.environment = envTex;
    scene.environmentIntensity = 0.06;
    const cam = this.camera = new THREE.PerspectiveCamera(24, 16 / 9, 2, 1500);

    // --- Table
    const wood = woodTextures();
    wood.map.repeat.set(1.4, 1.0); wood.rough.repeat.set(1.4, 1.0);
    const tableMat = new THREE.MeshStandardMaterial({ map: wood.map, roughnessMap: wood.rough, roughness: 0.78, metalness: 0.0, color: 0xffffff });
    const table = new THREE.Mesh(new RoundedBoxGeometry(150, 4, 78, 4, 0.6), tableMat);
    table.position.set(-5, -2, -8);
    table.receiveShadow = true;
    scene.add(table);

    // --- Wall
    const wallMat = new THREE.MeshStandardMaterial({ map: noiseTexture(512, 512, 21, 30, 6, 1.5), roughness: 0.95, metalness: 0 });
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(600, 300), wallMat);
    wall.position.set(0, 60, -47);
    wall.receiveShadow = true;
    scene.add(wall);

    // --- Lamp base (off), back right
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x2a2c2f, roughness: 0.28, metalness: 0.0 });
    const lampPts = [];
    for (let i = 0; i <= 24; i++) {
      const y = (i / 24) * 26;
      const r = 6.5 + 1.8 * Math.sin((i / 24) * Math.PI) - (i / 24) * 2.5;
      lampPts.push(new THREE.Vector2(r, y));
    }
    lampPts.push(new THREE.Vector2(0.01, 26));
    lampPts.unshift(new THREE.Vector2(0.01, 0));
    const lamp = new THREE.Mesh(new THREE.LatheGeometry(lampPts, 64), lampMat);
    lamp.position.set(34, 0, -30);
    lamp.castShadow = true; lamp.receiveShadow = true;
    scene.add(lamp);
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(13, 17, 22, 64, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x3a3b3c, roughness: 0.95, side: THREE.DoubleSide }));
    shade.position.set(34, 40, -30);
    scene.add(shade);

    // --- Clock
    const clock = this.clock = new THREE.Group();
    clock.position.set(-12.5, 0, -15);
    clock.rotation.y = 0.20;
    scene.add(clock);
    const CW = 15.5, CH = 7.6, CD = 6.4;
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2b2e31, roughness: 0.66, metalness: 0.0 });
    const body = new THREE.Mesh(new RoundedBoxGeometry(CW, CH, CD, 6, 1.4), bodyMat);
    body.position.set(0, CH / 2, 0);
    body.castShadow = true; body.receiveShadow = true;
    clock.add(body);
    const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x020202, roughness: 0.18, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.08 });
    const glass = new THREE.Mesh(new THREE.ShapeGeometry(roundedRectShapeArc(CW - 3.0, CH - 2.9, 0.7), 12), glassMat);
    glass.position.set(0, CH / 2, CD / 2 + 0.012);
    clock.add(glass);

    // digits
    const DW = 2.15, DH = 3.55, DT = 0.42, DG = 0.06;
    const segs = digitSegments(DW, DH, DT, DG);
    this.segOn = new THREE.MeshBasicMaterial({ color: DIGIT_COLOR.clone().multiplyScalar(2.6) });
    this.segOff = new THREE.MeshBasicMaterial({ color: DIGIT_COLOR.clone().multiplyScalar(0.012) });
    this.colonMat = new THREE.MeshBasicMaterial({ color: DIGIT_COLOR.clone().multiplyScalar(2.6) });
    const disp = new THREE.Group();
    disp.position.set(0, CH / 2 - DH / 2 - 0.05, CD / 2 + 0.03);
    clock.add(disp);
    const gap = 0.55, colonW = 0.42;
    const amW = 1.25;
    const total = DW * 3 + gap * 3 + colonW + 0.35 + amW;
    let x = -total / 2;
    this.digitMeshes = [];
    const addDigit = (x0) => {
      const m = {};
      for (const k of Object.keys(segs)) {
        const mesh = new THREE.Mesh(segs[k], this.segOff);
        mesh.position.x = x0;
        disp.add(mesh);
        m[k] = mesh;
      }
      this.digitMeshes.push(m);
    };
    addDigit(x); x += DW + gap;
    // colon
    const dot = new THREE.PlaneGeometry(0.42, 0.42);
    const c1 = new THREE.Mesh(dot, this.colonMat), c2 = new THREE.Mesh(dot, this.colonMat);
    c1.position.set(x + colonW / 2, DH * 0.30, 0); c2.position.set(x + colonW / 2, DH * 0.70, 0);
    disp.add(c1, c2);
    x += colonW + gap;
    addDigit(x); x += DW + gap;
    addDigit(x); x += DW + 0.35;
    // AM indicator
    const amTex = textTexture('AM', { font: '600 84px Inter', w: 256, h: 128, letterSpacing: '6px' });
    this.amMat = new THREE.MeshBasicMaterial({ map: amTex, transparent: true, color: DIGIT_COLOR.clone().multiplyScalar(2.0), depthWrite: false });
    const am = new THREE.Mesh(new THREE.PlaneGeometry(amW * 1.5, amW * 0.75), this.amMat);
    am.position.set(x + amW / 2 + 0.05, DH - 0.42, 0.001);
    disp.add(am);

    // light from display onto table
    const disLight = new THREE.RectAreaLight(0xeef3f5, 6.0, 9.5, 3.4);
    disLight.position.set(0, CH / 2, CD / 2 + 0.25);
    disLight.lookAt(0, CH / 2 - 0.4, CD / 2 + 10);
    clock.add(disLight);
    this.disLight = disLight;

    // --- Phone
    const phone = this.phone = new THREE.Group();
    phone.position.set(-6.0, 0, 6.0);
    phone.rotation.y = -0.10;
    scene.add(phone);
    const PW = 7.3, PL = 15.2, PT = 0.82, bev = 0.26;
    const shape = roundedRectShapeArc(PW - 2 * bev, PL - 2 * bev, 1.05 - bev);
    const pg = new THREE.ExtrudeGeometry(shape, { depth: PT - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 6, curveSegments: 24 });
    pg.rotateX(-Math.PI / 2);
    pg.translate(0, bev, 0);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x3b3e42, metalness: 1.0, roughness: 0.34, envMapIntensity: 1.0 });
    const pbody = new THREE.Mesh(pg, frameMat);
    pbody.castShadow = true; pbody.receiveShadow = true;
    phone.add(pbody);
    const topY = PT;
    const glassShape = roundedRectShapeArc(PW - 2 * bev - 0.04, PL - 2 * bev - 0.04, 1.05 - bev - 0.02);
    const refl = this.phoneGlass = new Reflector(new THREE.ShapeGeometry(glassShape, 24), {
      textureWidth: 1024, textureHeight: 576, color: 0xffffff, shader: PhoneGlassShader, multisample: 4, clipBias: 0.0,
    });
    refl.rotation.x = -Math.PI / 2;
    refl.position.y = topY + 0.004;
    phone.add(refl);
    refl.material.uniforms.uStrength.value = 0.42;
    const rt = refl.getRenderTarget();
    rt.texture.generateMipmaps = true;
    rt.texture.minFilter = THREE.LinearMipmapLinearFilter;
    refl.material.uniforms.uSheen.value = 0.006;

    // charging cable
    const cablePts = [
      [0, 0.32, PL / 2 + 0.6], [0.15, 0.24, PL / 2 + 2.4], [1.4, 0.2, PL / 2 + 5.0], [4.5, 0.2, PL / 2 + 7.4],
      [9.5, 0.2, PL / 2 + 8.6], [15, 0.2, PL / 2 + 9.6], [21, 0.2, PL / 2 + 12.5], [27, 0.2, PL / 2 + 16.5], [33, 0.2, PL / 2 + 22],
    ].map((p) => new THREE.Vector3(...p));
    const cableGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cablePts), 160, 0.19, 12, false);
    const cableMat = new THREE.MeshStandardMaterial({ color: 0x141516, roughness: 0.55 });
    const cable = new THREE.Mesh(cableGeo, cableMat);
    cable.castShadow = true;
    phone.add(cable);
    const plug = new THREE.Mesh(new RoundedBoxGeometry(0.85, 0.42, 1.2, 3, 0.15), cableMat);
    plug.position.set(0, 0.36, PL / 2 + 0.5);
    phone.add(plug);

    // --- Lights
    scene.add(new THREE.HemisphereLight(0x323a44, 0x080808, 0.55));

    const moon = this.moon = new THREE.DirectionalLight(0xdfe6ee, 1.1);
    moon.position.set(-70, 85, -55);
    moon.target.position.set(0, 0, 0);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    Object.assign(moon.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 10, far: 300 });
    moon.shadow.bias = -0.0004; moon.shadow.normalBias = 0.03;
    moon.shadow.radius = 4;
    scene.add(moon, moon.target);

    const blinds = this.blinds = new THREE.SpotLight(0xd8e0e8, 900, 0, 0.42, 0.35, 0);
    blinds.position.set(-150, 70, 30);
    blinds.target.position.set(10, 34, -47);
    blinds.map = blindsTexture();
    blinds.castShadow = true;
    blinds.shadow.mapSize.set(1024, 1024);
    blinds.shadow.bias = -0.0005;
    scene.add(blinds, blinds.target);
    blinds.intensity = 4.5;

    // faint fill from the right so the phone's frame edge reads
    const rim = new THREE.DirectionalLight(0xc9d2dc, 0.18);
    rim.position.set(60, 30, -40);
    scene.add(rim);

    this.digitsShown = null;
  }

  setTime(str) {
    // str like "159" or "200"
    if (str === this.digitsShown) return;
    this.digitsShown = str;
    for (let i = 0; i < 3; i++) {
      const on = DIGITS[str[i]] || '';
      for (const k of 'abcdefg') this.digitMeshes[i][k].material = on.includes(k) ? this.segOn : this.segOff;
    }
  }

  // shot: 1 (opening) or 4 (ending)
  update(t) {
    const cam = this.camera;
    let pos, tgt, focusPt, cocScale, deadZone, maxCoc, exposure = 1.0;
    let fade = 1;
    if (t < 4) {
      // Opening: slow push in + gentle lateral drift; at end, defocus + dip for the transition
      const k = easeInOutSine(seg(t, 0, 2.2));
      pos = new THREE.Vector3(lerp(3.5, 0.0, k), lerp(17.0, 15.6, k), lerp(55, 49, k));
      tgt = new THREE.Vector3(lerp(-6.5, -7.2, k), lerp(1.6, 1.4, k), lerp(-3.0, -3.6, k));
      focusPt = new THREE.Vector3(-9.0, 2.0, -4.5);
      cocScale = 3600; deadZone = 0.0031; maxCoc = 30;
      // transition: rack defocus to near, and dim
      const tr = smooth(seg(t, 1.60, 2.12));
      focusPt.lerp(new THREE.Vector3(-4, 1, 34), tr);
      deadZone = lerp(deadZone, 0.0, tr);
      exposure = lerp(1.0, 0.12, smooth(seg(t, 1.68, 2.12)));
      this.setTime('159');
    } else {
      const k = easeInOutSine(seg(t, 8.0, 10.0));
      pos = new THREE.Vector3(lerp(-2.0, -2.8, k), lerp(18.5, 17.8, k), lerp(52, 48.5, k));
      tgt = new THREE.Vector3(lerp(-7.6, -7.8, k), lerp(-1.5, -1.6, k), lerp(-4.0, -4.4, k));
      // rack focus: clock -> phone
      const rf = easeInOutCubic(seg(t, 8.55, 9.1));
      const clockPt = new THREE.Vector3(-12.0, 3.6, -12.5);
      const phonePt = new THREE.Vector3(-6.4, 0.8, 3.5);
      focusPt = clockPt.clone().lerp(phonePt, rf);
      cocScale = 2700; deadZone = 0.0011; maxCoc = 30;
      this.setTime(t < 8.35 ? '159' : '200');
    }
    // colon: soft 1 Hz pulse (never fully off)
    const ph = ((t + 0.65) % 1.0);
    const colonK = ph < 0.5 ? 1.0 : 0.38;
    this.colonMat.color.copy(DIGIT_COLOR).multiplyScalar(2.6 * colonK);

    cam.position.copy(pos);
    cam.lookAt(tgt);
    cam.updateMatrixWorld();
    // focus distance = view-space depth of focus point
    const v = focusPt.clone().applyMatrix4(cam.matrixWorldInverse);
    const focus = Math.max(3, -v.z);

    return {
      exposure, vignette: 0.42, vigPow: 2.0, sat: 0.9, contrast: 1.04,
      lift: [0.004, 0.0045, 0.006], gain: [1, 1, 1],
      dof: { focus, cocScale, deadZone, maxCoc, radScale: 0.75 },
      bloom: { strength: 0.38, radius: 0.45, threshold: 0.8 },
      grain: 0.013,
    };
  }
}
