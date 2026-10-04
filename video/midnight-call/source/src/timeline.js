// Timing + easing helpers. All animation is a pure function of time t (seconds).
export const FPS = 30;
export const DURATION = 10;
export const FRAMES = FPS * DURATION;

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, k) => a + (b - a) * k;
export const seg = (t, a, b) => clamp((t - a) / (b - a));
export const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
export const smoother = (x) => { x = clamp(x); return x * x * x * (x * (x * 6 - 15) + 10); };
export const easeInOutSine = (x) => -(Math.cos(Math.PI * clamp(x)) - 1) / 2;
export const easeInOutCubic = (x) => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
export const easeOutCubic = (x) => 1 - Math.pow(1 - clamp(x), 3);
export const easeInCubic = (x) => Math.pow(clamp(x), 3);
export const easeOutQuart = (x) => 1 - Math.pow(1 - clamp(x), 4);
export const easeOutQuint = (x) => 1 - Math.pow(1 - clamp(x), 5);
export const easeInQuad = (x) => clamp(x) * clamp(x);
export const easeOutExpo = (x) => { x = clamp(x); return x === 1 ? 1 : 1 - Math.pow(2, -10 * x); };
export const easeInOutQuart = (x) => { x = clamp(x); return x < 0.5 ? 8 * x * x * x * x : 1 - Math.pow(-2 * x + 2, 4) / 2; };
// Gentle overshoot used sparingly for UI settles.
export const easeOutBack = (x, s = 1.2) => { x = clamp(x) - 1; return x * x * ((s + 1) * x + s) + 1; };

export const lerp3 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];

// Deterministic PRNG
export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Smooth 1D value noise (deterministic), returns -1..1
export function noise1(x, seed = 0) {
  const h = (n) => { const s = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453; return (s - Math.floor(s)) * 2 - 1; };
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
}
