import "./styles.css";
import { Model } from "./model";
import { GAS_INFO, R, V_MAX, V_MIN, selfTest, type GasId, type Relation } from "./physics";
import { POTENTIAL_NAME } from "./landscape";
import { Scene2D } from "./scene2d";
import { RELATIONS, fmt, type Anchors, type Focus, type Layout, type View } from "./view";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const params = new URLSearchParams(location.search);
const recording = params.get("record") === "1";
if (recording) document.documentElement.classList.add("ix-record");
const force2d = params.get("renderer") === "2d";

const model = new Model();
const stage = $("stage");
let view: View;
let frames = 0;
let fps = 60;

// ───────────────────────── renderer selection ─────────────────────────

async function makeWebGL(): Promise<View> {
  const probe = document.createElement("canvas");
  const ctx = probe.getContext("webgl2") || probe.getContext("webgl");
  if (!ctx) throw new Error("WebGL unavailable");
  (ctx.getExtension("WEBGL_lose_context") as { loseContext?: () => void } | null)?.loseContext?.();
  const { Scene3D } = await import("./scene3d");
  return new Scene3D(stage, { hq: recording });
}

function switchTo2D(reason: string): void {
  if (view?.kind === "2d") return;
  console.warn(`[maxwell-relations] using Canvas2D fallback: ${reason}`);
  try {
    view?.dispose();
  } catch {
    /* ignore */
  }
  stage.querySelectorAll("canvas").forEach((c) => c.remove());
  view = new Scene2D(stage);
  $("badge").hidden = false;
  bindCanvas(view.canvas);
  onResize();
}

async function boot(): Promise<void> {
  if (force2d) {
    view = new Scene2D(stage);
    $("badge").hidden = false;
    bindCanvas(view.canvas);
    onResize();
  } else {
    try {
      view = await makeWebGL();
      view.canvas.addEventListener("webglcontextlost", (e) => {
        e.preventDefault();
        switchTo2D("webglcontextlost");
      });
      bindCanvas(view.canvas);
      onResize();
      view.render(1 / 60, model); // compile now so init errors surface here
    } catch (err) {
      switchTo2D(`WebGL init failed: ${(err as Error)?.message ?? err}`);
    }
  }
  window.__ixRecord.ready = true;
  requestAnimationFrame(loop);
}

// ───────────────────────── layout ─────────────────────────

const dock = $("dock");
const adv = $("adv");
const intro = $("intro");
const isPhone = () => innerWidth <= 760;

function computeLayout(w: number, h: number): Layout {
  if (isPhone()) {
    const top = intro.getBoundingClientRect().bottom + 4;
    const bottom = (adv.hidden ? dock : adv).getBoundingClientRect().top - (adv.hidden ? 4 : dock.offsetHeight + 4);
    return { x: 6, y: top, w: w - 12, h: Math.max(160, bottom - top), phone: true };
  }
  const left = dock.getBoundingClientRect().right + 8;
  const right = adv.hidden ? w - 12 : adv.getBoundingClientRect().left - 8;
  return { x: left, y: h * 0.1, w: Math.max(240, right - left), h: h * 0.8, phone: false };
}

let layoutKey = "";
function onResize(): void {
  const w = innerWidth, h = innerHeight;
  const phoneAdv = isPhone() && !adv.hidden;
  dock.classList.toggle("mini", phoneAdv);
  dock.style.bottom = phoneAdv ? `${adv.offsetHeight}px` : "";
  const L = computeLayout(w, h);
  layoutKey = `${w}|${h}|${Math.round(L.x)}|${Math.round(L.y)}|${Math.round(L.w)}|${Math.round(L.h)}`;
  view?.resize(w, h, L);
}
/** Panels settle (fonts, entrance animations, sheets opening): re-measure now and then. */
function checkLayout(): void {
  const w = innerWidth, h = innerHeight;
  const L = computeLayout(w, h);
  const k = `${w}|${h}|${Math.round(L.x)}|${Math.round(L.y)}|${Math.round(L.w)}|${Math.round(L.h)}`;
  if (k !== layoutKey) onResize();
}
addEventListener("resize", onResize);

// ───────────────────────── pointer: orbit / drag piston / drag thermometer / plaques ─────────────────────────

let drag: { id: number; x: number; y: number; x0: number; y0: number; kind: "orbit" | "handle" | "thermo"; moved: boolean; v0: number; t0: number } | null = null;
const touches = new Map<number, { x: number; y: number }>();
let pinch0 = 0;

function userTouched(): void {
  model.stopWow();
}

