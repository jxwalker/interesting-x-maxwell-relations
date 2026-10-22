/**
 * The glass "energy landscape": a thermodynamic potential drawn over its own natural variables
 *   F(T, V)   U(S, V)   G(T, P)   H(S, P)
 * on a grid of states (T, V). Temperature is drawn on a log scale and volume as ln(V − 0.9 b). Horizontal coordinates are normalised to [−1, 1]; height is the
 * potential with a best-fit plane removed (a plane has no mixed second derivative, so the
 * geometry behind the Maxwell relation is untouched) and scaled to [0, 1].
 * Pure maths: no three.js here.
 */
import { T_MAX, T_MIN, V_MAX, V_MIN, entropy, potential, pressure, unstable, type Gas, type Potential } from "./physics";

export const NT = 72;
export const NV = 72;

const P0 = 150; // kPa, scale of the asinh pressure axis

export const tAt = (i: number) => T_MIN + ((T_MAX - T_MIN) * i) / (NT - 1);
/** Volume axis coordinate: ln(V − 0.9 b) stretches the interesting region near the molecular wall. */
const vAxis = (g: Gas, V: number) => Math.log(V - 0.9 * g.b);
const vLow = (g: Gas) => (g.b > 0 ? Math.min(V_MIN, 1.3 * g.b) : V_MIN);
/** Grid volumes: uniform in the axis coordinate between the gas's lowest volume and V_MAX. */
export const vAt = (g: Gas, j: number) => {
  const a = vAxis(g, vLow(g)), b = vAxis(g, V_MAX);
  return Math.exp(a + ((b - a) * j) / (NV - 1)) + 0.9 * g.b;
};

/** Natural horizontal coordinates (un-normalised) of a state. */
function natural(p: Potential, g: Gas, T: number, V: number): [number, number] {
  // ln T is a valid coordinate too (mixed slopes still commute) and spreads the everyday range
  const x1 = p === "F" || p === "G" ? Math.log(T) : entropy(g, T, V);
  const x2 = p === "F" || p === "U" ? vAxis(g, V) : -Math.asinh(pressure(g, T, V) / P0);
  return [x1, x2];
}

export interface Landscape {
  pot: Potential;
  /** Per vertex (NT × NV, i-major): x (along first variable), y (height), z (along second variable). */
  pos: Float32Array;
  unstable: Uint8Array;
  /** Map any state to (x, y, z) with the same normalisation. */
  map(T: number, V: number): [number, number, number];
}

