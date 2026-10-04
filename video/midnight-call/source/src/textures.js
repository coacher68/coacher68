// Procedural textures + small geometry helpers (deterministic).
import * as THREE from 'three';
import { mulberry32 } from './timeline.js';

export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// 2D value noise with smooth interpolation, tileable not required.
export function makeNoise2(seed = 1) {
  const rnd = mulberry32(seed);
  const N = 256;
  const perm = new Uint16Array(N * 2);
  const vals = new Float32Array(N);
  for (let i = 0; i < N; i++) { perm[i] = i; vals[i] = rnd(); }
  for (let i = N - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < N; i++) perm[N + i] = perm[i];
  const v = (x, y) => vals[perm[(perm[x & 255] + y) & 511] & 255];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
    const a = v(xi, yi), b = v(xi + 1, yi), c = v(xi, yi + 1), d = v(xi + 1, yi + 1);
    return (a * (1 - u) + b * u) * (1 - w) + (c * (1 - u) + d * u) * w;
  };
}

export function fbm(n, x, y, oct = 4) {
  let s = 0, a = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { s += a * n(x * f, y * f); norm += a; a *= 0.5; f *= 2.03; }
  return s / norm;
}

function toTexture(c, srgb = true, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return t;
}

// Dark, fine-grained wood (grayscale). Grain runs along x.
export function woodTextures(w = 2048, h = 1024, seed = 7) {
  const c = canvas(w, h), ctx = c.getContext('2d');
  const r = canvas(w, h), rctx = r.getContext('2d');
  const img = ctx.createImageData(w, h), rimg = rctx.createImageData(w, h);
  const n = makeNoise2(seed), n2 = makeNoise2(seed + 11);
  const rnd = mulberry32(seed + 3);
  // grain profile across y
  const P = 4096;
  const prof = new Float32Array(P);
  for (let i = 0; i < P; i++) prof[i] = rnd();
  const sm = new Float32Array(P);
  for (let i = 0; i < P; i++) { let s = 0; for (let k = -2; k <= 2; k++) s += prof[(i + k + P) % P]; sm[i] = s / 5; }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const warp = 26 * fbm(n, x / 520, y / 160, 3) + 5 * n2(x / 70, y / 40);
      const yy = (y * 3.2 + warp * 3.2);
      const i0 = Math.floor(yy), f = yy - i0;
      const g = sm[((i0 % P) + P) % P] * (1 - f) + sm[(((i0 + 1) % P) + P) % P] * f;
      const lines = Math.pow(g, 2.2);
      const fine = n2(x / 3, y * 1.4);
      const big = fbm(n2, x / 900, y / 400, 2);
      let v = 0.78 + 0.34 * lines + 0.06 * fine + 0.18 * (big - 0.5);
      const base = 26; // dark charcoal-brown-neutral
      const val = Math.max(0, Math.min(255, base * v));
      const o = (y * w + x) * 4;
      img.data[o] = val * 1.02; img.data[o + 1] = val * 1.0; img.data[o + 2] = val * 0.98; img.data[o + 3] = 255;
      const rv = 150 + 50 * (lines - 0.3) + 20 * (fine - 0.5);
      rimg.data[o] = rimg.data[o + 1] = rimg.data[o + 2] = Math.max(0, Math.min(255, rv)); rimg.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  rctx.putImageData(rimg, 0, 0);
  return { map: toTexture(c, true, true), rough: toTexture(r, false, true) };
}

// Subtle plaster / concrete noise
export function noiseTexture(w, h, seed, base, amp, scale = 1, tint = [1, 1, 1]) {
  const c = canvas(w, h), ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const n = makeNoise2(seed), n2 = makeNoise2(seed + 5);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = base + amp * ((fbm(n, x / (90 * scale), y / (90 * scale), 4) - 0.5) * 1.6 + (n2(x / 2.2, y / 2.2) - 0.5) * 0.5);
    const o = (y * w + x) * 4;
    img.data[o] = v * tint[0]; img.data[o + 1] = v * tint[1]; img.data[o + 2] = v * tint[2]; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c, true, true);
}

// Window + blinds light cookie for a SpotLight.map
export function blindsTexture() {
  const S = 512;
  const c = canvas(S, S), ctx = c.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, S, S);
  ctx.filter = 'blur(5px)';
  const x0 = 120, x1 = 392, y0 = 70, y1 = 442;
  const slats = 13;
  const hstep = (y1 - y0) / slats;
  for (let i = 0; i < slats; i++) {
    const y = y0 + i * hstep;
    ctx.fillStyle = '#fff';
    ctx.fillRect(x0, y + hstep * 0.38, x1 - x0, hstep * 0.5);
  }
  // mullion
  ctx.fillStyle = '#000';
  ctx.fillRect((x0 + x1) / 2 - 5, y0 - 10, 10, y1 - y0 + 20);
  ctx.filter = 'none';
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

// Smoother rounded rect using arcs (for larger radii)
export function roundedRectShapeArc(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + h - r);
  s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + h);
  s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + r);
  s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

export function textTexture(text, { font = '600 96px Inter', w = 256, h = 128, color = '#fff', align = 'center', letterSpacing = '0px' } = {}) {
  const c = canvas(w, h), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.font = font;
  ctx.letterSpacing = letterSpacing;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, align === 'center' ? w / 2 : 0, h / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