function bindCanvas(c: HTMLCanvasElement): void {
  c.addEventListener("pointerdown", (e) => {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) {
      const [a, b] = [...touches.values()];
      pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
      drag = null;
      return;
    }
    const hit = view.pick(e.clientX, e.clientY);
    const kind = hit === "handle" ? "handle" : hit === "thermo" ? "thermo" : "orbit";
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, kind, moved: false, v0: model.V, t0: model.T };
    c.setPointerCapture(e.pointerId);
    c.classList.add("grabbing");
    view.poke();
  });
  c.addEventListener("pointermove", (e) => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) {
      const [a, b] = [...touches.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch0 > 0) view.zoom(pinch0 / d);
      pinch0 = d;
      return;
    }
    if (!drag || drag.id !== e.pointerId) {
      if (!drag) {
        const hit = view.pick(e.clientX, e.clientY);
        c.style.cursor = hit === "handle" ? "ns-resize" : hit === "thermo" ? "ew-resize" : hit ? "pointer" : "";
      }
      return;
    }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 4) drag.moved = true;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (drag.kind === "orbit") view.orbit(dx, dy);
    else if (drag.kind === "handle") {
      userTouched();
      const ppl = view.handlePixelsPerLogV();
      model.setV(drag.v0 * Math.exp(-(e.clientY - drag.y0) / ppl));
      touchedState();
    } else {
      userTouched();
      model.setT(drag.t0 + (e.clientX - drag.x0 - (e.clientY - drag.y0)) * 2);
      touchedState();
    }
  });
  const up = (e: PointerEvent) => {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch0 = 0;
    if (drag && drag.id === e.pointerId) {
      if (!drag.moved && drag.kind === "orbit") {
        const hit = view.pick(e.clientX, e.clientY);
        if (hit === "plaque-hard") setFocus("hard");
        else if (hit === "plaque-easy") setFocus("easy");
        else if (hit === "plaque-land") setFocus("land");
      }
      drag = null;
      view.release();
      c.classList.remove("grabbing");
    }
  };
  c.addEventListener("pointerup", up);
  c.addEventListener("pointercancel", up);
  c.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      view.zoom(Math.exp(e.deltaY * 0.0012));
    },
    { passive: false },
  );
}

const wholeBtn = $("btn-whole");
function setFocus(f: Focus): void {
  view.focus(f);
  wholeBtn.hidden = f === "whole";
  // the chip takes the simple-mode badge's spot while a close-up is on
  document.documentElement.classList.toggle("ix-focused", f !== "whole");
}
wholeBtn.addEventListener("click", () => setFocus("whole"));

// ───────────────────────── controls ─────────────────────────

const temp = $<HTMLInputElement>("temp");
const volume = $<HTMLInputElement>("volume");
const gasSel = $<HTMLSelectElement>("gas");
const attract = $<HTMLInputElement>("attract");
const size = $<HTMLInputElement>("size");
const showWhy = $<HTMLInputElement>("show-why");
const stepIn = $<HTMLInputElement>("step");
const relBtns = ([1, 2, 3, 4] as Relation[]).map((r) => $(`rel-${r}`));

const vToSlider = (V: number) => Math.round((1000 * Math.log(V / V_MIN)) / Math.log(V_MAX / V_MIN));
const sliderToV = (x: number) => V_MIN * Math.pow(V_MAX / V_MIN, x / 1000);
const fracToSlider = (f: number) => Math.round(40 * Math.log10(f / 0.001));
const sliderToFrac = (x: number) => 0.001 * Math.pow(10, x / 40);

function setRange(el: HTMLInputElement, v: number): void {
  el.value = String(v);
  const min = +el.min, max = +el.max;
  el.style.setProperty("--p", `${(((+el.value - min) / (max - min)) * 100).toFixed(2)}%`);
}

/** The user changed the state by hand: the caption describes the change. */
function touchedState(): void {
  if (model.event.kind !== "tweak") model.event = { kind: "tweak", at: model.time };
  else model.event.at = model.time;
}

