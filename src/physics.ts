/**
 * Thermodynamics of one mole of gas (ideal or van der Waals), with no rendering in sight.
 *
 * Units are chosen so that 1 J = 1 kPa·L, which makes the Maxwell pairs numerically comparable:
 *   T in K, V in litres, P in kPa, S in J/K, U/F/G/H in J,
 *   a in kPa·L²/mol², b in L/mol, R = 8.314 J/(mol K) = 8.314 kPa·L/(mol K).
 *
 * The "hard way" measurements never evaluate the closed-form derivative they are compared with:
 * they integrate heat (first law: q = ΔU + ∫P dV) or step an insulated piston (dU = −P dV) and
 * divide finite differences, exactly as a bench experiment would.
 */

export const R = 8.314;

export type GasId = "ideal" | "argon" | "co2" | "water" | "custom";
export type Relation = 1 | 2 | 3 | 4;
export type Potential = "F" | "U" | "G" | "H";

export interface Gas {
  id: GasId;
  /** Attraction, kPa·L²/mol². */
  a: number;
  /** Excluded volume, L/mol. */
  b: number;
  /** Heat capacity at constant volume, J/(mol K). */
  cv: number;
}

export const GAS_INFO: Record<GasId, { name: string; a: number; b: number; cvR: number }> = {
  ideal: { name: "Ideal gas", a: 0, b: 0, cvR: 1.5 },
  argon: { name: "Argon", a: 135.5, b: 0.03201, cvR: 1.5 },
  co2: { name: "Carbon dioxide", a: 364.0, b: 0.04267, cvR: 3.4 },
  water: { name: "Water vapour", a: 553.6, b: 0.03049, cvR: 3.0 },
  custom: { name: "Custom gas", a: 250, b: 0.04, cvR: 1.5 },
};

export function makeGas(id: GasId, custom?: { a: number; b: number }, cvR?: number): Gas {
  const g = GAS_INFO[id];
  const a = id === "custom" && custom ? custom.a : g.a;
  const b = id === "custom" && custom ? custom.b : g.b;
  const k = id === "ideal" || id === "custom" ? (cvR ?? g.cvR) : g.cvR;
  return { id, a, b, cv: k * R };
}

/** Display window of the state plane (also the slider limits). */
export const T_MIN = 150;
export const T_MAX = 900;
export const V_MIN = 0.1;
export const V_MAX = 20;

/** Smallest allowed volume for a gas: keep clear of the hard-core wall V = b. */
export const vFloor = (g: Gas) => Math.max(V_MIN, g.b * 1.25);

// ───────────────────────── equation of state and potentials ─────────────────────────

export const pressure = (g: Gas, T: number, V: number) => (R * T) / (V - g.b) - g.a / (V * V);
/** (∂P/∂V)_T, used only by root finding and the critical-point check. */
export const dPdV = (g: Gas, T: number, V: number) => (-R * T) / ((V - g.b) * (V - g.b)) + (2 * g.a) / (V * V * V);
/** S(T, V) up to a constant: Cv ln T + R ln(V − b). */
export const entropy = (g: Gas, T: number, V: number) => g.cv * Math.log(T) + R * Math.log(V - g.b);
/** U(T, V) = Cv T − a/V. */
export const energy = (g: Gas, T: number, V: number) => g.cv * T - g.a / V;
export const helmholtz = (g: Gas, T: number, V: number) => energy(g, T, V) - T * entropy(g, T, V);
export const gibbs = (g: Gas, T: number, V: number) => helmholtz(g, T, V) + pressure(g, T, V) * V;
export const enthalpy = (g: Gas, T: number, V: number) => energy(g, T, V) + pressure(g, T, V) * V;

export function potential(p: Potential, g: Gas, T: number, V: number): number {
  switch (p) {
    case "F":
      return helmholtz(g, T, V);
    case "U":
      return energy(g, T, V);
    case "G":
      return gibbs(g, T, V);
    default:
      return enthalpy(g, T, V);
  }
}

export const POTENTIAL_OF: Record<Relation, Potential> = { 1: "F", 2: "U", 3: "G", 4: "H" };