export function buildLandscape(p: Potential, g: Gas): Landscape {
  const n = NT * NV;
  const raw = new Float64Array(n * 3);
  const un = new Uint8Array(n);
  for (let i = 0; i < NT; i++)
    for (let j = 0; j < NV; j++) {
      const T = tAt(i), V = Math.max(vAt(g, j), g.b * 1.06);
      const k = i * NV + j;
      const [a, b] = natural(p, g, T, V);
      raw[k * 3] = a;
      raw[k * 3 + 1] = potential(p, g, T, V);
      raw[k * 3 + 2] = b;
      un[k] = unstable(g, T, V) ? 1 : 0;
    }
  // robust horizontal ranges (trim the extreme 1 % so a near-wall spike doesn't squash everything)
  const range = (c: number) => {
    const arr = Array.from({ length: n }, (_, k) => raw[k * 3 + c]).sort((x, y) => x - y);
    return [arr[Math.floor(n * 0.005)], arr[Math.ceil(n * 0.995) - 1]];
  };
  const [a0, a1] = range(0);
  const [b0, b1] = range(2);
  const nx = (a: number) => ((a - a0) / (a1 - a0 || 1)) * 2 - 1;
  const nz = (b: number) => ((b - b0) / (b1 - b0 || 1)) * 2 - 1;
  // least-squares plane h ≈ c0 + c1 x + c2 z
  let sx = 0, sz = 0, sh = 0, sxx = 0, szz = 0, sxz = 0, sxh = 0, szh = 0;
  for (let k = 0; k < n; k++) {
    const x = nx(raw[k * 3]), z = nz(raw[k * 3 + 2]), h = raw[k * 3 + 1];
    sx += x;
    sz += z;
    sh += h;
    sxx += x * x;
    szz += z * z;
    sxz += x * z;
    sxh += x * h;
    szh += z * h;
  }
  const c = solve3([n, sx, sz, sx, sxx, sxz, sz, sxz, szz], [sh, sxh, szh]);
  const resid = (x: number, z: number, h: number) => h - (c[0] + c[1] * x + c[2] * z);
  const hs = Array.from({ length: n }, (_, k) => resid(nx(raw[k * 3]), nz(raw[k * 3 + 2]), raw[k * 3 + 1])).sort((x, y) => x - y);
  const h0 = hs[Math.floor(n * 0.01)], h1 = hs[Math.ceil(n * 0.99) - 1];
  const ny = (x: number, z: number, h: number) => (resid(x, z, h) - h0) / (h1 - h0 || 1);
  const clampX = (x: number) => Math.max(-1.25, Math.min(1.25, x));
  const clampY = (y: number) => Math.max(-0.35, Math.min(1.35, y));

  const map = (T: number, V: number): [number, number, number] => {
    const Vs = Math.max(V, g.b * 1.06);
    const [a, b] = natural(p, g, T, Vs);
    const x = nx(a), z = nz(b);
    return [clampX(x), clampY(ny(x, z, potential(p, g, T, Vs))), clampX(z)];
  };
  const pos = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) {
    const x = nx(raw[k * 3]), z = nz(raw[k * 3 + 2]);
    pos[k * 3] = clampX(x);
    pos[k * 3 + 1] = clampY(ny(x, z, raw[k * 3 + 1]));
    pos[k * 3 + 2] = clampX(z);
  }
  return { pot: p, pos, unstable: un, map };
}

function solve3(m: number[], r: number[]): number[] {
  const det = (a: number[]) => a[0] * (a[4] * a[8] - a[5] * a[7]) - a[1] * (a[3] * a[8] - a[5] * a[6]) + a[2] * (a[3] * a[7] - a[4] * a[6]);
  const D = det(m) || 1;
  const col = (k: number) => m.map((v, idx) => (idx % 3 === k ? r[Math.floor(idx / 3)] : v));
  return [det(col(0)) / D, det(col(1)) / D, det(col(2)) / D];
}

/**
 * States reached by a small step along each natural axis (first variable, second variable) from (T, V),
 * found by inverting the local Jacobian of the natural coordinates. Used for the slope arrows and the
 * "show why" quadrilateral (step one way then the other: same corner).
 */
export function naturalSteps(p: Potential, g: Gas, T: number, V: number, d1: number, d2: number): { s1: [number, number]; s2: [number, number]; s12: [number, number] } {
  const u = Math.log(V);
  const f = (t: number, lu: number) => natural(p, g, t, Math.exp(lu));
  const ht = 0.5, hu = 1e-3;
  const a = f(T + ht, u), b = f(T - ht, u), c = f(T, u + hu), d = f(T, u - hu);
  const J = [(a[0] - b[0]) / (2 * ht), (c[0] - d[0]) / (2 * hu), (a[1] - b[1]) / (2 * ht), (c[1] - d[1]) / (2 * hu)];
  const det = J[0] * J[3] - J[1] * J[2] || 1e-12;
  // inverse Jacobian applied to natural steps (dx1, dx2) → (dT, du)
  const inv = (dx1: number, dx2: number): [number, number] => [(J[3] * dx1 - J[1] * dx2) / det, (-J[2] * dx1 + J[0] * dx2) / det];
  const st = (dT: number, du: number): [number, number] => [T + dT, Math.exp(u + du)];
  const [t1, u1] = inv(d1, 0);
  const [t2, u2] = inv(0, d2);
  return { s1: st(t1, u1), s2: st(t2, u2), s12: st(t1 + t2, u1 + u2) };
}

/** Scale of each natural axis over the display window (to choose visible steps). */
export function naturalSpan(p: Potential, g: Gas): [number, number] {
  const c = [natural(p, g, T_MIN, vLow(g) * 1.5), natural(p, g, T_MAX, V_MAX)];
  return [Math.abs(c[1][0] - c[0][0]), Math.abs(c[1][1] - c[0][1])];
}