$("btn-run").addEventListener("click", () => {
  model.run();
});
temp.addEventListener("input", () => {
  userTouched();
  model.setT(+temp.value);
  touchedState();
});
volume.addEventListener("input", () => {
  userTouched();
  model.setV(sliderToV(+volume.value));
  touchedState();
});
$("btn-reset").addEventListener("click", () => {
  model.reset();
  setFocus("whole");
  showWhy.checked = false;
  syncControls(true);
});
gasSel.addEventListener("change", () => {
  model.setGas(gasSel.value as GasId);
});
const customInput = () => {
  userTouched();
  model.setCustom(+attract.value, +size.value);
  if (model.gasId !== "custom") model.setGas("custom");
};
attract.addEventListener("input", customInput);
size.addEventListener("input", customInput);
const cvBtns = [$("cv-mono"), $("cv-di")];
cvBtns.forEach((b, i) =>
  b.addEventListener("click", () => {
    userTouched();
    model.setCv(i ? 2.5 : 1.5);
    model.event = { kind: "cv", at: model.time };
  }),
);
relBtns.forEach((b, i) =>
  b.addEventListener("click", () => {
    userTouched();
    model.setRelation((i + 1) as Relation);
  }),
);
showWhy.addEventListener("change", () => {
  userTouched();
  model.showWhy = showWhy.checked;
  model.event = { kind: showWhy.checked ? "why" : "why-off", at: model.time };
  // frame the glass landscape so the two-path loop is legible; "Whole bench" returns
  setFocus(showWhy.checked ? "land" : "whole");
});
stepIn.addEventListener("input", () => {
  userTouched();
  model.frac = sliderToFrac(+stepIn.value);
  model.refresh();
  model.event = { kind: "step", at: model.time };
});
$("preset-critical").addEventListener("click", () => model.preset("critical"));
$("preset-cold").addEventListener("click", () => model.preset("cold"));
$("preset-hot").addEventListener("click", () => model.preset("hot"));

const advBtn = $("btn-advanced");
function setAdv(open: boolean): void {
  adv.hidden = !open;
  advBtn.setAttribute("aria-expanded", String(open));
  advBtn.classList.toggle("on", open);
  onResize();
}
advBtn.addEventListener("click", () => setAdv(adv.hidden));
$("btn-adv-close").addEventListener("click", () => setAdv(false));

/** Push model state into the controls (after presets, wow tweens, reset). */
let lastSync = "";
function syncControls(force = false): void {
  const k = `${Math.round(model.T)}|${model.V.toFixed(4)}|${model.gasId}|${model.relation}|${model.cvR}|${model.frac}|${model.showWhy}|${model.custom.a}|${model.custom.b}`;
  if (!force && k === lastSync) return;
  lastSync = k;
  if (sliderHeld !== temp || force) setRange(temp, Math.round(model.T));
  if (sliderHeld !== volume || force) setRange(volume, vToSlider(model.V));
  gasSel.value = model.gasId;
  setRange(attract, model.gasId === "custom" ? model.custom.a : model.gas.a || model.custom.a);
  setRange(size, model.gasId === "custom" ? model.custom.b : model.gas.b || model.custom.b);
  setRange(stepIn, fracToSlider(model.frac));
  showWhy.checked = model.showWhy;
  relBtns.forEach((b, i) => {
    const on = model.relation === i + 1;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  });
  const cvOn = model.cvR === 2.5 ? 1 : 0;
  cvBtns.forEach((b, i) => {
    b.classList.toggle("on", i === cvOn);
    b.setAttribute("aria-pressed", String(i === cvOn));
    (b as HTMLButtonElement).disabled = !(model.gasId === "ideal" || model.gasId === "custom");
  });
}
for (const el of [temp, volume, attract, size, stepIn]) el.addEventListener("input", () => setRange(el, +el.value));
/** The slider under the user's finger (not merely focused) is left alone by syncControls. */
let sliderHeld: HTMLInputElement | null = null;
for (const el of [temp, volume]) el.addEventListener("pointerdown", () => (sliderHeld = el));
addEventListener("pointerup", () => (sliderHeld = null), true);
addEventListener("pointercancel", () => (sliderHeld = null), true);

// ───────────────────────── intro card ─────────────────────────

const explain = $("explain");
const helpBtn = $("btn-help");
const INTRO_KEY = "maxwell-relations:intro-seen";

function setExplain(open: boolean, remember = true): void {
  if (explain.hidden === !open) return;
  explain.hidden = !open;
  helpBtn.setAttribute("aria-expanded", String(open));
  if (open) $("btn-explain-ok").focus({ preventScroll: true });
  else if (remember) {
    try {
      localStorage.setItem(INTRO_KEY, "1");
    } catch {
      /* private mode */
    }
  }
}
helpBtn.addEventListener("click", () => setExplain(explain.hidden));
$("btn-explain-x").addEventListener("click", () => setExplain(false));
$("btn-explain-ok").addEventListener("click", () => setExplain(false));
addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !explain.hidden) setExplain(false);
});
document.addEventListener(
  "pointerdown",
  (e) => {
    const t = e.target as Node;
    if (!explain.hidden && !explain.contains(t) && !helpBtn.contains(t)) setExplain(false);
  },
  true,
);
{
  let seen = false;
  try {
    seen = localStorage.getItem(INTRO_KEY) === "1";
  } catch {
    /* ignore */
  }
  if (!seen && !recording && params.get("intro") !== "0") setExplain(true, false);
}

