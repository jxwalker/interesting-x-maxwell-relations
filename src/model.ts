/** App state shared by the WebGL scene, the Canvas2D fallback and the HUD. Deterministic per step(dt). */
import {
  GAS_INFO,
  POTENTIAL_OF,
  T_MAX,
  T_MIN,
  V_MAX,
  critical,
  cpMinusCv,
  cyclic,
  exact,
  makeGas,
  measure,
  pressure,
  entropy,
  unstable,
  vFloor,
  type Gas,
  type GasId,
  type Measurement,
  type Relation,
} from "./physics";

export const RUN_S = 2.6;

export const DEFAULTS = {
  gas: "ideal" as GasId,
  custom: { a: GAS_INFO.custom.a, b: GAS_INFO.custom.b },
  cvR: 1.5,
  relation: 1 as Relation,
  T: 300,
  V: 1,
  frac: 0.01,
  showWhy: false,
};

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

interface Tween {
  t0: number;
  dur: number;
  from: { T: number; V: number };
  to: { T: number; V: number };
}

export interface WowStep {
  at: number;
  run: (m: Model) => void;
}

export class Model {
  gasId: GasId = DEFAULTS.gas;
  custom = { ...DEFAULTS.custom };
  cvR = DEFAULTS.cvR;
  relation: Relation = DEFAULTS.relation;
  T = DEFAULTS.T;
  V = DEFAULTS.V;
  frac = DEFAULTS.frac;
  showWhy = DEFAULTS.showWhy;

  gas: Gas = makeGas(DEFAULTS.gas);
  /** Seconds since load. */
  time = 0;
  /** Seconds into the current run, or −1. */
  runT = -1;
  /** Both experiments have been run since the last reset. */
  measured = false;
  /** State the last run was made at. */
  runAt: { T: number; V: number; gas: GasId; relation: Relation; value: number } | null = null;
  /** Seconds since the equals bracket last lit. */
  matchAge = 99;
  /** Bumps whenever gas or relation changes (the view morphs its landscape). */
  shapeKey = 0;
  /** Smoothed bar levels in [0, 1]. */
  barHard = 0;
  barEasy = 0;
  live!: Measurement;
  cyc = { a: 0, b: 0, c: 0, product: -1 };
  cp = { alpha: 0, kappa: 0, fromEasy: 0, direct: 0 };
  /** Last thing the user (or the wow script) did, for the caption. */
  event: { kind: string; at: number } = { kind: "load", at: 0 };

  wowActive = true;
  private wowSteps: WowStep[] = [];
  private wowIdx = 0;
  private tween: Tween | null = null;
  private key = "";

  constructor() {
    this.refresh();
    this.wowSteps = [
      { at: 0.7, run: (m) => m.run(true) },
      { at: 3.5, run: (m) => (m.tweenTo({ T: 700, V: 0.45 }, 2.1), (m.event = { kind: "wow-sweep", at: m.time })) },
      {
        at: 5.9,
        run: (m) => {
          const c = critical(makeGas("co2"))!;
          m.setGas("co2", true);
          m.tweenTo({ T: Math.round(c.Tc * 1.03), V: +(c.Vc * 1.15).toFixed(3) }, 1.3);
          m.event = { kind: "wow-critical", at: m.time };
        },
      },
      { at: 7.4, run: (m) => (m.wowActive = false) },
    ];
  }

  get pot() {
    return POTENTIAL_OF[this.relation];
  }
  get P() {
    return pressure(this.gas, this.T, this.V);
  }
  get S() {
    return entropy(this.gas, this.T, this.V);
  }
  get crit() {
    return critical(this.gas);
  }
  get running() {
    return this.runT >= 0;
  }
  get unstable() {
    return unstable(this.gas, this.T, this.V);
  }
  get vMin() {
    return vFloor(this.gas);
  }

  stopWow(): void {
    if (!this.wowActive) return;
    this.wowActive = false;
    this.tween = null;
  }

  // ───────── actions ─────────
  run(fromWow = false): void {
    if (!fromWow) this.stopWow();
    this.runT = 0;
    this.measured = true;
    this.refresh();
    this.runAt = { T: this.T, V: this.V, gas: this.gasId, relation: this.relation, value: this.live.hard };
    this.event = { kind: "run", at: this.time };
  }

  setT(T: number): void {
    this.T = Math.max(T_MIN, Math.min(T_MAX, T));
    this.refresh();
  }
  setV(V: number): void {
    this.V = Math.max(this.vMin, Math.min(V_MAX, V));
    this.refresh();
  }
  setGas(id: GasId, fromWow = false): void {
    if (!fromWow) this.stopWow();
    if (id === this.gasId && id !== "custom") return;
    this.gasId = id;
    this.rebuildGas();
    this.event = { kind: "gas", at: this.time };
  }
  setCustom(a: number, b: number): void {
    this.custom = { a, b };
    if (this.gasId === "custom") this.rebuildGas();
  }
  setCv(k: number): void {
    this.cvR = k;
    this.rebuildGas();
  }
  setRelation(r: Relation): void {
    if (r === this.relation) return;
    this.relation = r;
    this.shapeKey++;
    this.runAt = null;
    this.refresh();
    this.event = { kind: "relation", at: this.time };
  }
  private rebuildGas(): void {
    this.gas = makeGas(this.gasId, this.custom, this.cvR);
    this.shapeKey++;
    this.V = Math.max(this.vMin, this.V);
    this.refresh();
  }