export function critical(g: Gas): { Tc: number; Vc: number; Pc: number } | null {
  if (g.a <= 0 || g.b <= 0) return null;
  return { Tc: (8 * g.a) / (27 * R * g.b), Vc: 3 * g.b, Pc: g.a / (27 * g.b * g.b) };
}

/**
 * Volume at temperature T and pressure P, continuing from `guess` (Newton, safeguarded by
 * bisection). Above Tc the isotherm is monotonic so the root is unique; below Tc this follows
 * the branch nearest the guess. Returns NaN only if no root is bracketed.
 */
export function volumeAt(g: Gas, T: number, P: number, guess: number): number {
  const lo0 = g.b * (1 + 1e-9) + 1e-12;
  let V = Math.max(lo0 * 1.0001, guess);
  for (let i = 0; i < 40; i++) {
    const f = pressure(g, T, V) - P;
    const d = dPdV(g, T, V);
    if (Math.abs(f) <= 1e-12 * Math.max(1, Math.abs(P))) return V;
    if (d === 0 || !Number.isFinite(d)) break;
    let Vn = V - f / d;
    if (!(Vn > lo0)) Vn = (V + lo0) / 2;
    if (Vn > V * 4) Vn = V * 4;
    if (Math.abs(Vn - V) <= 1e-13 * V) return Vn;
    V = Vn;
  }
  // bracket on the side of the guess and bisect
  let a = guess, b = guess;
  const fg = pressure(g, T, guess) - P;
  // pressure falls with volume on stable branches: if f > 0 the root is at larger V
  for (let k = 0; k < 80; k++) {
    if (fg > 0) b *= 1.15;
    else a = lo0 + (a - lo0) / 1.15;
    const fa = pressure(g, T, a) - P, fb = pressure(g, T, b) - P;
    if (fa * fb <= 0) {
      let lo = a, hi = b, flo = fa;
      for (let j = 0; j < 100; j++) {
        const m = (lo + hi) / 2;
        const fm = pressure(g, T, m) - P;
        if (flo * fm <= 0) hi = m;
        else {
          lo = m;
          flo = fm;
        }
      }
      return (lo + hi) / 2;
    }
  }
  return NaN;
}

/** Simpson's rule with n (even) panels. */
function simpson(f: (x: number) => number, a: number, b: number, n = 32): number {
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
  return (s * h) / 3;
}