// ───────────────────────── labels next to the objects ─────────────────────────

interface LabelDef {
  id: string;
  cls: string;
  /** Preferred direction from the anchor (screen px). */
  dir: [number, number];
  text: () => string | null;
}

const UNIT_WORDS: Record<Relation, string> = { 1: "kilopascals per kelvin", 2: "kelvin per litre", 3: "litres per kelvin", 4: "kelvin per kilopascal" };

const labelDefs: LabelDef[] = [
  { id: "hardTitle", cls: "title hard", dir: [0, -1], text: () => (isPhone() ? RELATIONS[model.relation].hardShort : RELATIONS[model.relation].hardTitle) },
  { id: "easyTitle", cls: "title easy", dir: [0, -1], text: () => (isPhone() ? RELATIONS[model.relation].easyShort : RELATIONS[model.relation].easyTitle) },
  { id: "heat", cls: "obj heat", dir: [-0.6, 1], text: () => RELATIONS[model.relation].leftTag },
  { id: "leftTag2", cls: "obj", dir: [-1, -0.3], text: () => (RELATIONS[model.relation].left === "lock-heat" ? "Locked piston" : "Weight keeps pressure fixed") },
  { id: "rightTag", cls: "obj", dir: [1, -0.4], text: () => RELATIONS[model.relation].rightTag },
  { id: "gauge", cls: "obj", dir: [1, -0.5], text: () => "Pressure gauge" },
  { id: "thermo", cls: "obj", dir: [0.7, 1], text: () => "Thermometer" },
  { id: "barHard", cls: "bar hard", dir: [-1, -0.25], text: () => barText(true) },
  { id: "barEasy", cls: "bar easy", dir: [1, -0.25], text: () => barText(false) },
  {
    id: "landscape",
    cls: "title land",
    dir: [0, -1],
    text: () => {
      const n = POTENTIAL_NAME[model.pot];
      return isPhone() ? `Energy landscape · ${model.pot}<small>${n.short}</small>` : `Energy landscape · ${n.title}<small>${n.meaning}</small>`;
    },
  },
  { id: "bead", cls: "obj bead", dir: [-0.8, -1], text: () => "You are here" },
  { id: "crit", cls: "obj crit", dir: [1, 0.6], text: () => "Critical point" },
  { id: "unstable", cls: "obj warn", dir: [0.3, 1], text: () => (model.gas.a > 0 ? "the gas would split into liquid and vapour here" : null) },
  { id: "slope1", cls: "obj slope s1", dir: [0.6, -0.8], text: () => (isPhone() || model.showWhy ? null : POTENTIAL_NAME[model.pot].slopes[0]) },
  { id: "slope2", cls: "obj slope s2", dir: [0.8, 0.5], text: () => (isPhone() || model.showWhy ? null : POTENTIAL_NAME[model.pot].slopes[1]) },
  { id: "whyA", cls: "obj why wa", dir: [0.2, 1], text: () => `${POTENTIAL_NAME[model.pot].axes[0]} first` },
  { id: "whyB", cls: "obj why wb", dir: [-1, 0.4], text: () => `${POTENTIAL_NAME[model.pot].axes[1]} first` },
  { id: "whyC", cls: "obj why wc", dir: [1, 0.2], text: () => "same corner, same height" },
];

const LAND_LABELS = new Set(["landscape", "bead", "crit", "whyA", "whyB", "whyC", "barHard", "barEasy"]);

function barText(hard: boolean): string {
  const rel = RELATIONS[model.relation];
  const name = hard ? rel.hardBar : rel.easyBar;
  const v = hard ? model.live.hard : model.live.easy;
  const shown = model.measured && (model.running ? model.fill > 0.02 : true);
  const val = shown ? `${fmt(v)} <i>${hard ? rel.unitHard : rel.unitEasy}</i>` : `<i>press Run</i>`;
  return `<span class="n">${name}</span><b>${val}</b>`;
}

const labelLayer = $("labels");
const leaders = document.getElementById("leaders") as unknown as SVGSVGElement;
const labelEls = new Map<string, { el: HTMLDivElement; html: string; w: number; h: number; line: SVGLineElement; dot: SVGCircleElement }>();
for (const d of labelDefs) {
  const el = document.createElement("div");
  el.className = `lbl3d ${d.cls}`;
  el.dataset.id = d.id;
  labelLayer.appendChild(el);
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  dot.setAttribute("r", "2.2");
  line.setAttribute("class", d.cls.split(" ").join("-"));
  leaders.append(line, dot);
  labelEls.set(d.id, { el, html: "", w: 0, h: 0, line, dot });
}

