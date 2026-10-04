// Timing + easing helpers. All animation is a pure function of time t (seconds).
export const FPS = 30;
export const DURATION = 15;
export const FRAMES = FPS * DURATION;

// Master timeline (seconds). Every scene and overlay reads its beats from here.
export const T = {
  // 1 - bedside opening
  s1Defocus: [2.02, 2.52],  // rack focus away
  s1Dim: [2.05, 2.45],
  x1: [2.42, 2.68],         // crossfade bedroom -> motor
  // 2 - motor
  m0: 2.36,
  mIn: [2.38, 3.05],        // exposure + focus in
  mPull: [3.7, 5.1],        // close-up -> wide pull-back
  panel0: 4.72,             // first data panel appears (others stagger)
  reveal: 0.95,             // trace draw duration
  sev: [5.95, 7.0],         // developing change
  conv: 6.92,               // packets start converging
  arrive: 7.52,             // early-warning indicator lands
  pill: [7.74, 8.1],        // "EARLY WARNING" opens
  mOut: [7.72, 8.22],       // motor defocus + brighten
  x2: [7.92, 8.28],         // crossfade motor -> calendar
  // 3 - calendar
  c0: 7.9,
  cFocus: [8.2, 8.74],
  morph: [7.98, 8.82],      // pill -> card
  fail: [8.42, 8.92],       // projected failure marker
  event: [8.98, 9.42],      // repair block on Tuesday
  ptr: [9.02, 9.36],        // pointer card -> block
  expand: [9.14, 9.52],
  planned: [9.24, 9.66],
  main: [9.36, 9.9],        // "PLANNED REPAIR — 10:00 AM"
  bracket: [10.02, 10.72],  // lead-time span Tue -> Sat
  // 4 - bedside ending
  cut: 12.5,
  flip: 12.95,              // 1:59 -> 2:00
  rack: [13.15, 13.72],     // focus clock -> phone
  text: [13.42, 13.86],
  rule: [13.58, 14.1],
};

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