/** RK4 along an insulated (adiabatic) path: dT/dV = −(P + a/V²)/Cv, from the first law dU = −P dV. */
function adiabat(g: Gas, T0: number, V0: number, V1: number, n = 12): number {
  const f = (V: number, T: number) => -(pressure(g, T, V) + g.a / (V * V)) / g.cv;
  const h = (V1 - V0) / n;
  let T = T0, V = V0;
  for (let i = 0; i < n; i++) {
    const k1 = f(V, T);
    const k2 = f(V + h / 2, T + (h / 2) * k1);
    const k3 = f(V + h / 2, T + (h / 2) * k2);
    const k4 = f(V + h, T + h * k3);
    T += (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
    V += h;
  }
  return T;
}

// ───────────────────────── the two bench experiments ─────────────────────────

export interface Measurement {
  /** Left cylinder: counts heat (the hard way). */
  hard: number;
  /** Right cylinder: reads a dial (the easy way). */
  easy: number;
  /** 100 × (1 − |hard − easy| / max(|hard|, |easy|)). */
  matchPct: number;
  /** Heat into the left cylinder during its step, J (negative = flows out). */
  q: number;
  /** Entropy change of the left cylinder, J/K. */
  dS: number;
  /** Left cylinder: volume change (L), temperature change (K), pressure change (kPa). */
  left: { dV: number; dT: number; dP: number };
  /** Right cylinder: volume change (L), temperature change (K), pressure change (kPa). */
  right: { dV: number; dT: number; dP: number };
  /** Step sizes used. */
  stepV: number;
  stepT: number;
  ok: boolean;
}

export const matchPct = (a: number, b: number) => {
  const m = Math.max(Math.abs(a), Math.abs(b));
  if (!(m > 0)) return 100;
  return 100 * (1 - Math.abs(a - b) / m);
};

/** Step sizes for a relative step `frac` (default 1 %: dV = 1 % of V, dT = 1 K). */
export function steps(g: Gas, T: number, V: number, frac: number): { dV: number; dT: number } {
  const dV = Math.min(frac * V, 0.6 * (V - g.b));
  const dT = Math.min(100 * frac, 0.5 * T);
  return { dV, dT };
}

/**
 * Run both experiments of relation `rel` at state (T, V), with relative step `frac`.
 * All finite steps are centred on the state.
 */
export function measure(g: Gas, rel: Relation, T: number, V: number, frac = 0.01): Measurement {
  const { dV, dT } = steps(g, T, V, frac);
  const z = { dV: 0, dT: 0, dP: 0 };
  let hard = NaN, easy = NaN, q = 0, dS = 0;
  let left = { ...z }, right = { ...z };
  const V1 = V - dV / 2, V2 = V + dV / 2;
  const T1 = T - dT / 2, T2 = T + dT / 2;

  if (rel === 1) {
    // Hard: isothermal expansion in a heat bath. Heat in = ΔU + work done by the gas.
    q = energy(g, T, V2) - energy(g, T, V1) + simpson((v) => pressure(g, T, v), V1, V2);
    dS = q / T;
    hard = dS / dV;
    left = { dV, dT: 0, dP: pressure(g, T, V2) - pressure(g, T, V1) };
    // Easy: lock the piston, warm by dT, read the gauge.
    const dP = pressure(g, T2, V) - pressure(g, T1, V);
    easy = dP / dT;
    right = { dV: 0, dT, dP };
  } else if (rel === 2) {
    // Hard: lock the piston and feed heat in small portions, adding up q/T for each.
    const n = 16;
    for (let i = 0; i < n; i++) {
      const ta = T1 + (dT * i) / n, tb = T1 + (dT * (i + 1)) / n;
      const dq = energy(g, tb, V) - energy(g, ta, V); // no work at fixed volume
      q += dq;
      dS += dq / ((ta + tb) / 2);
    }
    const dP = pressure(g, T2, V) - pressure(g, T1, V);
    hard = -dP / dS;
    left = { dV: 0, dT, dP };
    // Easy: insulate it and let it expand; read the thermometer.
    const Ta = adiabat(g, T, V, V1), Tb = adiabat(g, T, V, V2);
    easy = (Tb - Ta) / dV;
    right = { dV, dT: Tb - Ta, dP: pressure(g, Tb, V2) - pressure(g, Ta, V1) };
  } else if (rel === 3) {
    // Hard: squeeze in a heat bath and count the heat that flows out, per kPa of squeeze.
    q = energy(g, T, V1) - energy(g, T, V2) + simpson((v) => pressure(g, T, v), V2, V1);
    dS = q / T;
    const dP = pressure(g, T, V1) - pressure(g, T, V2);
    hard = dS / dP;
    left = { dV: -dV, dT: 0, dP };
    // Easy: a weight keeps the pressure fixed; warm it and read how far the piston rises.
    const P = pressure(g, T, V);
    const Va = volumeAt(g, T1, P, V), Vb = volumeAt(g, T2, P, V);
    easy = -(Vb - Va) / dT;
    right = { dV: Vb - Va, dT, dP: 0 };
  } else {
    // Hard: a weight keeps the pressure fixed; feed heat in portions (q = ΔU + P ΔV) and track volume.
    const P = pressure(g, T, V);
    const n = 16;
    let Vp = volumeAt(g, T1, P, V);
    const Va = Vp;
    for (let i = 0; i < n; i++) {
      const ta = T1 + (dT * i) / n, tb = T1 + (dT * (i + 1)) / n;
      const Vn = volumeAt(g, tb, P, Vp);
      const dq = energy(g, tb, Vn) - energy(g, ta, Vp) + P * (Vn - Vp);
      q += dq;
      dS += dq / ((ta + tb) / 2);
      Vp = Vn;
    }
    hard = (Vp - Va) / dS;
    left = { dV: Vp - Va, dT, dP: 0 };
    // Easy: insulate it and squeeze; read thermometer and gauge.
    const Ta = adiabat(g, T, V, V2), Tb = adiabat(g, T, V, V1);
    const dP = pressure(g, Tb, V1) - pressure(g, Ta, V2);
    easy = (Tb - Ta) / dP;
    right = { dV: -dV, dT: Tb - Ta, dP };
  }
  const ok = Number.isFinite(hard) && Number.isFinite(easy);
  return { hard, easy, matchPct: ok ? matchPct(hard, easy) : NaN, q, dS, left, right, stepV: dV, stepT: dT, ok };
}

/** The exact value both measurements estimate (for tests and the "finite step error" readout). */
export function exact(g: Gas, rel: Relation, T: number, V: number): number {
  const vb = V - g.b;
  const dPdT = R / vb;
  const dPdVT = dPdV(g, T, V);
  const dVdT_P = -dPdT / dPdVT;
  if (rel === 1) return dPdT;
  if (rel === 2) return -(pressure(g, T, V) + g.a / (V * V)) / g.cv;
  if (rel === 3) return -dVdT_P;
  // (∂T/∂P)_S = T (∂V/∂T)_P / Cp
  const cp = g.cv + (T * dPdT * dPdT) / -dPdVT;
  return (T * dVdT_P) / cp;
}

// ───────────────────────── cyclic rule and Cp − Cv ─────────────────────────

/** (∂P/∂T)_V × (∂T/∂V)_P × (∂V/∂P)_T, each measured by its own finite experiment. */
export function cyclic(g: Gas, T: number, V: number, frac = 0.01): { a: number; b: number; c: number; product: number } {
  const { dV, dT } = steps(g, T, V, frac);
  const a = (pressure(g, T + dT / 2, V) - pressure(g, T - dT / 2, V)) / dT;
  const P = pressure(g, T, V);
  const Va = volumeAt(g, T - dT / 2, P, V), Vb = volumeAt(g, T + dT / 2, P, V);
  const b = dT / (Vb - Va);
  const c = dV / (pressure(g, T, V + dV / 2) - pressure(g, T, V - dV / 2));
  return { a, b, c, product: a * b * c };
}

/**
 * The heat-capacity gap from two easy measurements, Cp − Cv = T V α² / κ_T, compared with
 * the direct calorimetry value (heat at constant pressure minus heat at constant volume, per K).
 */
export function cpMinusCv(g: Gas, T: number, V: number, frac = 0.01): { alpha: number; kappa: number; fromEasy: number; direct: number } {
  const { dV, dT } = steps(g, T, V, frac);
  const P = pressure(g, T, V);
  const Va = volumeAt(g, T - dT / 2, P, V), Vb = volumeAt(g, T + dT / 2, P, V);
  const alpha = (Vb - Va) / dT / V;
  const kappa = -(dV / (pressure(g, T, V + dV / 2) - pressure(g, T, V - dV / 2))) / V;
  const fromEasy = (T * V * alpha * alpha) / kappa;
  const cp = (energy(g, T + dT / 2, Vb) - energy(g, T - dT / 2, Va) + P * (Vb - Va)) / dT;
  const cv = (energy(g, T + dT / 2, V) - energy(g, T - dT / 2, V)) / dT;
  return { alpha, kappa, fromEasy, direct: cp - cv };
}

/** True where the isotherm slopes the wrong way: the gas would split into liquid and vapour. */
export const unstable = (g: Gas, T: number, V: number) => g.a > 0 && dPdV(g, T, V) > 0;

// ───────────────────────── self test ─────────────────────────

export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SelfTest {
  relation1: boolean;
  relation2: boolean;
  relation3: boolean;
  relation4: boolean;
  cyclicMinusOne: boolean;
  idealCpCv: boolean;
  vdwCritical: boolean;
  noNaN: boolean;
  pass: boolean;
  worstPct: Record<string, number>;
  ms: number;
}

export function selfTest(): SelfTest {
  const t0 = performance.now();
  const rng = makeRng(20261022);
  const gases: Gas[] = [makeGas("ideal"), makeGas("ideal", undefined, 2.5), makeGas("argon"), makeGas("co2"), makeGas("water")];
  const worst = { r1: 0, r2: 0, r3: 0, r4: 0, cyc: 0, cpcv: 0 };
  let finite = true;
  for (let i = 0; i < 200; i++) {
    const g = i % 6 === 5 ? makeGas("custom", { a: 20 + rng() * 500, b: 0.01 + rng() * 0.06 }) : gases[i % gases.length];
    const cr = critical(g);
    const tLo = Math.max(T_MIN, cr ? cr.Tc * 1.05 : T_MIN);
    if (tLo >= T_MAX) continue;
    const T = tLo + rng() * (T_MAX - tLo);
    const vLo = Math.max(vFloor(g), g.b * 2);
    const V = vLo * Math.pow(V_MAX / vLo, rng());
    for (const rel of [1, 2, 3, 4] as Relation[]) {
      const m = measure(g, rel, T, V);
      if (!m.ok) finite = false;
      const err = 100 - m.matchPct;
      const key = `r${rel}` as "r1";
      if (!(err <= worst[key])) worst[key] = Number.isFinite(err) ? err : Infinity;
    }
    const c = cyclic(g, T, V);
    const ce = Math.abs(c.product + 1) * 100;
    if (!Number.isFinite(c.product)) finite = false;
    worst.cyc = Math.max(worst.cyc, Number.isFinite(ce) ? ce : Infinity);
  }
  // ideal gas: Cp − Cv = R, both from easy measurements and from direct calorimetry
  for (let i = 0; i < 40; i++) {
    const g = makeGas("ideal", undefined, i % 2 ? 2.5 : 1.5);
    const T = T_MIN + rng() * (T_MAX - T_MIN), V = V_MIN * Math.pow(V_MAX / V_MIN, rng());
    const c = cpMinusCv(g, T, V);
    const e = Math.max(Math.abs(c.fromEasy / R - 1), Math.abs(c.direct / R - 1)) * 100;
    worst.cpcv = Math.max(worst.cpcv, Number.isFinite(e) ? e : Infinity);
  }
  // van der Waals critical point: the isotherm is flat and has an inflection there
  let critOk = true;
  for (const id of ["argon", "co2", "water"] as GasId[]) {
    const g = makeGas(id);
    const c = critical(g)!;
    const h = c.Vc * 1e-3;
    const d1 = (pressure(g, c.Tc, c.Vc + h) - pressure(g, c.Tc, c.Vc - h)) / (2 * h);
    const d2 = (pressure(g, c.Tc, c.Vc + h) - 2 * pressure(g, c.Tc, c.Vc) + pressure(g, c.Tc, c.Vc - h)) / (h * h);
    const pOk = Math.abs(pressure(g, c.Tc, c.Vc) / c.Pc - 1) < 1e-9;
    if (!(Math.abs((d1 * c.Vc) / c.Pc) < 1e-4 && Math.abs((d2 * c.Vc * c.Vc) / c.Pc) < 1e-3 && pOk)) critOk = false;
  }
  // no NaN near the hard-core wall V → b, at the floor of the slider, and below Tc
  for (const id of ["argon", "co2", "water", "custom"] as GasId[]) {
    const g = makeGas(id);
    for (const V of [g.b * 1.0001, g.b * 1.01, vFloor(g), 0.1, 20]) {
      if (V <= g.b) continue;
      for (const T of [150, 300, 900]) {
        for (const rel of [1, 2, 3, 4] as Relation[]) {
          const m = measure(g, rel, T, V);
          if (!Number.isFinite(m.hard) || !Number.isFinite(m.easy)) finite = false;
        }
        const ps = [pressure(g, T, V), entropy(g, T, V), helmholtz(g, T, V), gibbs(g, T, V), enthalpy(g, T, V)];
        if (!ps.every(Number.isFinite)) finite = false;
      }
    }
  }
  const tol = 0.2;
  const r = {
    relation1: worst.r1 < tol,
    relation2: worst.r2 < tol,
    relation3: worst.r3 < tol,
    relation4: worst.r4 < tol,
    cyclicMinusOne: worst.cyc < 0.5,
    idealCpCv: worst.cpcv < 0.5,
    vdwCritical: critOk,
    noNaN: finite,
  };
  const pass = Object.values(r).every(Boolean);
  const round = (x: number) => Math.round(x * 1e5) / 1e5;
  return {
    ...r,
    pass,
    worstPct: { relation1: round(worst.r1), relation2: round(worst.r2), relation3: round(worst.r3), relation4: round(worst.r4), cyclic: round(worst.cyc), idealCpCv: round(worst.cpcv) },
    ms: Math.round(performance.now() - t0),
  };
}
