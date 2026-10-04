import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Post } from './post.js';
import { Bedroom } from './bedroom.js';
import { Motor } from './motor.js';
import { Calendar } from './calendar.js';
import { Overlay } from './overlay.js';
import { FPS, T, seg, smooth, lerp } from './timeline.js';

const W = 1920, H = 1080;

async function loadFonts() {
  const base = './node_modules/@fontsource/inter/files/';
  const weights = [400, 500, 600, 700];
  for (const w of weights) {
    const f = new FontFace('Inter', `url(${base}inter-latin-${w}-normal.woff2)`, { weight: String(w) });
    await f.load();
    document.fonts.add(f);
  }
  await document.fonts.ready;
}

async function init() {
  await loadFonts();
  const canvas = document.getElementById('gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  RectAreaLightUniformsLib.init();

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const post = new Post(renderer, W, H);
  const bedroom = new Bedroom(renderer, envTex);
  const motor = new Motor(renderer, envTex);
  const calendar = new Calendar(renderer);
  const overlay = new Overlay();

  const scenes = { bedroom, motor, calendar };
  window.__three = { renderer, post, scenes, THREE };

  window.renderFrame = (frame, opts = {}) => {
    const t = opts.t ?? frame / FPS;
    const ctx = post.overlayCanvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    // which scenes are visible
    const layers = [];
    if (t < T.x1[1]) layers.push(bedroom);
    if (t >= T.m0 && t < T.x2[1]) layers.push(motor);
    if (t >= T.c0 && t < T.cut) layers.push(calendar);
    if (t >= T.cut) layers.push(bedroom);
    let mix = 0;
    if (layers.length === 2) {
      if (t < T.x1[1]) mix = smooth(seg(t, T.x1[0], T.x1[1]));
      else mix = smooth(seg(t, T.x2[0], T.x2[1]));
    }
    let grain = 0.03;
    const params = layers.map((sc) => sc.update(t));
    layers.forEach((sc, i) => post.renderScene(sc, params[i], i));
    if (params.length === 2) grain = lerp(params[0].grain, params[1].grain, mix);
    else if (params.length) grain = params[0].grain;
    overlay.draw(ctx, t, { motor, cal: calendar.anchors });
    post.final({ mix, fade: 1, grain, seed: frame * 1.618 });
    renderer.getContext().finish();
    return true;
  };
  window.__ready = true;
}

init().catch((e) => { window.__error = String(e && e.stack || e); console.error(e); });
