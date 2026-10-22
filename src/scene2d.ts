/**
 * Canvas2D fallback ("simple mode"): the same bench drawn flat. Two cylinder diagrams with pistons,
 * heat sparks and dials, the two bars under an equals bracket, and a contour map of the current
 * potential with the bead, slope arrows, critical star and the "show why" loop.
 */
import { T_MAX, T_MIN, V_MAX, V_MIN, makeRng } from "./physics";
import { CONTOUR_LEVELS, NT, NV, POTENTIAL_NAME, buildLandscape, contourSegments, heightColor, naturalSpan, naturalSteps, type Landscape } from "./landscape";
import { RUN_S, type Model } from "./model";
import { CYAN, GOLD, ORANGE, RELATIONS, TEAL, VIOLET, type Anchors, type Focus, type Layout, type Pick, type View } from "./view";

/** Half-width of the map window in landscape units. */
const MAPR = 1.12;
const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class Scene2D implements View {
  readonly kind = "2d" as const;
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private layout: Layout = { x: 0, y: 0, w: 1, h: 1, phone: false };
  private land: Landscape | null = null;
  private key = -1;
  private map: HTMLCanvasElement | null = null;
  private anch: Anchors = {};
  private time = 0;
  private parts: { x: number; y: number; vx: number; vy: number }[][] = [[], []];
  private rng = makeRng(9);
  private boxes: { left: Box; right: Box; bars: Box; land: Box; thermo: { x: number; y: number; r: number } } | null = null;
  private gasLv = [0.4, 0.4];

  constructor(container: HTMLElement) {
    const c = document.createElement("canvas");
    c.id = "canvas";
    c.setAttribute("aria-label", "Simple diagram of the bench: two gas cylinders, two bars and a contour map of the energy landscape.");
    container.appendChild(c);
    this.canvas = c;
    this.ctx = c.getContext("2d")!;
    for (const arr of this.parts)
      for (let i = 0; i < 70; i++) {
        const a = this.rng() * Math.PI * 2;
        arr.push({ x: this.rng(), y: this.rng(), vx: Math.cos(a), vy: Math.sin(a) });
      }
  }

  resize(w: number, h: number, layout: Layout): void {
    this.w = w;
    this.h = h;
    this.layout = layout;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.map = null;
  }

  anchors(): Anchors {
    return this.anch;
  }

  pick(x: number, y: number): Pick {
    const b = this.boxes;
    if (!b) return null;
    const L = b.left;
    if (x > L.x - 10 && x < L.x + L.w + 10 && y > L.y - 30 && y < L.y + L.h) return "handle";
    const t = b.thermo;
    if (Math.hypot(x - t.x, y - t.y) < t.r + 8) return "thermo";
    return null;
  }

  handlePixelsPerLogV(): number {
    return Math.max(30, ((this.boxes?.left.h ?? 200) * 0.8) / Math.log(V_MAX / V_MIN));
  }

  orbit(): void {}
  release(): void {}
  zoom(): void {}
  poke(): void {}
  focus(_f: Focus): void {}

  private buildMap(model: Model, box: Box): void {
    const L = this.land!;
    const c = document.createElement("canvas");
    c.width = Math.max(2, Math.round(box.w * this.dpr));
    c.height = Math.max(2, Math.round(box.h * this.dpr));
    const g = c.getContext("2d")!;
    const P = L.pos;
    const sx = (x: number) => ((x + MAPR) / (2 * MAPR)) * c.width;
    const sz = (z: number) => ((MAPR - z) / (2 * MAPR)) * c.height;
    // filled cells, coloured by height (violet glass, gold where the gas would split)
    for (let i = 0; i < NT - 1; i++)
      for (let j = 0; j < NV - 1; j++) {
        const k = i * NV + j;
        const ks = [k, k + NV, k + NV + 1, k + 1];
        const t = Math.max(0, Math.min(1, ks.reduce((s, q) => s + P[q * 3 + 1], 0) / 4));
        const hc = heightColor(t, !!L.unstable[k]);
        g.fillStyle = `rgb(${Math.round(hc[0] * 255)},${Math.round(hc[1] * 255)},${Math.round(hc[2] * 255)})`;
        g.beginPath();
        ks.forEach((q, n) => (n ? g.lineTo(sx(P[q * 3]), sz(P[q * 3 + 2])) : g.moveTo(sx(P[q * 3]), sz(P[q * 3 + 2]))));
        g.closePath();
        g.fill();
        g.strokeStyle = g.fillStyle;
        g.lineWidth = 1;
        g.stroke();
      }
    // grid lines: constant temperature (cyan) and constant volume (violet)
    g.lineWidth = Math.max(1, this.dpr);
    const line = (ks: number[], col: string) => {
      g.strokeStyle = col;
      g.beginPath();
      ks.forEach((q, n) => (n ? g.lineTo(sx(P[q * 3]), sz(P[q * 3 + 2])) : g.moveTo(sx(P[q * 3]), sz(P[q * 3 + 2]))));
      g.stroke();
    };
    for (let i = 0; i < NT; i += 7) line(Array.from({ length: NV }, (_, j) => i * NV + j), "rgba(255,255,255,0.22)");
    for (let j = 0; j < NV; j += 7) line(Array.from({ length: NT }, (_, i) => i * NV + j), "rgba(255,255,255,0.22)");
    // height contours: dark ink lines of equal energy
    const seg = new Float32Array(CONTOUR_LEVELS.length * NT * NV * 4 * 3);
    const nf = contourSegments(P, CONTOUR_LEVELS, seg);
    g.strokeStyle = "rgba(14,10,22,0.85)";
    g.lineWidth = Math.max(1.2, 1.4 * this.dpr);
    g.beginPath();
    for (let q = 0; q < nf; q += 6) {
      g.moveTo(sx(seg[q]), sz(seg[q + 2]));
      g.lineTo(sx(seg[q + 3]), sz(seg[q + 5]));
    }
    g.stroke();
    this.map = c;
    void model;
  }

  private toMap(box: Box, x: number, z: number): { x: number; y: number } {
    return { x: box.x + ((x + MAPR) / (2 * MAPR)) * box.w, y: box.y + ((MAPR - z) / (2 * MAPR)) * box.h };
  }

  render(dt: number, model: Model): void {
    this.time += dt;
    const g = this.ctx;
    const { w, h, dpr } = this;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "#0a1020");
    bg.addColorStop(1, "#05070b");
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);

    const L = this.layout;
    const phone = L.phone;
    // layout: bench row (cyl, bars, cyl) and the map
    let left: Box, right: Box, bars: Box, land: Box;
    if (phone) {
      const mapH = L.h * 0.42;
      land = { x: L.x + L.w * 0.18, y: L.y + 6, w: L.w * 0.64, h: mapH - 12 };
      const rowY = L.y + mapH + 14, rowH = L.h - mapH - 24;
      const cw = Math.min(L.w * 0.2, rowH * 0.42);
      left = { x: L.x + L.w * 0.16 - cw / 2, y: rowY + 24, w: cw, h: rowH - 30 };
      right = { x: L.x + L.w * 0.7 - cw / 2, y: rowY + 24, w: cw, h: rowH - 30 };
      bars = { x: L.x + L.w * 0.43 - 30, y: rowY + 30, w: 60, h: rowH - 40 };
    } else {
      const cw = Math.min(L.w * 0.1, L.h * 0.2);
      const rowH = L.h * 0.5, rowY = L.y + L.h * 0.34;
      left = { x: L.x + L.w * 0.08, y: rowY, w: cw, h: rowH };
      bars = { x: L.x + L.w * 0.08 + cw + L.w * 0.06, y: rowY + rowH * 0.05, w: 60, h: rowH * 0.95 };
      right = { x: bars.x + 60 + L.w * 0.06, y: rowY, w: cw, h: rowH };
      const mx = right.x + cw + L.w * 0.14;
      const mw = Math.min(L.x + L.w - mx - 10, L.h * 0.62);
      land = { x: mx, y: L.y + L.h * 0.22, w: mw, h: mw };
    }
    const thermo = { x: right.x + right.w + (phone ? 26 : 40), y: right.y + right.h * 0.78, r: phone ? 20 : 30 };
    this.boxes = { left, right, bars, land, thermo };

    const rel = RELATIONS[model.relation];
    const runT = model.runT, running = runT >= 0;
    const slide = running ? ease((runT - 0.3) / 1.0) * (1 - ease((runT - (RUN_S - 0.35)) / 0.35)) : 0;
    const heat = running ? ease((runT - 0.2) / 0.3) * (1 - ease((runT - 1.85) / 0.4)) : 0;
    const base = Math.log(model.V / V_MIN) / Math.log(V_MAX / V_MIN);
    const dirs = {
      left: rel.left === "bath-expand" || rel.left === "weight-heat" ? 1 : rel.left === "bath-squeeze" ? -1 : 0,
      right: rel.right === "insulated-expand" || rel.right === "weight-warm" ? 1 : rel.right === "insulated-squeeze" ? -1 : 0,
    };
    const tf = Math.log(model.T / T_MIN) / Math.log(T_MAX / T_MIN);
    const gasCol = `rgb(255,${Math.round(150 + 90 * tf)},${Math.round(60 + 160 * tf)})`;
    const cyl = (b: Box, idx: number, dir: number, heatOn: boolean, lock: boolean, weight: boolean, insulated: boolean) => {
      const target = 0.12 + 0.8 * base + dir * 0.06 * slide;
      this.gasLv[idx] += (target - this.gasLv[idx]) * (1 - Math.exp(-dt * 10));
      const lv = this.gasLv[idx];
      const floorY = b.y + b.h - 10;
      const gasTop = floorY - lv * (b.h - 30);
      // tray
      g.fillStyle = heatOn && heat > 0 ? `rgba(255,120,40,${0.3 + 0.6 * heat})` : "#6b3a22";
      g.fillRect(b.x - 10, floorY, b.w + 20, 8);
      // gas
      g.fillStyle = "rgba(255,160,70,0.08)";
      g.fillRect(b.x, gasTop, b.w, floorY - gasTop);
      const sp = Math.sqrt(model.T / 300) * 0.35;
      g.fillStyle = gasCol;
      for (const p of this.parts[idx]) {
        p.x += p.vx * sp * dt;
        p.y += p.vy * sp * dt;
        if (p.x < 0 || p.x > 1) (p.vx *= -1), (p.x = Math.max(0, Math.min(1, p.x)));
        if (p.y < 0 || p.y > 1) (p.vy *= -1), (p.y = Math.max(0, Math.min(1, p.y)));
        g.beginPath();
        g.arc(b.x + 3 + p.x * (b.w - 6), gasTop + 3 + p.y * (floorY - gasTop - 6), 1.8, 0, Math.PI * 2);
        g.fill();
      }
      // sparks
      if (heatOn && heat > 0.05) {
        g.fillStyle = ORANGE;
        for (let k = 0; k < 10; k++) {
          const ph = (this.time * 1.4 + k / 10) % 1;
          const yy = rel.left === "bath-squeeze" && idx === 0 ? gasTop + ph * (floorY - gasTop) : floorY - ph * (floorY - gasTop);
          g.globalAlpha = heat * (1 - ph);
          g.beginPath();
          g.arc(b.x + ((k * 37) % 100) / 100 * b.w, yy, 2.4, 0, Math.PI * 2);
          g.fill();
        }
        g.globalAlpha = 1;
      }
      // glass
      g.strokeStyle = insulated ? "rgba(200,220,255,0.75)" : "rgba(200,225,255,0.5)";
      g.lineWidth = insulated ? 4 : 2;
      g.strokeRect(b.x, b.y, b.w, b.h - 10);
      // piston + rod + handle
      g.fillStyle = "#c9a15a";
      g.fillRect(b.x + 2, gasTop - 12, b.w - 4, 12);
      g.fillRect(b.x + b.w / 2 - 2, gasTop - 12 - (b.h - 20) * 0.95, 4, (b.h - 20) * 0.95);
      const hy = gasTop - 12 - (b.h - 20) * 0.95;
      g.fillRect(b.x + b.w / 2 - 12, hy - 8, 24, 8);
      if (lock) {
        g.fillStyle = GOLD;
        g.fillRect(b.x + b.w / 2 + 3, b.y - 6, 18, 4);
      }
      if (weight) {
        g.fillStyle = "#b8904a";
        g.fillRect(b.x + b.w / 2 - 16, hy - 22, 32, 14);
      }
      return { gasTop, hy };
    };
    const lr = cyl(left, 0, dirs.left, true, rel.left === "lock-heat", rel.left === "weight-heat", false);
    const rr = cyl(right, 1, dirs.right, rel.right === "lock-warm" || rel.right === "weight-warm", rel.right === "lock-warm", rel.right === "weight-warm", rel.right.startsWith("insulated"));

    // dials
    const dial = (x: number, y: number, r: number, f: number, label: string) => {
      g.fillStyle = "#efe4cc";
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "#c9a15a";
      g.lineWidth = 3;
      g.stroke();
      const a = Math.PI * 0.75 + Math.PI * 1.5 * Math.max(0, Math.min(1, f));
      g.strokeStyle = "#c0281e";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * r * 0.8, y + Math.sin(a) * r * 0.8);
      g.stroke();
      g.fillStyle = "#3a2a18";
      g.font = `600 ${Math.max(8, r * 0.32)}px Georgia, serif`;
      g.textAlign = "center";
      g.fillText(label, x, y + r * 0.6);
    };
    const swing = running ? 0.08 * ease((runT - 0.35) / 0.9) * (1 - ease((runT - (RUN_S - 0.3)) / 0.3)) : 0;
    dial(thermo.x, thermo.y, thermo.r, (model.T - 150) / 750 + (rel.right === "insulated-expand" ? -swing : swing), "K");
    const gx = right.x + right.w / 2 - (phone ? 0 : 0), gy = right.y - (phone ? 30 : 46);
    const pf = (Math.log10(Math.max(1, model.P)) - 1) / 4;
    dial(gx - right.w * 0.6, gy, phone ? 16 : 24, pf + (rel.right === "weight-warm" ? 0 : rel.right === "insulated-expand" ? -swing : swing), "kPa");

    // bars
    const lv = [model.barHard, model.barEasy];
    const bw = 16;
    const bx = [bars.x + bars.w / 2 - 18 - bw / 2, bars.x + bars.w / 2 + 18 - bw / 2];
    lv.forEach((l, i) => {
      g.strokeStyle = "rgba(220,235,255,0.5)";
      g.lineWidth = 1.5;
      g.strokeRect(bx[i], bars.y, bw, bars.h);
      const hh = l * bars.h;
      g.fillStyle = i ? TEAL : ORANGE;
      g.shadowColor = i ? TEAL : ORANGE;
      g.shadowBlur = 12;
      g.fillRect(bx[i] + 2, bars.y + bars.h - hh, bw - 4, hh);
      g.shadowBlur = 0;
    });
    const topY = bars.y + bars.h - Math.max(lv[0], lv[1]) * bars.h - 14;
    const matched = model.measured && !running && model.live.matchPct > 99;
    const flash = Math.exp(-model.matchAge * 2.2);
    g.strokeStyle = matched || flash > 0.05 ? CYAN : "#c9a15a";
    g.shadowColor = CYAN;
    g.shadowBlur = matched ? 10 + flash * 20 : 0;
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(bx[0] + bw / 2, topY + 8);
    g.lineTo(bx[0] + bw / 2, topY);
    g.lineTo(bx[1] + bw / 2, topY);
    g.lineTo(bx[1] + bw / 2, topY + 8);
    g.stroke();
    g.font = "700 16px system-ui, sans-serif";
    g.fillStyle = matched ? CYAN : "#c9a15a";
    g.textAlign = "center";
    g.fillText("=", bars.x + bars.w / 2, topY - 4);
    g.shadowBlur = 0;

    // landscape contour map
    if (this.key !== model.shapeKey || !this.land) {
      this.key = model.shapeKey;
      this.land = buildLandscape(model.pot, model.gas);
      this.map = null;
    }
    if (!this.map) this.buildMap(model, land);
    g.drawImage(this.map!, land.x, land.y, land.w, land.h);
    g.strokeStyle = "rgba(180,140,255,0.6)";
    g.lineWidth = 1;
    g.strokeRect(land.x, land.y, land.w, land.h);
    const m = this.land.map(model.T, model.V);
    const bp = this.toMap(land, m[0], m[2]);
    const span = naturalSpan(model.pot, model.gas);
    const sg = model.pot === "G" || model.pot === "H" ? -1 : 1;
    const st = naturalSteps(model.pot, model.gas, model.T, model.V, span[0] * 0.06, sg * span[1] * 0.06);
    const arrow = (s: [number, number], col: string) => {
      const q = this.land!.map(s[0], s[1]);
      const p = this.toMap(land, q[0], q[2]);
      const dx = p.x - bp.x, dy = p.y - bp.y, n = Math.hypot(dx, dy) || 1;
      const ex = bp.x + (dx / n) * 30, ey = bp.y + (dy / n) * 30;
      g.strokeStyle = col;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(bp.x, bp.y);
      g.lineTo(ex, ey);
      g.stroke();
      return { x: ex, y: ey };
    };
    const t1 = arrow(st.s1, CYAN);
    const t2 = arrow(st.s2, VIOLET);
    let why: { a: { x: number; y: number; on: boolean }; b: { x: number; y: number; on: boolean }; c: { x: number; y: number; on: boolean } } | null = null;
    if (model.showWhy) {
      const q = naturalSteps(model.pot, model.gas, model.T, model.V, span[0] * 0.13, sg * span[1] * 0.16);
      const pt = (s: [number, number]) => {
        const r = this.land!.map(s[0], s[1]);
        return this.toMap(land, r[0], r[2]);
      };
      const c1 = pt(q.s1), c2 = pt(q.s2), c12 = pt(q.s12);
      g.lineWidth = 3;
      g.strokeStyle = ORANGE;
      g.beginPath();
      g.moveTo(bp.x, bp.y);
      g.lineTo(c1.x, c1.y);
      g.lineTo(c12.x, c12.y);
      g.stroke();
      g.strokeStyle = TEAL;
      g.beginPath();
      g.moveTo(bp.x, bp.y);
      g.lineTo(c2.x, c2.y);
      g.lineTo(c12.x, c12.y);
      g.stroke();
      g.fillStyle = GOLD;
      g.beginPath();
      g.arc(c12.x, c12.y, 5, 0, Math.PI * 2);
      g.fill();
      why = { a: { x: (bp.x + c1.x) / 2, y: (bp.y + c1.y) / 2, on: true }, b: { x: (bp.x + c2.x) / 2, y: (bp.y + c2.y) / 2, on: true }, c: { ...c12, on: true } };
    }
    // current state: white dot with a dark ring
    g.fillStyle = "#ffffff";
    g.strokeStyle = "#120c1c";
    g.lineWidth = 3;
    g.beginPath();
    g.arc(bp.x, bp.y, 7, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    // axis labels, drawn just inside the map's bottom and right edges (the left edge is busy with labels on phones) (outlined so they read on any colour)
    {
      const ax = POTENTIAL_NAME[model.pot].axes;
      const lab = (t: string, x: number, y: number) => {
        g.strokeText(t, x, y);
        g.fillText(t, x, y);
      };
      g.save();
      g.font = "700 12px system-ui, sans-serif";
      g.fillStyle = "#fff2cf";
      g.strokeStyle = "rgba(14,10,22,0.9)";
      g.lineWidth = 3.5;
      g.lineJoin = "round";
      g.textAlign = "center";
      g.textBaseline = "bottom";
      lab(`${ax[0]} →`, land.x + land.w / 2, land.y + land.h - 3);
      g.translate(land.x + land.w - 4, land.y + land.h / 2);
      g.rotate(-Math.PI / 2);
      g.textBaseline = "bottom";
      lab(ax[1] === "pressure" ? "← pressure" : `${ax[1]} →`, 0, 0);
      g.restore();
    }
    const c = model.crit;
    let critA: { x: number; y: number; on: boolean } | undefined;
    if (c && c.Tc >= T_MIN && c.Tc <= T_MAX) {
      const q = this.land.map(c.Tc, c.Vc);
      const p = this.toMap(land, q[0], q[2]);
      g.fillStyle = "#fff6d0";
      g.shadowColor = GOLD;
      g.shadowBlur = 14;
      g.beginPath();
      g.arc(p.x, p.y, 4, 0, Math.PI * 2);
      g.fill();
      g.shadowBlur = 0;
      critA = { ...p, on: true };
    }
    let unA: { x: number; y: number; on: boolean } | undefined;
    {
      let cx = 0, cz = 0, n = 0;
      for (let k = 0; k < NT * NV; k++)
        if (this.land.unstable[k]) {
          cx += this.land.pos[k * 3];
          cz += this.land.pos[k * 3 + 2];
          n++;
        }
      if (n > 20) unA = { ...this.toMap(land, cx / n, cz / n), on: true };
    }
    const on = (x: number, y: number) => ({ x, y, on: true });
    this.anch = {
      hardTitle: on(left.x + left.w / 2, Math.min(lr.hy, left.y) - 14),
      easyTitle: on(right.x + right.w / 2, gy - 30),
      heat: on(left.x + left.w / 2, left.y + left.h),
      rightTag: on(right.x + right.w / 2 + 14, rel.right === "lock-warm" ? right.y - 4 : rel.right === "weight-warm" ? rr.hy - 15 : right.y + right.h / 2),
      leftTag2: rel.left === "lock-heat" ? on(left.x + left.w / 2 + 14, left.y - 4) : rel.left === "weight-heat" ? on(left.x + left.w / 2, lr.hy - 15) : undefined,
      gauge: on(gx - right.w * 0.6, gy),
      thermo: on(thermo.x, thermo.y),
      barHard: on(bx[0] + bw / 2, bars.y + bars.h - lv[0] * bars.h),
      barEasy: on(bx[1] + bw / 2, bars.y + bars.h - lv[1] * bars.h),
      bracket: on(bars.x + bars.w / 2, topY),
      landscape: on(land.x + land.w / 2, land.y),
      bead: on(bp.x, bp.y),
      crit: critA,
      unstable: unA,
      slope1: on(t1.x, t1.y),
      slope2: on(t2.x, t2.y),
      whyA: why?.a,
      whyB: why?.b,
      whyC: why?.c,
    };
  }

  dispose(): void {
    this.canvas.remove();
  }
}