function obstacles(): DOMRect[] {
  const r: DOMRect[] = [];
  for (const el of [dock, adv, intro, explain, $("badge"), wholeBtn]) if (!el.hidden && el.offsetParent !== null) r.push(el.getBoundingClientRect());
  return r;
}

function layoutLabels(a: Anchors): void {
  const W = innerWidth, H = innerHeight;
  const phone = isPhone();
  const obs = obstacles();
  // anchors hidden behind a panel hide their label (the thin title row doesn't count)
  const ir = intro.getBoundingClientRect();
  const hide = obs.filter((r) => !(r.top === ir.top && r.left === ir.left && r.width === ir.width));
  // on a phone the title row spans the width: keep labels below it
  const top = phone ? intro.getBoundingClientRect().bottom + 2 : 4;
  // in Show why the two step paths are the point: labels may point at them but not sit on them
  const push = obs.slice();
  if (model.showWhy) {
    const pts = ["bead", "whyA", "whyB", "whyC"].map((id) => a[id]).filter((p) => p && p.on);
    if (pts.length > 1) {
      const xs = pts.map((p) => p!.x), ys = pts.map((p) => p!.y), m = 6;
      const l = Math.min(...xs) - m, t = Math.min(...ys) - m;
      push.push(new DOMRect(l, t, Math.max(...xs) + m - l, Math.max(...ys) + m - t));
    }
  }
  type B = { id: string; x: number; y: number; w: number; h: number; ax: number; ay: number };
  const boxes: B[] = [];
  for (const d of labelDefs) {
    const rec = labelEls.get(d.id)!;
    const an = a[d.id];
    const inside = an && an.on && an.x > 2 && an.x < W - 2 && an.y > 2 && an.y < H - 2 && !hide.some((r) => an.x > r.left && an.x < r.right && an.y > r.top && an.y < r.bottom);
    // a phone's Show-why close-up keeps only the landscape's own labels; bench labels would bury the two paths
    const benchOnly = phone && model.showWhy && !LAND_LABELS.has(d.id);
    const txt = inside && !benchOnly ? d.text() : null;
    if (!txt) {
      rec.el.style.display = "none";
      rec.line.style.display = rec.dot.style.display = "none";
      continue;
    }
    rec.el.style.display = "";
    if (txt !== rec.html) {
      rec.el.innerHTML = txt;
      rec.html = txt;
      rec.w = rec.el.offsetWidth;
      rec.h = rec.el.offsetHeight;
    }
    const off = phone ? 16 : 26;
    const [dx, dy] = d.dir;
    const n = Math.hypot(dx, dy) || 1;
    let x = an!.x + (dx / n) * off, y = an!.y + (dy / n) * off;
    // attach by the edge facing the anchor
    x -= dx > 0.3 ? 0 : dx < -0.3 ? rec.w : rec.w / 2;
    y -= dy > 0.3 ? 0 : dy < -0.3 ? rec.h : rec.h / 2;
    boxes.push({ id: d.id, x, y, w: rec.w, h: rec.h, ax: an!.x, ay: an!.y });
  }
  const pad = 3;
  for (let it = 0; it < 40; it++) {
    let moved = false;
    for (let i = 0; i < boxes.length; i++) {
      const p = boxes[i];
      for (let j = i + 1; j < boxes.length; j++) {
        const q = boxes[j];
        const ox = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x) + pad;
        const oy = Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y) + pad;
        if (ox > 0 && oy > 0) {
          moved = true;
          if (oy < ox) {
            const s = p.y + p.h / 2 < q.y + q.h / 2 ? -1 : 1;
            p.y += (s * oy) / 2;
            q.y -= (s * oy) / 2;
          } else {
            const s = p.x + p.w / 2 < q.x + q.w / 2 ? -1 : 1;
            p.x += (s * ox) / 2;
            q.x -= (s * ox) / 2;
          }
        }
      }
      // keep clear of the panels (and the Show-why paths) and inside the screen
      for (const r of push) {
        const ox = Math.min(p.x + p.w, r.right) - Math.max(p.x, r.left) + pad;
        const oy = Math.min(p.y + p.h, r.bottom) - Math.max(p.y, r.top) + pad;
        if (ox > 0 && oy > 0) {
          moved = true;
          // push out the cheapest way
          const opts = [
            { d: r.right + pad - p.x, ax: "x" },
            { d: r.left - pad - (p.x + p.w), ax: "x" },
            { d: r.bottom + pad - p.y, ax: "y" },
            { d: r.top - pad - (p.y + p.h), ax: "y" },
          ].sort((u, v) => Math.abs(u.d) - Math.abs(v.d));
          // prefer a direction that stays on screen (and below the title row on a phone)
          const fits = (o: { d: number; ax: string }) =>
            o.ax === "x" ? p.x + o.d >= 4 && p.x + o.d <= W - p.w - 4 : p.y + o.d >= top && p.y + o.d <= H - p.h - 4;
          const o = opts.find(fits) ?? opts[0];
          if (o.ax === "x") p.x += o.d;
          else p.y += o.d;
        }
      }
      const nx = Math.max(4, Math.min(W - p.w - 4, p.x)), ny = Math.max(top, Math.min(H - p.h - 4, p.y));
      if (nx !== p.x || ny !== p.y) {
        p.x = nx;
        p.y = ny;
      }
    }
    if (!moved) break;
  }
  // a label that still sits on a panel or an earlier label (tiny hero on a phone) is dropped, not stacked
  const hit = (b: B, x: number, y: number, w: number, h: number) => b.x < x + w - 2 && x < b.x + b.w - 2 && b.y < y + h - 2 && y < b.y + b.h - 2;
  const kept: B[] = [];
  for (const b of boxes) {
    const rec = labelEls.get(b.id)!;
    if (obs.some((r) => hit(b, r.left, r.top, r.width, r.height)) || kept.some((k) => hit(b, k.x, k.y, k.w, k.h))) {
      rec.el.style.display = "none";
      rec.line.style.display = rec.dot.style.display = "none";
      continue;
    }
    kept.push(b);
    rec.el.style.transform = `translate(${Math.round(b.x)}px, ${Math.round(b.y)}px)`;
    const cx = Math.max(b.x, Math.min(b.x + b.w, b.ax)), cy = Math.max(b.y, Math.min(b.y + b.h, b.ay));
    const far = Math.hypot(cx - b.ax, cy - b.ay) > 6;
    rec.line.style.display = far ? "" : "none";
    rec.dot.style.display = "";
    rec.line.setAttribute("x1", b.ax.toFixed(1));
    rec.line.setAttribute("y1", b.ay.toFixed(1));
    rec.line.setAttribute("x2", cx.toFixed(1));
    rec.line.setAttribute("y2", cy.toFixed(1));
    rec.dot.setAttribute("cx", b.ax.toFixed(1));
    rec.dot.setAttribute("cy", b.ay.toFixed(1));
  }
}