export const POTENTIAL_NAME: Record<Potential, { title: string; plaque: string; axes: [string, string]; slopes: [string, string]; meaning: string; short: string }> = {
  F: { title: "Free energy F", plaque: "FREE ENERGY  F(T, V)", axes: ["temperature", "volume"], slopes: ["slope = − disorder", "slope = − pressure"], meaning: "The gas's free energy at every temperature and volume. Its slopes are pressure and disorder.", short: "slopes: pressure, disorder" },
  U: { title: "Internal energy U", plaque: "ENERGY  U(S, V)", axes: ["disorder", "volume"], slopes: ["slope = temperature", "slope = − pressure"], meaning: "The gas's energy at every disorder and volume. Its slopes are temperature and pressure.", short: "slopes: temperature, pressure" },
  G: { title: "Gibbs energy G", plaque: "GIBBS ENERGY  G(T, P)", axes: ["temperature", "pressure"], slopes: ["slope = − disorder", "slope = volume"], meaning: "The gas's Gibbs energy at every temperature and pressure. Its slopes are disorder and volume.", short: "slopes: disorder, volume" },
  H: { title: "Enthalpy H", plaque: "ENTHALPY  H(S, P)", axes: ["disorder", "pressure"], slopes: ["slope = temperature", "slope = volume"], meaning: "The gas's enthalpy at every disorder and pressure. Its slopes are temperature and volume.", short: "slopes: temperature, volume" },
};

/** Matte height ramp shared by both renderers: deep indigo (low) → teal → leaf green → warm amber (high). */
const RAMP: [number, number, number][] = [
  [0.16, 0.14, 0.42],
  [0.1, 0.42, 0.62],
  [0.18, 0.64, 0.52],
  [0.66, 0.78, 0.32],
  [0.98, 0.76, 0.34],
];
export function heightColor(h: number, unstable = false): [number, number, number] {
  const t = Math.max(0, Math.min(1, h)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(t)), f = t - i;
  const a = RAMP[i], b = RAMP[i + 1];
  let c: [number, number, number] = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  // unstable (gas would split) region: pulled strongly toward brick red
  if (unstable) c = [c[0] * 0.35 + 0.92 * 0.65, c[1] * 0.35 + 0.36 * 0.65, c[2] * 0.35 + 0.22 * 0.65];
  return c;
}

/** Height contour levels drawn on the landscape. */
export const CONTOUR_LEVELS = Array.from({ length: 11 }, (_, k) => -0.2 + k * 0.12);

/**
 * Iso-height contour segments of a grid surface (x, y, z per vertex; NT × NV, i-major) by marching
 * triangles. Writes (x, y, z) pairs into out and returns the number of floats written.
 */
export function contourSegments(pos: ArrayLike<number>, levels: number[], out: Float32Array, lift = 0): number {
  let w = 0;
  const tri = (a: number, b: number, c: number, L: number) => {
    const ks = [a, b, c];
    const pts: number[] = [];
    for (let e = 0; e < 3; e++) {
      const p = ks[e] * 3, q = ks[(e + 1) % 3] * 3;
      const ha = pos[p + 1], hb = pos[q + 1];
      if ((ha < L) !== (hb < L)) {
        const s = (L - ha) / (hb - ha);
        pts.push(pos[p] + (pos[q] - pos[p]) * s, L + lift, pos[p + 2] + (pos[q + 2] - pos[p + 2]) * s);
      }
    }
    if (pts.length === 6 && w + 6 <= out.length) {
      out.set(pts, w);
      w += 6;
    }
  };
  for (const L of levels)
    for (let i = 0; i < NT - 1; i++)
      for (let j = 0; j < NV - 1; j++) {
        const a = i * NV + j, b = (i + 1) * NV + j, c = (i + 1) * NV + j + 1, d = i * NV + j + 1;
        tri(a, b, d, L);
        tri(b, c, d, L);
      }
  return w;
}
