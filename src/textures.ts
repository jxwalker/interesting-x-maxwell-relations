/** Procedural canvas textures: walnut, brushed brass, glow sprites, enamel dial faces, engraved plaques. */
import { makeRng } from "./physics";

export function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

function noise2(seed: number): (x: number, y: number) => number {
  const r = makeRng(seed);
  const N = 256;
  const t = Float32Array.from({ length: N * N }, () => r());
  const at = (i: number, j: number) => t[(j & (N - 1)) * N + (i & (N - 1))];
  return (x: number, y: number) => {
    const i = Math.floor(x), j = Math.floor(y);
    const fx = x - i, fy = y - j;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

/** Walnut grain (long figured stripes along u). */
export function walnut(w = 1024, h = 256, seed = 11): HTMLCanvasElement {
  const [c, g] = canvas(w, h);
  const img = g.createImageData(w, h);
  const n = noise2(seed), m = noise2(seed + 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h;
      const warp = n(u * 3, v * 7) * 2.4 + m(u * 16, v * 26) * 0.35;
      const ring = Math.sin((v * 22 + warp) * Math.PI);
      const fine = m(u * 260, v * 5) * 0.25;
      const k = 0.5 + 0.28 * Math.pow(ring * 0.5 + 0.5, 3) + fine * 0.6 + n(u * 2, v * 2) * 0.16;
      const o = (y * w + x) * 4;
      img.data[o] = 98 * k;
      img.data[o + 1] = 58 * k;
      img.data[o + 2] = 34 * k;
      img.data[o + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return c;
}

/** Brushed brass: fine horizontal streaks (colour map) and a matching roughness map. */
export function brushed(w = 512, h = 512, seed = 5): { color: HTMLCanvasElement; rough: HTMLCanvasElement } {
  const [c, g] = canvas(w, h);
  const [r, rg] = canvas(w, h);
  const img = g.createImageData(w, h);
  const rimg = rg.createImageData(w, h);
  const n = noise2(seed), m = noise2(seed + 9);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const streak = m(x / 140, y * 1.7) * 0.5 + n(x / 30, y * 0.9) * 0.2;
      const cloud = n(x / 120, y / 120);
      const k = 0.84 + streak * 0.14 + cloud * 0.08;
      const o = (y * w + x) * 4;
      img.data[o] = 236 * k;
      img.data[o + 1] = 190 * k;
      img.data[o + 2] = 118 * k;
      img.data[o + 3] = 255;
      const rr = 60 + streak * 70 + cloud * 30;
      rimg.data[o] = rimg.data[o + 1] = rimg.data[o + 2] = rr;
      rimg.data[o + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  rg.putImageData(rimg, 0, 0);
  return { color: c, rough: r };
}

/** Knurled grip (bump map): fine diagonal cross-hatch. */
export function knurl(size = 128): HTMLCanvasElement {
  const [c, g] = canvas(size, size);
  g.fillStyle = "#808080";
  g.fillRect(0, 0, size, size);
  g.strokeStyle = "#202020";
  g.lineWidth = 2;
  for (let k = -size; k < size * 2; k += 8) {
    g.beginPath();
    g.moveTo(k, 0);
    g.lineTo(k + size, size);
    g.moveTo(k + size, 0);
    g.lineTo(k, size);
    g.stroke();
  }
  return c;
}

/** Soft round glow sprite. */
export function dot(size = 64, hard = 0.3): HTMLCanvasElement {
  const [c, g] = canvas(size, size);
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(hard, "rgba(255,255,255,0.45)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  return c;
}

/** Four-point star glint. */
export function star(size = 128): HTMLCanvasElement {
  const [c, g] = canvas(size, size);
  const h = size / 2;
  const gr = g.createRadialGradient(h, h, 0, h, h, h);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(0.12, "rgba(255,255,255,0.6)");
  gr.addColorStop(0.4, "rgba(255,255,255,0.08)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = "lighter";
  for (const [w, l] of [[3, 0.98], [2, 0.7]] as const) {
    const lg = g.createLinearGradient(0, 0, size, 0);
    lg.addColorStop(0, "rgba(255,255,255,0)");
    lg.addColorStop(0.5, "rgba(255,255,255,0.95)");
    lg.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = lg;
    g.save();
    g.translate(h, h);
    for (let r = 0; r < 2; r++) {
      g.rotate((r ? Math.PI / 2 : 0) + (w === 2 ? Math.PI / 4 : 0));
      g.fillRect(-h * l, -w / 2, size * l, w);
    }
    g.restore();
  }
  return c;
}

/** Cream enamel dial face with ticks and numbers. `ticks` gives value fractions in [0, 1] with labels. */
export function dialFace(size: number, title: string, unit: string, ticks: { f: number; label?: string }[], red?: [number, number]): HTMLCanvasElement {
  const [c, g] = canvas(size, size);
  const h = size / 2;
  const R0 = h * 0.96;
  const gr = g.createRadialGradient(h * 0.85, h * 0.75, 0, h, h, R0);
  gr.addColorStop(0, "#fbf6ea");
  gr.addColorStop(0.75, "#efe4cc");
  gr.addColorStop(1, "#cdbb94");
  g.fillStyle = gr;
  g.beginPath();
  g.arc(h, h, R0, 0, Math.PI * 2);
  g.fill();
  const a0 = Math.PI * 0.75, span = Math.PI * 1.5;
  const ang = (f: number) => a0 + span * f;
  g.strokeStyle = "#2a2118";
  g.lineWidth = size * 0.006;
  g.beginPath();
  g.arc(h, h, R0 * 0.8, a0, a0 + span);
  g.stroke();
  if (red) {
    g.strokeStyle = "#c8302a";
    g.lineWidth = size * 0.03;
    g.beginPath();
    g.arc(h, h, R0 * 0.835, ang(red[0]), ang(red[1]));
    g.stroke();
  }
  g.fillStyle = "#2a2118";
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (let k = 0; k <= 50; k++) {
    const f = k / 50, a = ang(f);
    const major = k % 10 === 0, mid = k % 5 === 0;
    const l = major ? 0.13 : mid ? 0.09 : 0.05;
    g.lineWidth = size * (major ? 0.011 : 0.005);
    g.beginPath();
    g.moveTo(h + Math.cos(a) * R0 * 0.8, h + Math.sin(a) * R0 * 0.8);
    g.lineTo(h + Math.cos(a) * R0 * (0.8 - l), h + Math.sin(a) * R0 * (0.8 - l));
    g.stroke();
  }
  g.font = `600 ${Math.round(size * 0.072)}px Georgia, "Times New Roman", serif`;
  for (const t of ticks) {
    if (!t.label) continue;
    const a = ang(t.f);
    g.fillText(t.label, h + Math.cos(a) * R0 * 0.56, h + Math.sin(a) * R0 * 0.56);
  }
  g.font = `600 ${Math.round(size * 0.075)}px Georgia, serif`;
  g.fillText(title, h, h + R0 * 0.38);
  g.font = `italic ${Math.round(size * 0.068)}px Georgia, serif`;
  g.fillStyle = "#6b5a44";
  g.fillText(unit, h, h + R0 * 0.56);
  return c;
}

/** Engraved brass plaque text (colour + bump). */
export function plaque(w: number, h: number, text: string, sub?: string): HTMLCanvasElement {
  const [c, g] = canvas(w, h);
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, "#e7c27a");
  gr.addColorStop(0.5, "#c99a4e");
  gr.addColorStop(1, "#a97a36");
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = "rgba(60,36,10,0.6)";
  g.lineWidth = h * 0.05;
  g.strokeRect(h * 0.08, h * 0.08, w - h * 0.16, h - h * 0.16);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#3a2510";
  g.font = `700 ${Math.round(h * (sub ? 0.36 : 0.44))}px Georgia, "Times New Roman", serif`;
  const y = sub ? h * 0.4 : h * 0.53;
  g.fillText(text.split("").join(String.fromCharCode(8202)), w / 2, y);
  // a light catch under the engraving
  g.fillStyle = "rgba(255,240,200,0.35)";
  g.fillText(text.split("").join(String.fromCharCode(8202)), w / 2, y + 1.5);
  if (sub) {
    g.fillStyle = "#4a3016";
    g.font = `italic ${Math.round(h * 0.24)}px Georgia, serif`;
    g.fillText(sub, w / 2, h * 0.74);
  }
  return c;
}

/** Small label text on a transparent background (for engraved rail labels). */
export function railText(w: number, h: number, text: string, color = "#f2d9a0"): HTMLCanvasElement {
  const [c, g] = canvas(w, h);
  g.font = `600 ${Math.round(h * 0.62)}px Georgia, "Times New Roman", serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineJoin = "round";
  g.lineWidth = Math.max(3, h * 0.12);
  g.strokeStyle = "rgba(14,10,20,0.9)";
  g.strokeText(text, w / 2, h / 2);
  g.fillStyle = color;
  g.fillText(text, w / 2, h / 2);
  return c;
}
