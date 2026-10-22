/** Renderer-agnostic view interface, palette and the words for each relation. */
import type { Relation } from "./physics";
import type { Model } from "./model";

export const ORANGE = "#ff9a4a";
export const TEAL = "#2fd1c5";
export const CYAN = "#6fe7ff";
export const VIOLET = "#b48cff";
export const GOLD = "#ffd36e";

/** What each cylinder does in each relation. */
export type LeftMode = "bath-expand" | "lock-heat" | "bath-squeeze" | "weight-heat";
export type RightMode = "lock-warm" | "insulated-expand" | "weight-warm" | "insulated-squeeze";

export interface RelationText {
  /** Equation, hard side first, as small secondary text. */
  eq: string;
  /** Thermodynamic-square side. */
  from: string;
  left: LeftMode;
  right: RightMode;
  hardTitle: string;
  easyTitle: string;
  hardShort: string;
  easyShort: string;
  /** Bar labels. */
  hardBar: string;
  easyBar: string;
  unitHard: string;
  unitEasy: string;
  hardMeaning: string;
  easyMeaning: string;
  /** Running caption (fill with T and step). */
  running: (T: number, dT: number) => string;
  /** Right-cylinder object label. */
  rightTag: string;
  /** Left-cylinder object label. */
  leftTag: string;
}

const deg = (dT: number) => (Math.abs(dT - 1) < 0.05 ? "1 degree" : `${dT.toPrecision(2)} degrees`);

export const RELATIONS: Record<Relation, RelationText> = {
  1: {
    eq: "(∂S/∂V)_T = (∂P/∂T)_V",
    from: "free energy F",
    left: "bath-expand",
    right: "lock-warm",
    hardTitle: "Hard way: expand at steady temperature",
    easyTitle: "Easy way: lock it and warm it",
    hardShort: "Hard way",
    easyShort: "Easy way",
    hardBar: "Disorder gained per litre",
    easyBar: "Pressure rise per degree",
    unitHard: "J/K per L",
    unitEasy: "kPa/K",
    hardMeaning: "Heat that flowed in, divided by temperature, per litre of expansion.",
    easyMeaning: "How much the pressure gauge climbs for each degree of warming with the piston locked.",
    running: (T, dT) => `Left: heat is flowing in to keep the gas at ${Math.round(T)} K as it expands. Right: piston locked, warming by ${deg(dT)}.`,
    leftTag: "Heat flowing in",
    rightTag: "Locked piston",
  },
  2: {
    eq: "−(∂P/∂S)_V = (∂T/∂V)_S",
    from: "energy U",
    left: "lock-heat",
    right: "insulated-expand",
    hardTitle: "Hard way: lock it, count the heat",
    easyTitle: "Easy way: insulate it and let it expand",
    hardShort: "Hard way",
    easyShort: "Easy way",
    hardBar: "Pressure drop per unit of disorder",
    easyBar: "Temperature change per litre",
    unitHard: "K/L",
    unitEasy: "K/L",
    hardMeaning: "Minus the pressure rise, divided by the disorder the heat added (heat ÷ temperature).",
    easyMeaning: "How much the thermometer changes per litre when the insulated gas expands (it cools: negative).",
    running: (T, dT) => `Left: piston locked, heat trickles in and is counted (warming ${deg(dT)} from ${Math.round(T)} K). Right: insulated, the gas expands and cools.`,
    leftTag: "Heat flowing in",
    rightTag: "Insulated: no heat in",
  },
  3: {
    eq: "(∂S/∂P)_T = −(∂V/∂T)_P",
    from: "Gibbs energy G",
    left: "bath-squeeze",
    right: "weight-warm",
    hardTitle: "Hard way: squeeze at steady temperature",
    easyTitle: "Easy way: keep the weight on and warm it",
    hardShort: "Hard way",
    easyShort: "Easy way",
    hardBar: "Disorder change per kPa of squeeze",
    easyBar: "Volume change per degree (minus)",
    unitHard: "L/K",
    unitEasy: "L/K",
    hardMeaning: "Heat that flowed out, divided by temperature, per kPa the pressure rose (negative: it loses disorder).",
    easyMeaning: "Minus how far the weighted piston rises per degree of warming, in litres.",
    running: (T, dT) => `Left: squeezed in a bath at ${Math.round(T)} K, heat flows out and is counted. Right: a weight holds the pressure, warming by ${deg(dT)}.`,
    leftTag: "Heat flowing out",
    rightTag: "Weight keeps pressure fixed",
  },
  4: {
    eq: "(∂V/∂S)_P = (∂T/∂P)_S",
    from: "enthalpy H",
    left: "weight-heat",
    right: "insulated-squeeze",
    hardTitle: "Hard way: weight on, count the heat",
    easyTitle: "Easy way: insulate it and squeeze",
    hardShort: "Hard way",
    easyShort: "Easy way",
    hardBar: "Volume gained per unit of disorder",
    easyBar: "Temperature rise per kPa",
    unitHard: "K/kPa",
    unitEasy: "K/kPa",
    hardMeaning: "How far the weighted piston rises, divided by the disorder the heat added.",
    easyMeaning: "How much the thermometer climbs per kPa when the insulated gas is squeezed.",
    running: (T, dT) => `Left: a weight holds the pressure while heat flows in and is counted (from ${Math.round(T)} K, ${deg(dT)}). Right: insulated and squeezed, it warms.`,
    leftTag: "Heat flowing in",
    rightTag: "Insulated: no heat in",
  },
};

/** Where the hero should land on screen (CSS px). */
export interface Layout {
  /** Hero region. */
  x: number;
  y: number;
  w: number;
  h: number;
  phone: boolean;
}

export type Pick = "handle" | "thermo" | "plaque-hard" | "plaque-easy" | "plaque-land" | null;
export type Focus = "whole" | "hard" | "easy" | "land";

/** Screen anchors for HTML labels (client px). */
export type Anchors = Record<string, { x: number; y: number; on: boolean } | undefined>;

export interface View {
  readonly kind: "webgl" | "2d";
  readonly canvas: HTMLCanvasElement;
  resize(w: number, h: number, layout: Layout): void;
  render(dt: number, model: Model): void;
  anchors(): Anchors;
  pick(clientX: number, clientY: number): Pick;
  /** Pixels of vertical drag per natural-log unit of volume when dragging the piston handle. */
  handlePixelsPerLogV(): number;
  orbit(dx: number, dy: number): void;
  release(): void;
  zoom(f: number): void;
  poke(): void;
  focus(f: Focus): void;
  setStepped?(on: boolean): void;
  /** Tests: GPU resource counts. */
  stats?(): Record<string, number>;
  dispose(): void;
}

export function fmt(x: number, sig = 4): string {
  if (!Number.isFinite(x)) return "—";
  const a = Math.abs(x);
  if (a >= 1000 && a < 1e6) return Math.round(x).toString().replace("-", "−");
  if (a !== 0 && (a >= 1e6 || a < 1e-3)) {
    const e = Math.floor(Math.log10(a));
    const m = x / Math.pow(10, e);
    return `${m.toFixed(sig - 1)}×10${sup(e)}`;
  }
  return x.toPrecision(sig).replace("-", "−");
}
const SUP: Record<string, string> = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
const sup = (e: number) => String(e).split("").map((c) => SUP[c] ?? c).join("");
