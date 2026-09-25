// Deterministic hashing + seeded random number generation.
// Everything procedural in the universe derives from these functions so the
// same seed always produces the same galaxy, planets, creatures and dreams.

export function hash32(a, b = 0, c = 0, d = 0) {
  let h = 0x9e3779b1 ^ (a | 0);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h ^= (b | 0) + 0x632be5ab;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= (c | 0) + 0x7f4a7c15;
  h = Math.imul(h ^ (h >>> 16), 0x27d4eb2f);
  h ^= (d | 0) + 0x165667b1;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

// Uniform float in [0,1) from integer coordinates
export function hashFloat(a, b = 0, c = 0, d = 0) {
  return hash32(a, b, c, d) / 4294967296;
}

export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// sfc32-based seeded PRNG
export class RNG {
  constructor(seed = 1) {
    this.a = hash32(seed, 1);
    this.b = hash32(seed, 2);
    this.c = hash32(seed, 3);
    this.d = hash32(seed, 4) | 1;
    for (let i = 0; i < 12; i++) this.next();
  }
  next() {
    let a = this.a, b = this.b, c = this.c, d = this.d;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    this.a = a; this.b = b; this.c = c; this.d = d;
    return (t >>> 0) / 4294967296;
  }
  range(min, max) { return min + (max - min) * this.next(); }
  int(min, max) { return Math.floor(min + (max - min + 1) * this.next()); }
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length) % arr.length]; }
  weighted(entries) {
    // entries: [[value, weight], ...]
    let total = 0;
    for (const e of entries) total += e[1];
    let r = this.next() * total;
    for (const e of entries) { r -= e[1]; if (r <= 0) return e[0]; }
    return entries[entries.length - 1][0];
  }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, t) => {
  const x = clamp((t - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
};

// HSL helpers returning [r,g,b] in 0..1
export function hsl(h, s, l) {
  h = ((h % 1) + 1) % 1;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

export function mixColor(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export function colorToHex(c) {
  const to = (v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0');
  return '#' + to(c[0]) + to(c[1]) + to(c[2]);
}

export function colorToInt(c) {
  return (Math.round(clamp(c[0], 0, 1) * 255) << 16) | (Math.round(clamp(c[1], 0, 1) * 255) << 8) | Math.round(clamp(c[2], 0, 1) * 255);
}