// ───────────────────────── caption + readouts ─────────────────────────

const captionText = $("caption-text");
const caption = $("caption");

function describeChange(): string | null {
  const ra = model.runAt;
  if (!ra || ra.relation !== model.relation || ra.gas !== model.gasId) return null;
  const dT = model.T - ra.T, dlnV = Math.log(model.V / ra.V);
  const parts: string[] = [];
  if (Math.abs(dT) > 3) parts.push(dT > 0 ? "Hotter" : "Colder");
  if (Math.abs(dlnV) > 0.03) parts.push(dlnV < 0 ? "squeezed" : "expanded");
  if (!parts.length) return null;
  const words = parts.join(" and ");
  const v = model.live.hard, v0 = ra.value;
  const verb = Math.abs(v) > Math.abs(v0) * 1.005 ? "grew to" : Math.abs(v) < Math.abs(v0) * 0.995 ? "shrank to" : "stay at";
  const head = words.charAt(0).toUpperCase() + words.slice(1);
  return `${head}: both numbers ${verb} ${fmt(v)}, and they still match.`;
}

function captionNow(): string {
  const rel = RELATIONS[model.relation];
  const ev = model.event, age = model.time - ev.at;
  const live = model.live;
  if (model.running) return rel.running(model.T, live.stepT);
  const gasName = GAS_INFO[model.gasId].name;
  const c = model.crit;
  const nearCrit = c && Math.abs(model.T / c.Tc - 1) < 0.08 && Math.abs(Math.log(model.V / c.Vc)) < 0.5;
  if (model.unstable) return `Below its critical temperature this state is unstable: real ${gasName.toLowerCase()} would split into liquid and vapour. The two ways still agree, ${fmt(live.hard)} each.`;
  if (ev.kind === "preset-critical" && age < 1 && !nearCrit) return `Carbon dioxide, heading for just above its critical point (${Math.round(c?.Tc ?? 304)} K): watch both bars climb together.`;
  if ((ev.kind === "wow-critical" || ev.kind === "preset-critical" || ev.kind === "gas") && nearCrit)
    return `${gasName} near its critical point: the numbers shoot up (${fmt(live.hard)}), but the two ways still agree.`;
  if (model.showWhy && (ev.kind === "why" || age > 6 || ev.kind === "matched"))
    return pot2Why();
  if (ev.kind === "preset-cold") return `Cold, squeezed argon: its molecules pull on each other, yet the hard way and the easy way agree: ${fmt(live.hard)} each.`;
  if (ev.kind === "preset-hot") return `Hot, thin argon behaves almost like an ideal gas: both ways give ${fmt(live.hard)}, close to R / V = ${fmt(R / model.V)}.`;
  if (ev.kind === "gas" && age < 6) return model.gasId === "ideal" ? "Ideal gas: point molecules that never attract. The landscape is smooth everywhere." : `${gasName}: real molecules attract and take up room, so the glass landscape reshapes. Run both experiments again.`;
  if (ev.kind === "relation" && age < 6) return `From ${rel.from}: ${rel.eq}. Press ‘Run both experiments’ to measure both sides.`;
  if (ev.kind === "step" && age < 6) return `Step ${(model.frac * 100).toPrecision(2)} %: the two ways differ by ${fmt(100 - live.matchPct, 2)} %, only because each step has finite size.`;
  if (model.measured) {
    const ch = describeChange();
    if (ch) return ch;
    if (model.relation === 1 || model.runAt) return `Hard way ${fmt(live.hard)}, easy way ${fmt(live.easy)} (${UNIT_WORDS[model.relation]}): exactly the same. That's a Maxwell relation.`;
  }
  if (model.relation !== 1) return `From ${rel.from}: ${rel.eq}. Press ‘Run both experiments’ to measure both sides.`;
  return "Two cylinders, same gas. Press ‘Run both experiments’ to measure one hard thing and one easy thing.";
}