  tweenTo(to: { T: number; V: number }, dur: number): void {
    this.tween = { t0: this.time, dur, from: { T: this.T, V: this.V }, to };
  }

  reset(): void {
    this.stopWow();
    this.gasId = DEFAULTS.gas;
    this.custom = { ...DEFAULTS.custom };
    this.cvR = DEFAULTS.cvR;
    this.relation = DEFAULTS.relation;
    this.T = DEFAULTS.T;
    this.V = DEFAULTS.V;
    this.frac = DEFAULTS.frac;
    this.showWhy = DEFAULTS.showWhy;
    this.gas = makeGas(this.gasId, this.custom, this.cvR);
    this.shapeKey++;
    this.runT = -1;
    this.measured = false;
    this.runAt = null;
    this.matchAge = 99;
    this.refresh();
    this.event = { kind: "reset", at: this.time };
  }

  preset(name: "critical" | "cold" | "hot"): void {
    this.stopWow();
    if (name === "critical") {
      this.setGas("co2");
      const c = this.crit!;
      this.tweenTo({ T: Math.round(c.Tc * 1.03), V: +(c.Vc * 1.15).toFixed(3) }, 0.9);
    } else if (name === "cold") {
      this.setGas("argon");
      this.tweenTo({ T: 170, V: 0.25 }, 0.9);
    } else {
      this.setGas("argon");
      this.tweenTo({ T: 880, V: 12 }, 0.9);
    }
    this.event = { kind: `preset-${name}`, at: this.time };
  }

  // ───────── derived ─────────
  refresh(): void {
    const k = `${this.gas.a},${this.gas.b},${this.gas.cv},${this.relation},${this.T},${this.V},${this.frac}`;
    if (k === this.key) return;
    this.key = k;
    this.live = measure(this.gas, this.relation, this.T, this.V, this.frac);
    this.cyc = cyclic(this.gas, this.T, this.V, this.frac);
    this.cp = cpMinusCv(this.gas, this.T, this.V, this.frac);
  }

  /** Exact value of the current relation (for the finite-step error readout). */
  get exact(): number {
    return exact(this.gas, this.relation, this.T, this.V);
  }

  /** Bar fill for a value: logarithmic, 0.45 at the default ideal-gas state, +0.3 per factor of ten. */
  level(v: number): number {
    const ref = Math.abs(exact(makeGas("ideal"), this.relation, DEFAULTS.T, DEFAULTS.V));
    if (!Number.isFinite(v) || v === 0) return 0;
    return Math.max(0.04, Math.min(1, 0.45 + 0.3 * Math.log10(Math.abs(v) / ref)));
  }

  /** Progress of the run's bar fill in [0, 1]. */
  get fill(): number {
    if (this.runT < 0) return this.measured ? 1 : 0;
    return ease((this.runT - 0.45) / 1.6);
  }

  step(dt: number): void {
    this.time += dt;
    if (this.wowActive) {
      while (this.wowIdx < this.wowSteps.length && this.time >= this.wowSteps[this.wowIdx].at) this.wowSteps[this.wowIdx++].run(this);
    }
    if (this.tween) {
      const tw = this.tween;
      const s = ease((this.time - tw.t0) / tw.dur);
      this.T = tw.from.T + (tw.to.T - tw.from.T) * s;
      this.V = Math.exp(Math.log(tw.from.V) + (Math.log(tw.to.V) - Math.log(tw.from.V)) * s);
      this.V = Math.max(this.vMin, this.V);
      if (s >= 1) this.tween = null;
      this.refresh();
    }
    if (this.runT >= 0) {
      const before = this.runT;
      this.runT += dt;
      if (before < RUN_S - 0.25 && this.runT >= RUN_S - 0.25) this.matchAge = 0;
      if (this.runT >= RUN_S) {
        this.runT = -1;
        this.event = { kind: "matched", at: this.time };
      }
    }
    this.matchAge += dt;
    const f = this.fill;
    const th = this.measured ? this.level(this.live.hard) * f : 0;
    const te = this.measured ? this.level(this.live.easy) * f : 0;
    const k = 1 - Math.exp(-dt * (this.running ? 30 : 7));
    this.barHard += (th - this.barHard) * k;
    this.barEasy += (te - this.barEasy) * k;
  }

  finite(): boolean {
    const xs = [this.T, this.V, this.P, this.S, this.live.hard, this.live.easy, this.cyc.product, this.cp.fromEasy, this.barHard, this.barEasy];
    return xs.every(Number.isFinite);
  }
}