function pot2Why(): string {
  const n = POTENTIAL_NAME[model.pot].axes;
  return `Step in ${n[1]} then ${n[0]}, or ${n[0]} then ${n[1]}: you land at the same height. That's why the swap works.`;
}

let capPrev = "";
let capShape = "";
const rP = $("r-P"), rHard = $("r-hard"), rEasy = $("r-easy"), rMatch = $("r-match");
const rHardL = $("r-hard-l"), rEasyL = $("r-easy-l"), rHardD = $("r-hard-d"), rEasyD = $("r-easy-d"), rMatchD = $("r-match-d");
const tempVal = $("temp-val"), volVal = $("volume-val");
let hudRel = 0;

function updateHud(): void {
  syncControls();
  const t = captionNow();
  if (t !== capPrev) {
    capPrev = t;
    captionText.textContent = t;
    // fade in only on a new sentence; live numbers ticking inside the same sentence must not restart it
    const shape = t.replace(/[-−]?[0-9.,×⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g, "#");
    if (shape !== capShape) {
      capShape = shape;
      caption.classList.remove("pulse");
      void caption.offsetWidth;
      caption.classList.add("pulse");
    }
  }
  caption.dataset.state = model.running ? "running" : model.measured ? "matched" : "idle";
  tempVal.textContent = `${Math.round(model.T)} K`;
  volVal.textContent = `${model.V < 1 ? model.V.toFixed(3) : model.V.toFixed(2)} L`;
  rP.textContent = `${fmt(model.P)} kPa`;
  const rel = RELATIONS[model.relation];
  if (hudRel !== model.relation) {
    hudRel = model.relation;
    $("rel-eq").innerHTML = rel.eq.replace(/_([A-Z])/g, "<sub>$1</sub>");
    rHardL.innerHTML = `${rel.hardBar} <span class="tag">hard way</span>`;
    rEasyL.innerHTML = `${rel.easyBar} <span class="tag">easy way</span>`;
    rHardD.textContent = rel.hardMeaning;
    rEasyD.textContent = rel.easyMeaning;
  }
  const live = model.live;
  const show = model.measured;
  rHard.textContent = show ? `${fmt(live.hard)} ${rel.unitHard}` : "— press Run";
  rEasy.textContent = show ? `${fmt(live.easy)} ${rel.unitEasy}` : "— press Run";
  const gap = 100 - live.matchPct;
  rMatch.textContent = show ? `${live.matchPct >= 99.9995 ? "99.999+" : live.matchPct.toFixed(3)} %` : "—";
  rMatch.classList.toggle("ok", show && gap < 0.1);
  rMatchD.textContent = show
    ? gap < 0.1
      ? `They agree to better than 0.1 % (gap ${fmt(gap, 2)} %). Tiny differences come only from the finite step size.`
      : `Gap ${fmt(gap, 2)} %: only the finite step size separates them. Shrink ‘Step size’ in Advanced.`
    : "How closely the two ways agree. Tiny differences come only from the finite step size.";
  // advanced
  $("gas-ab").textContent = model.gas.a > 0 ? `a ${model.gas.a.toFixed(0)} · b ${model.gas.b.toFixed(4)}` : "a 0 · b 0";
  $("attract-val").textContent = `${(+attract.value).toFixed(0)} kPa·L²`;
  $("size-val").textContent = `${(+size.value).toFixed(3)} L`;
  $("step-val").textContent = `${(model.frac * 100).toPrecision(2)} %`;
  const ex = model.exact;
  const err = (Math.abs(live.hard - ex) / Math.abs(ex)) * 100;
  $("step-err").textContent = `Gap between the hard way and the exact slope: ${fmt(err, 2)} %. Smaller steps, smaller gap.`;
  const cy = model.cyc;
  $("cyc").textContent = `${fmt(cy.a)} × ${fmt(cy.b)} × ${fmt(cy.c)} = ${cy.product.toFixed(4).replace("-", "−")}`;
  const cp = model.cp;
  $("cpcv").textContent = `${fmt(cp.fromEasy)} J/K from α, κ · ${fmt(cp.direct)} direct`;
  $("cpcv-d").textContent =
    model.gas.a === 0
      ? `Extra heat to warm it when it may expand, from how much it swells when warmed (α = ${fmt(cp.alpha, 3)} /K) and shrinks when squeezed (κ = ${fmt(cp.kappa, 3)} /kPa). Ideal gas: exactly R = 8.314.`
      : `Extra heat to warm it when it may expand, from α = ${fmt(cp.alpha, 3)} /K and κ = ${fmt(cp.kappa, 3)} /kPa. Ideal gas would give R = 8.314; near the critical point it soars.`;
}

// ───────────────────────── loop ─────────────────────────

let last = performance.now();
let fpsT = 0, fpsN = 0;
let stepped = false;

function loop(now: number): void {
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  if (!stepped) frame(dt);
  requestAnimationFrame(loop);
}

function frame(dt: number, draw = true): void {
  model.step(dt);
  if (draw && view) {
    try {
      view.render(dt, model);
    } catch (err) {
      if (view.kind === "webgl") switchTo2D(`render error: ${(err as Error)?.message ?? err}`);
      else throw err;
    }
    layoutLabels(view.anchors());
  }
  updateHud();
  if (frames % 10 === 0) checkLayout();
  frames++;
  const now = performance.now();
  if (!fpsT) fpsT = now;
  fpsN++;
  if (now - fpsT >= 500) {
    fps = (fpsN * 1000) / (now - fpsT);
    fpsT = now;
    fpsN = 0;
  }
}

// ───────────────────────── hooks ─────────────────────────

declare global {
  interface Window {
    __maxwellInfo: () => Record<string, unknown>;
    __maxwellSelfTest: () => ReturnType<typeof selfTest>;
    __maxwellAdvance: (seconds: number) => Record<string, unknown>;
    __maxwellFocus: (f: Focus) => void;
    __maxwellMem: () => Record<string, number>;
    __ixRecord: { ready: boolean; setStepped: (on: boolean) => void; stepFrame: (dt: number) => void };
  }
}
const r6 = (x: number) => (Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : x);
window.__maxwellInfo = () => ({
  renderer: view?.kind ?? "webgl",
  gas: model.gasId,
  relation: model.relation,
  T: r6(model.T),
  V: r6(model.V),
  P: r6(model.P),
  S: r6(model.S),
  hard: r6(model.live.hard),
  easy: r6(model.live.easy),
  matchPct: r6(model.live.matchPct),
  cyclic: r6(model.cyc.product),
  cpMinusCv: r6(model.cp.fromEasy),
  frames,
  fps: Math.round(fps * 10) / 10,
  measured: model.measured,
  running: model.running,
  wow: model.wowActive,
  showWhy: model.showWhy,
  step: model.frac,
  bars: [r6(model.barHard), r6(model.barEasy)],
  caption: captionText.textContent ?? "",
  nan: !model.finite(),
});
window.__maxwellSelfTest = () => selfTest();
window.__maxwellMem = () => view?.stats?.() ?? {};
/** Tests: frame part of the bench as if its plaque were clicked. */
window.__maxwellFocus = (f: Focus) => setFocus(f);
window.__maxwellAdvance = (seconds: number) => {
  for (let t = 0; t < seconds - 1e-9; t += 1 / 30) frame(1 / 30, false);
  return window.__maxwellInfo();
};
// Deterministic fixed-dt stepping for scripts/record-demo.mjs ("capture": "frames").
window.__ixRecord = {
  ready: false,
  setStepped(on: boolean) {
    stepped = on;
    if (on) setExplain(false, false);
    view?.setStepped?.(on);
  },
  stepFrame(dt: number) {
    frame(Math.min(0.1, Math.max(1 / 240, dt || 1 / 30)));
  },
};

syncControls(true);
void boot();
