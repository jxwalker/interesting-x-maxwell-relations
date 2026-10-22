/**
 * WebGL bench (three.js): a walnut-and-brass plinth carrying two twin glass gas cylinders (hard way
 * on the left, easy way on the right), two glowing measurement bars under a brass "equals" bracket,
 * a thermometer and a pressure gauge, and a sculpted violet glass energy landscape on a brass stand
 * with a brass bead marking the state. PBR materials, RoomEnvironment reflections, soft shadows,
 * ACES tone mapping, bloom, vignette and grain.
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { T_MAX, T_MIN, V_MAX, V_MIN, makeRng, type Gas, type Potential } from "./physics";
import { CONTOUR_LEVELS, NT, NV, POTENTIAL_NAME, buildLandscape, contourSegments, heightColor, naturalSpan, naturalSteps, type Landscape } from "./landscape";
import { RUN_S, type Model } from "./model";
import { CYAN, GOLD, ORANGE, RELATIONS, TEAL, VIOLET, type Anchors, type Focus, type Layout, type LeftMode, type Pick, type RightMode, type View } from "./view";
import { brushed, dialFace, dot, knurl, plaque, railText, star, walnut } from "./textures";

// ───────────────────────────── dimensions ─────────────────────────────
const BASE = 0.03;
const CYL_R = 0.3;
const WALL = 0.016;
const FLOOR_Y = 0.15;
const CAP_Y = 1.42;
const PISTON_H = 0.12;
const GAS_MIN = 0.1;
const GAS_MAX = CAP_Y - FLOOR_Y - PISTON_H - 0.03;
const ROD_L = 1.2;
const BAR_H = 1.12;
const BAR_X = 0.14;
const LAND = { sx: 0.8, sy: 0.7, sz: 0.52 };
/** Thickness of the glass slab (world units). */
const SLAB = 0.035;

const gasH = (V: number) => GAS_MIN + (GAS_MAX - GAS_MIN) * (Math.log(V / V_MIN) / Math.log(V_MAX / V_MIN));

interface Arrangement {
  left: [number, number];
  bars: [number, number];
  right: [number, number];
  land: [number, number, number];
  plinth: [number, number];
  focus: [number, number, number];
  heroW: number;
  heroH: number;
  plaques: { hard: [number, number]; easy: [number, number]; land: [number, number] };
}

const DESK: Arrangement = {
  left: [-1.85, 0.02],
  bars: [-1.05, 0.12],
  right: [-0.25, 0.02],
  land: [1.58, 1.02, -0.15],
  plinth: [5.3, 1.9],
  focus: [0.0, 0.62, 0],
  heroW: 5.1,
  heroH: 2.1,
  plaques: { hard: [-1.85, 0], easy: [-0.25, 0], land: [1.6, 0] },
};
const PHONE: Arrangement = {
  left: [-0.88, 0.5],
  bars: [0, 0.66],
  right: [0.88, 0.5],
  land: [0, 1.78, -1.05],
  plinth: [3.15, 3.0],
  focus: [0, 1.05, -0.1],
  heroW: 3.12,
  heroH: 3.1,
  plaques: { hard: [-0.88, 0], easy: [0.88, 0], land: [0, 0] },
};

// ───────────────────────────── shaders ─────────────────────────────
const FINISH_SHADER = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.028 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uGrain;
    varying vec2 vUv;
    float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 q = vUv - 0.5;
      float v = smoothstep(0.95, 0.28, length(q * vec2(1.0, 1.15)));
      c.rgb *= mix(0.45, 1.0, v);
      c.rgb += (hash(vUv * 1024.0 + fract(uTime) * 91.0) - 0.5) * uGrain;
      gl_FragColor = c;
    }`,
};

const BACKDROP_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const BACKDROP_FRAG = /* glsl */ `
varying vec3 vDir;
void main() {
  float h = vDir.y;
  vec3 navy = vec3(0.030, 0.045, 0.085);
  vec3 coal = vec3(0.012, 0.012, 0.016);
  vec3 col = mix(coal, navy, smoothstep(-0.25, 0.55, h));
  float glow = pow(max(0.0, dot(vDir, normalize(vec3(0.15, 0.2, -1.0)))), 4.0);
  col += vec3(0.030, 0.050, 0.085) * glow;
  float warm = pow(max(0.0, dot(vDir, normalize(vec3(-1.0, 0.1, -0.5)))), 5.0);
  col += vec3(0.040, 0.022, 0.010) * warm;
  gl_FragColor = vec4(col, 1.0);
}`;

/** Additive fresnel shell: bright silhouettes read as thick glass (and carry the look without transmission). */
const FRESNEL_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const FRESNEL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uBase;
uniform float uEdge;
varying vec3 vN;
varying vec3 vV;
void main() {
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float a = uBase + uEdge * pow(f, 3.0);
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

function fresnelMat(color: string | number, base: number, edge: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uBase: { value: base }, uEdge: { value: edge } },
    vertexShader: FRESNEL_VERT,
    fragmentShader: FRESNEL_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

/** Thick-walled tube profile for a lathe (outer wall, rim, inner wall). */
function tubeGeom(r: number, wall: number, h: number, seg = 64): THREE.LatheGeometry {
  const pts = [
    new THREE.Vector2(r - wall, 0),
    new THREE.Vector2(r, 0),
    new THREE.Vector2(r, h),
    new THREE.Vector2(r - wall * 0.5, h + wall * 0.4),
    new THREE.Vector2(r - wall, h),
    new THREE.Vector2(r - wall, 0.0001),
  ];
  return new THREE.LatheGeometry(pts, seg);
}

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
/** Ease with a small overshoot (piston slide). */
const easeBack = (x: number) => {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const c = 1.9;
  const y = x - 1;
  return 1 + (c + 1) * y * y * y + c * y * y;
};

interface Spring {
  x: number;
  v: number;
}
function spring(s: Spring, target: number, dt: number, k = 60, d = 9): void {
  const n = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    s.v += (k * (target - s.x) - d * s.v) * h;
    s.x += s.v * h;
  }
}

// ───────────────────────────── one gas cylinder ─────────────────────────────
class Rig {
  group = new THREE.Group();
  piston = new THREE.Group();
  handle!: THREE.Mesh;
  pin!: THREE.Mesh;
  weight!: THREE.Group;
  tray!: THREE.Mesh;
  coil!: THREE.Mesh;
  heatLight: THREE.PointLight;
  particles: THREE.Points;
  sparks: THREE.Points;
  insulation: THREE.Mesh;
  glow: THREE.Mesh;
  thermo: { group: THREE.Group; needle: THREE.Object3D; s: Spring; face: THREE.Mesh } | null = null;
  gauge: { group: THREE.Group; needle: THREE.Object3D; s: Spring } | null = null;
  private pPos: Float32Array;
  private pVel: Float32Array;
  private sPos: Float32Array;
  private sLife: Float32Array;
  private sVel: Float32Array;
  private sCol: Float32Array;
  private rng = makeRng(7);
  private n: number;
  gasTop = FLOOR_Y + 0.4;
  gasS: Spring = { x: 0.4, v: 0 };
  pinS: Spring = { x: 0, v: 0 };
  weightS: Spring = { x: 1, v: 0 };
  heat = 0;
  private spawnAcc = 0;

  constructor(
    private mats: Mats,
    side: "left" | "right",
    nParticles: number,
    dotTex: THREE.Texture,
  ) {
    const g = this.group;
    // brass foot and copper tray (heat bath / heater)
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(CYL_R + 0.1, CYL_R + 0.13, 0.05, 64), mats.brass);
    foot.position.y = 0.025;
    foot.castShadow = foot.receiveShadow = true;
    const trayPts = [new THREE.Vector2(0, 0.05), new THREE.Vector2(CYL_R + 0.12, 0.05), new THREE.Vector2(CYL_R + 0.15, 0.12), new THREE.Vector2(CYL_R + 0.13, 0.125), new THREE.Vector2(CYL_R + 0.1, 0.075), new THREE.Vector2(0, 0.07)];
    this.tray = new THREE.Mesh(new THREE.LatheGeometry(trayPts, 64), mats.copper);
    this.tray.castShadow = this.tray.receiveShadow = true;
    // glowing coil in the tray
    const helix: THREE.Vector3[] = [];
    for (let k = 0; k <= 160; k++) {
      const a = (k / 160) * Math.PI * 2 * 3;
      const rr = CYL_R - 0.02 - (k / 160) * 0.12;
      helix.push(new THREE.Vector3(Math.cos(a) * rr, 0.085, Math.sin(a) * rr));
    }
    this.coil = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(helix), 240, 0.009, 6, false), mats.coil(side));
    // glass floor plate
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(CYL_R - 0.002, CYL_R - 0.002, 0.04, 48), mats.glassFlat);
    plate.position.y = FLOOR_Y - 0.02;
    // the glass tube
    const tube = new THREE.Mesh(tubeGeom(CYL_R, WALL, CAP_Y - FLOOR_Y + 0.02), mats.glass);
    tube.position.y = FLOOR_Y - 0.02;
    tube.renderOrder = 2;
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(CYL_R + 0.002, CYL_R + 0.002, CAP_Y - FLOOR_Y, 48, 1, true), fresnelMat(0xcfe6ff, 0.0, 0.5));
    shell.position.y = (CAP_Y + FLOOR_Y) / 2;
    shell.renderOrder = 6;
    // brass collar rings
    const ringGeo = new THREE.TorusGeometry(CYL_R + 0.012, 0.022, 12, 72);
    const lowRing = new THREE.Mesh(ringGeo, mats.brass);
    lowRing.rotation.x = Math.PI / 2;
    lowRing.position.y = FLOOR_Y + 0.0;
    // top cap
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(CYL_R + 0.05, CYL_R + 0.05, 0.08, 64), mats.brass);
    cap.position.y = CAP_Y + 0.04;
    cap.castShadow = true;
    const capRim = new THREE.Mesh(new THREE.TorusGeometry(CYL_R + 0.05, 0.014, 10, 72), mats.brass);
    capRim.rotation.x = Math.PI / 2;
    capRim.position.y = CAP_Y + 0.08;
    const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.07, 32), mats.brassDark);
    boss.position.y = CAP_Y + 0.115;
    // tie rods
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + Math.PI / 6 + (side === "left" ? 0 : Math.PI / 3);
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, CAP_Y - 0.05, 10), mats.brass);
      rod.position.set(Math.cos(a) * (CYL_R + 0.05), (CAP_Y + 0.05) / 2, Math.sin(a) * (CYL_R + 0.05));
      rod.castShadow = true;
      g.add(rod);
    }
    // piston (moves): body with grooves, rod, knurled handle
    const body = new THREE.Mesh(new THREE.CylinderGeometry(CYL_R - WALL - 0.004, CYL_R - WALL - 0.004, PISTON_H, 48), mats.brass);
    body.position.y = PISTON_H / 2;
    body.castShadow = true;
    for (const y of [0.03, 0.09]) {
      const groove = new THREE.Mesh(new THREE.TorusGeometry(CYL_R - WALL - 0.004, 0.006, 8, 64), mats.brassDark);
      groove.rotation.x = Math.PI / 2;
      groove.position.y = y;
      this.piston.add(groove);
    }
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(CYL_R - WALL - 0.03, CYL_R - WALL - 0.004, 0.02, 48), mats.brassDark);
    crown.position.y = PISTON_H + 0.01;
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, ROD_L, 16), mats.steel);
    rod.position.y = PISTON_H + ROD_L / 2;
    rod.castShadow = true;
    this.handle = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.09, 40), mats.knurled);
    this.handle.position.y = PISTON_H + ROD_L + 0.045;
    this.handle.castShadow = true;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.075, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), mats.brass);
    knob.scale.y = 0.4;
    knob.position.y = PISTON_H + ROD_L + 0.09;
    this.piston.add(body, crown, rod, this.handle, knob);
    // locking pin (slides in against the rod)
    this.pin = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.2, 14), mats.brass);
    this.pin.rotation.z = Math.PI / 2;
    this.pin.position.set(0.16, CAP_Y + 0.115, 0);
    this.pin.castShadow = true;
    const pinHead = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), mats.brass);
    pinHead.position.y = -0.1;
    this.pin.add(pinHead);
    const pinGuide = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.05), mats.brassDark);
    pinGuide.position.set(0.17, CAP_Y + 0.115, 0);
    // weight (sits on the handle for fixed-pressure experiments)
    this.weight = new THREE.Group();
    const w1 = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.09, 48), mats.brass);
    w1.castShadow = true;
    const w2 = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.05, 32), mats.brassDark);
    w2.position.y = 0.07;
    const w3 = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.01, 8, 48), mats.brassDark);
    w3.rotation.x = Math.PI / 2;
    w3.position.y = 0.045;
    this.weight.add(w1, w2, w3);
    this.weight.visible = false;
    // insulation sleeve (frosted) for insulated experiments
    this.insulation = new THREE.Mesh(new THREE.CylinderGeometry(CYL_R + 0.028, CYL_R + 0.028, CAP_Y - FLOOR_Y - 0.04, 48, 1, true), mats.frost);
    this.insulation.position.y = (CAP_Y + FLOOR_Y) / 2;
    this.insulation.visible = false;
    this.insulation.renderOrder = 3;

    // soft amber glow of the gas itself, sized to the gas column
    this.glow = new THREE.Mesh(new THREE.CylinderGeometry(CYL_R - WALL - 0.01, CYL_R - WALL - 0.01, 1, 40, 1, true), fresnelMat(0xff9a4a, 0.05, -0.04));
    this.glow.renderOrder = 4;

    this.heatLight = new THREE.PointLight(0xff8a3a, 0, 1.6, 2);
    this.heatLight.position.set(0, 0.2, 0.15);

    g.add(this.glow, foot, this.tray, this.coil, plate, lowRing, cap, capRim, boss, this.piston, this.pin, pinGuide, this.weight, tube, shell, this.insulation, this.heatLight);

    // gas particles
    this.n = nParticles;
    this.pPos = new Float32Array(this.n * 3);
    this.pVel = new Float32Array(this.n * 3);
    const col = new Float32Array(this.n * 3);
    for (let i = 0; i < this.n; i++) {
      const r = Math.sqrt(this.rng()) * (CYL_R - WALL - 0.03), a = this.rng() * Math.PI * 2;
      this.pPos[i * 3] = Math.cos(a) * r;
      this.pPos[i * 3 + 1] = FLOOR_Y + 0.02 + this.rng() * 0.3;
      this.pPos[i * 3 + 2] = Math.sin(a) * r;
      const th = this.rng() * Math.PI * 2, ph = Math.acos(2 * this.rng() - 1);
      this.pVel[i * 3] = Math.sin(ph) * Math.cos(th);
      this.pVel[i * 3 + 1] = Math.cos(ph);
      this.pVel[i * 3 + 2] = Math.sin(ph) * Math.sin(th);
      const b = 0.55 + this.rng() * 0.75;
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = b;
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.BufferAttribute(this.pPos, 3));
    pg.setAttribute("color", new THREE.BufferAttribute(col, 3));
    this.particles = new THREE.Points(
      pg,
      new THREE.PointsMaterial({ map: dotTex, size: 0.08, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, toneMapped: false }),
    );
    this.particles.frustumCulled = false;
    this.particles.renderOrder = 5;
    g.add(this.particles);

    // heat sparks
    const ns = 140;
    this.sPos = new Float32Array(ns * 3);
    this.sVel = new Float32Array(ns * 3);
    this.sLife = new Float32Array(ns).fill(-1);
    this.sCol = new Float32Array(ns * 3);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(this.sPos, 3));
    sg.setAttribute("color", new THREE.BufferAttribute(this.sCol, 3));
    this.sparks = new THREE.Points(
      sg,
      new THREE.PointsMaterial({ map: dotTex, size: 0.045, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, toneMapped: false }),
    );
    this.sparks.frustumCulled = false;
    this.sparks.renderOrder = 7;
    g.add(this.sparks);
  }

  /** Thermometer on its own little stand (moved by the arrangement on phones). */
  thermoStand = new THREE.Group();
  addThermo(face: THREE.Texture): void {
    const d = dialGroup(this.mats, face, 0.16);
    d.group.position.set(0, 0.36, 0.04);
    d.group.rotation.set(-0.25, 0, 0);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.3, 12), this.mats.brass);
    post.position.set(0, 0.15, 0);
    post.castShadow = true;
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.03, 32), this.mats.brass);
    foot.position.set(0, 0.015, 0);
    this.thermoStand.add(d.group, post, foot);
    this.placeThermo(false);
    this.group.add(this.thermoStand);
    this.thermo = { group: d.group, needle: d.needle, s: { x: 0, v: 0 }, face: d.face };
  }

  placeThermo(phone: boolean): void {
    if (phone) {
      this.thermoStand.position.set(CYL_R - 0.04, 0, CYL_R + 0.3);
      this.thermoStand.rotation.y = -0.15;
      this.thermoStand.scale.setScalar(0.85);
    } else {
      this.thermoStand.position.set(CYL_R + 0.32, 0, 0.08);
      this.thermoStand.rotation.y = -0.42;
      this.thermoStand.scale.setScalar(1);
    }
  }

  addGauge(face: THREE.Texture): void {
    const d = dialGroup(this.mats, face, 0.15);
    d.group.position.set(-0.18, CAP_Y + 0.36, 0.06);
    d.group.rotation.set(-0.12, 0.2, 0);
    // pipe from cap to gauge
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.24, 12), this.mats.brass);
    pipe.position.set(-0.18, CAP_Y + 0.17, 0.0);
    pipe.castShadow = true;
    this.group.add(d.group, pipe);
    this.gauge = { group: d.group, needle: d.needle, s: { x: 0, v: 0 } };
  }

  /** Visual update. `pistonOff` shifts the piston (gas height) for the experiment; heat ∈ [−1, 1] drives sparks. */
  update(dt: number, gasHeight: number, T: number, heat: number, opts: { lock: boolean; weight: boolean; insulated: boolean; runT: number }): void {
    spring(this.gasS, gasHeight, dt, 90, 16);
    const h = Math.max(0.05, this.gasS.x);
    this.gasTop = FLOOR_Y + h;
    this.piston.position.y = this.gasTop;
    this.glow.scale.y = h;
    this.glow.position.y = FLOOR_Y + h / 2;
    // pin: snaps in at the start of a run
    const pinTarget = opts.lock ? 1 : 0;
    spring(this.pinS, pinTarget, dt, 260, 18);
    const pinIn = Math.max(-0.1, Math.min(1.15, this.pinS.x));
    this.pin.position.x = 0.21 - pinIn * 0.16;
    // weight: drops onto the handle
    spring(this.weightS, opts.weight ? 0 : 1, dt, 120, 11);
    this.weight.visible = this.weightS.x < 0.97 || opts.weight;
    this.weight.position.y = this.gasTop + PISTON_H + ROD_L + 0.14 + Math.max(0, this.weightS.x) * 0.9;
    this.weight.scale.setScalar(Math.max(0.001, 1 - Math.max(0, this.weightS.x - 0.6) * 2.5));
    this.insulation.visible = opts.insulated;
    // heat glow
    this.heat += (Math.abs(heat) - this.heat) * (1 - Math.exp(-dt * 6));
    const coilMat = this.coil.material as THREE.MeshStandardMaterial;
    coilMat.emissiveIntensity = 0.15 + this.heat * 3.2;
    (this.tray.material as THREE.MeshPhysicalMaterial).emissiveIntensity = this.heat * 0.18;
    this.heatLight.intensity = this.heat * 1.2;

    // particles: free flight with elastic walls; speed ∝ √T
    const speed = 0.42 * Math.sqrt(T / 300);
    const rMax = CYL_R - WALL - 0.025;
    const y0 = FLOOR_Y + 0.015, y1 = this.gasTop - 0.015;
    const p = this.pPos, v = this.pVel;
    for (let i = 0; i < this.n; i++) {
      const o = i * 3;
      let x = p[o] + v[o] * speed * dt, y = p[o + 1] + v[o + 1] * speed * dt, z = p[o + 2] + v[o + 2] * speed * dt;
      const rr = Math.hypot(x, z);
      if (rr > rMax) {
        const nx = x / rr, nz = z / rr;
        const dn = v[o] * nx + v[o + 2] * nz;
        if (dn > 0) {
          v[o] -= 2 * dn * nx;
          v[o + 2] -= 2 * dn * nz;
        }
        x = nx * rMax;
        z = nz * rMax;
      }
      if (y < y0) {
        y = y0;
        v[o + 1] = Math.abs(v[o + 1]);
      } else if (y > y1) {
        y = Math.max(y0, y1);
        v[o + 1] = -Math.abs(v[o + 1]);
      }
      p[o] = x;
      p[o + 1] = y;
      p[o + 2] = z;
    }
    (this.particles.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    const pm = this.particles.material as THREE.PointsMaterial;
    const f = Math.max(0, Math.min(1, Math.log(T / T_MIN) / Math.log(T_MAX / T_MIN)));
    pm.color.setRGB(1.35 + 0.45 * f, 0.5 + 1.0 * f, 0.1 + 0.95 * f);
    pm.size = 0.075 + 0.02 * f;
    const gm = this.glow.material as THREE.ShaderMaterial;
    gm.uniforms.uColor.value.setRGB(1.0 + 0.3 * f, 0.55 + 0.4 * f, 0.2 + 0.5 * f);
    gm.uniforms.uBase.value = 0.05 + 0.05 * f + this.heat * 0.05;

    // sparks
    const rate = Math.abs(heat) * 90;
    this.spawnAcc += rate * dt;
    const n = this.sLife.length;
    for (let i = 0; i < n && this.spawnAcc >= 1; i++) {
      if (this.sLife[i] >= 0) continue;
      this.spawnAcc -= 1;
      const a = this.rng() * Math.PI * 2, r = 0.08 + this.rng() * 0.18;
      const o = i * 3;
      if (heat >= 0) {
        this.sPos[o] = Math.cos(a) * r;
        this.sPos[o + 1] = 0.09;
        this.sPos[o + 2] = Math.sin(a) * r;
        this.sVel[o] = -Math.cos(a) * 0.05;
        this.sVel[o + 1] = 0.45 + this.rng() * 0.35;
        this.sVel[o + 2] = -Math.sin(a) * 0.05;
      } else {
        this.sPos[o] = Math.cos(a) * r;
        this.sPos[o + 1] = FLOOR_Y + 0.05 + this.rng() * Math.max(0.05, h - 0.1);
        this.sPos[o + 2] = Math.sin(a) * r;
        this.sVel[o] = Math.cos(a) * 0.04;
        this.sVel[o + 1] = -(0.45 + this.rng() * 0.3);
        this.sVel[o + 2] = Math.sin(a) * 0.04;
      }
      this.sLife[i] = 0;
    }
    if (this.spawnAcc > 4) this.spawnAcc = 4;
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      if (this.sLife[i] < 0) {
        this.sCol[o] = this.sCol[o + 1] = this.sCol[o + 2] = 0;
        continue;
      }
      this.sLife[i] += dt;
      const life = this.sLife[i];
      this.sPos[o] += this.sVel[o] * dt + Math.sin(life * 13 + i) * 0.002;
      this.sPos[o + 1] += this.sVel[o + 1] * dt;
      this.sPos[o + 2] += this.sVel[o + 2] * dt + Math.cos(life * 11 + i) * 0.002;
      const top = heat >= 0 ? Math.min(this.gasTop - 0.03, FLOOR_Y + 0.08 + life * 0.6) : this.gasTop;
      const dead = life > 1.1 || this.sPos[o + 1] > top + 0.001 || this.sPos[o + 1] < 0.07;
      if (dead) {
        this.sLife[i] = -1;
        continue;
      }
      const a = Math.min(1, life * 6) * (1 - life / 1.1);
      this.sCol[o] = 2.4 * a;
      this.sCol[o + 1] = 1.2 * a;
      this.sCol[o + 2] = 0.35 * a;
    }
    (this.sparks.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.sparks.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }
}

function dialGroup(m: Mats, face: THREE.Texture, r: number): { group: THREE.Group; needle: THREE.Object3D; face: THREE.Mesh } {
  const group = new THREE.Group();
  const back = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.02, r + 0.025, 0.05, 48), m.brass);
  back.rotation.x = Math.PI / 2;
  back.position.z = -0.025;
  back.castShadow = true;
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(r + 0.012, 0.016, 12, 64), m.brass);
  const faceMesh = new THREE.Mesh(new THREE.CircleGeometry(r, 48), new THREE.MeshStandardMaterial({ map: face, color: 0xb8b0a0, roughness: 0.6, metalness: 0 }));
  faceMesh.position.z = 0.002;
  const needle = new THREE.Group();
  const nm = new THREE.Mesh(new THREE.BoxGeometry(0.008, r * 0.86, 0.004), m.needle);
  nm.position.y = r * 0.34;
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.012, r * 0.22, 0.004), m.needle);
  tail.position.y = -r * 0.1;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.012, 16), m.brass);
  hub.rotation.x = Math.PI / 2;
  needle.add(nm, tail, hub);
  needle.position.z = 0.01;
  const glass = new THREE.Mesh(new THREE.CircleGeometry(r + 0.004, 48), m.dialGlass);
  glass.position.z = 0.02;
  group.add(back, bezel, faceMesh, needle, glass);
  return { group, needle, face: faceMesh };
}

// ───────────────────────────── materials ─────────────────────────────
interface Mats {
  brass: THREE.MeshPhysicalMaterial;
  brassDark: THREE.MeshPhysicalMaterial;
  copper: THREE.MeshPhysicalMaterial;
  steel: THREE.MeshPhysicalMaterial;
  knurled: THREE.MeshPhysicalMaterial;
  glass: THREE.Material;
  glassFlat: THREE.Material;
  frost: THREE.Material;
  dialGlass: THREE.Material;
  needle: THREE.MeshStandardMaterial;
  coil: (side: string) => THREE.MeshStandardMaterial;
}

// ───────────────────────────── the scene ─────────────────────────────
export class Scene3D implements View {
  readonly kind = "webgl" as const;
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.05, 80);
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private finish: ShaderPass;
  private mobile: boolean;
  private mats!: Mats;
  private dotTex: THREE.Texture;

  private bench = new THREE.Group();
  private plinthDesk = new THREE.Group();
  private plinthPhone = new THREE.Group();
  private left!: Rig;
  private right!: Rig;
  private bars = new THREE.Group();
  private barFill: THREE.Mesh[] = [];
  private barCap: THREE.Mesh[] = [];
  private bracket = new THREE.Group();
  private bracketMat!: THREE.MeshStandardMaterial;
  private bracketS: Spring = { x: 0.3, v: 0 };
  private plaques: Record<"hard" | "easy" | "land", THREE.Mesh> = {} as never;
  private plaquePot: Potential | null = null;

  // landscape
  private land = new THREE.Group();
  private landStand = new THREE.Group();
  private surf!: THREE.Mesh;
  private surfGeo!: THREE.BufferGeometry;
  private surfShell!: THREE.Mesh;
  private majorT!: THREE.LineSegments;
  private majorV!: THREE.LineSegments;
  private minor!: THREE.LineSegments;
  private contours!: THREE.LineSegments;
  private rim!: THREE.LineLoop;
  private bead!: THREE.Mesh;
  private beadLight!: THREE.PointLight;
  private arrows: THREE.Group[] = [];
  private whyA!: THREE.Mesh;
  private whyB!: THREE.Mesh;
  private whyFill!: THREE.Mesh;
  private whyGlow!: THREE.Sprite;
  private whyPts: { a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3 } | null = null;
  private critStar!: THREE.Sprite;
  private railLabels: THREE.Sprite[] = [];
  private rails: THREE.Mesh[] = [];
  private landFrom: Landscape | null = null;
  private landTo: Landscape | null = null;
  private landPos: Float32Array;
  private rimIdx: number[] = [];
  private landStart: Float32Array;
  private morph = 1;
  private shapeKey = -1;
  private unstableCentroid: THREE.Vector3 | null = null;
  private unstableTo: THREE.Vector3 | null = null;

  private dust!: THREE.Points;
  private keyLight!: THREE.SpotLight;

  // camera
  private w = 1;
  private h = 1;
  private layout: Layout = { x: 0, y: 0, w: 1, h: 1, phone: false };
  private lay = { cx: 0, cy: 0, w: 0, h: 0 };
  private arr: Arrangement = DESK;
  private time = 0;
  private yaw = 0.0;
  private pitch = 0.3;
  private yawV = 0;
  private pitchV = 0;
  private idle = 10;
  private zoomT = 1;
  private zoomF = 1.32;
  private dragging = false;
  private focusName: Focus = "whole";
  private focusP = new THREE.Vector3();
  private focusZ = 1;
  private anch: Anchors = {};
  private v3 = new THREE.Vector3();
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private thermoFaceTex!: THREE.CanvasTexture;

  constructor(container: HTMLElement, opts: { hq?: boolean } = {}) {
    this.mobile = matchMedia("(pointer: coarse)").matches || Math.min(innerWidth, innerHeight) < 600;
    const canvas = document.createElement("canvas");
    canvas.id = "canvas";
    canvas.setAttribute("aria-label", "A brass and glass thermodynamics bench: two gas cylinders, two glowing measurement bars and a glass energy landscape. Drag to turn it; drag the left piston handle to change the volume.");
    container.appendChild(canvas);
    this.canvas = canvas;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", alpha: false, preserveDrawingBuffer: !!opts.hq });
    } catch (e) {
      canvas.remove();
      throw e;
    }
    this.renderer = renderer;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.mobile ? 1.5 : 2));
    renderer.transmissionResolutionScale = 0.6;
    this.dotTex = new THREE.CanvasTexture(dot());
    this.dotTex.colorSpace = THREE.SRGBColorSpace;
    this.landPos = new Float32Array(NT * NV * 3);
    this.landStart = new Float32Array(NT * NV * 3);

    this.scene.fog = new THREE.FogExp2(0x070a12, 0.035);
    this.buildEnvironment();
    this.buildMaterials();
    this.buildPlinth();
    this.buildRigs();
    this.buildBars();
    this.buildLandscape();
    this.buildDust();
    this.scene.add(this.bench);
    this.arrange(DESK);

    const samples = this.mobile ? 0 : 4;
    const rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.45, 0.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.finish = new ShaderPass(FINISH_SHADER);
    this.composer.addPass(this.finish);
  }

  // ───────────────────────────── build ─────────────────────────────
  private buildEnvironment(): void {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.scene.environment = pmrem.fromScene(room, 0.04).texture;
    this.scene.environmentIntensity = 0.42;
    room.dispose();
    pmrem.dispose();

    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(60, 32, 16),
      new THREE.ShaderMaterial({ vertexShader: BACKDROP_VERT, fragmentShader: BACKDROP_FRAG, side: THREE.BackSide, depthWrite: false, fog: false }),
    );
    sky.renderOrder = -10;
    this.scene.add(sky);

    const key = new THREE.SpotLight(0xfff1de, 46, 30, 0.42, 0.75, 1.4);
    key.position.set(0.6, 7.2, 3.2);
    key.target.position.set(0, 0.3, 0);
    key.castShadow = true;
    const sm = this.mobile ? 1024 : 2048;
    key.shadow.mapSize.set(sm, sm);
    key.shadow.camera.near = 3;
    key.shadow.camera.far = 14;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 5;
    this.keyLight = key;
    const rim = new THREE.DirectionalLight(0xffa25a, 2.6);
    rim.position.set(-5, 3.5, -4.5);
    const rim2 = new THREE.DirectionalLight(0x9fb8ff, 1.2);
    rim2.position.set(5, 2.5, -4);
    const fill = new THREE.DirectionalLight(0x6f8cff, 0.7);
    fill.position.set(5, 2, 5);
    const front = new THREE.DirectionalLight(0xffe2c0, 0.55);
    front.position.set(-2, 1.5, 7);
    this.scene.add(key, key.target, rim, rim2, fill, front, new THREE.HemisphereLight(0x2a3a5c, 0x120a06, 0.5));
  }

  private buildMaterials(): void {
    const br = brushed(this.mobile ? 256 : 512, this.mobile ? 256 : 512);
    const bMap = new THREE.CanvasTexture(br.color);
    bMap.colorSpace = THREE.SRGBColorSpace;
    bMap.wrapS = bMap.wrapT = THREE.RepeatWrapping;
    const bRough = new THREE.CanvasTexture(br.rough);
    bRough.wrapS = bRough.wrapT = THREE.RepeatWrapping;
    const brass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: bMap, roughnessMap: bRough, metalness: 1, roughness: 0.32, clearcoat: 0.4, clearcoatRoughness: 0.2, envMapIntensity: 1.3 });
    const brassDark = new THREE.MeshPhysicalMaterial({ color: 0x9c7a44, metalness: 1, roughness: 0.42, envMapIntensity: 1.0 });
    const copper = new THREE.MeshPhysicalMaterial({ color: 0xc8714a, metalness: 1, roughness: 0.4, clearcoat: 0.2, emissive: new THREE.Color(0xff6a20), emissiveIntensity: 0, envMapIntensity: 1.1 });
    const steel = new THREE.MeshPhysicalMaterial({ color: 0xd8d4cc, metalness: 1, roughness: 0.22, envMapIntensity: 1.2 });
    const kn = new THREE.CanvasTexture(knurl());
    kn.wrapS = kn.wrapT = THREE.RepeatWrapping;
    kn.repeat.set(6, 1);
    const knurled = new THREE.MeshPhysicalMaterial({ color: 0xe0b46a, metalness: 1, roughness: 0.38, bumpMap: kn, bumpScale: 2.5, envMapIntensity: 1.3 });
    const hq = !this.mobile;
    const glass = hq
      ? new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: 0.04, transmission: 1, thickness: 0.05, ior: 1.5, clearcoat: 1, clearcoatRoughness: 0.04, specularIntensity: 1, envMapIntensity: 1.4, depthWrite: false, side: THREE.DoubleSide, attenuationColor: new THREE.Color(0xdff2ff), attenuationDistance: 2 })
      : new THREE.MeshPhysicalMaterial({ color: 0xdfefff, metalness: 0, roughness: 0.05, transparent: true, opacity: 0.12, clearcoat: 1, specularIntensity: 1, envMapIntensity: 2, depthWrite: false, side: THREE.DoubleSide });
    const glassFlat = new THREE.MeshPhysicalMaterial({ color: 0xd8ecff, roughness: 0.1, transparent: true, opacity: 0.2, depthWrite: false, envMapIntensity: 1.5 });
    const frost = new THREE.MeshPhysicalMaterial({ color: 0xc8d8f0, roughness: 0.65, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 0.8 });
    const dialGlass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.02, transparent: true, opacity: 0.08, clearcoat: 1, envMapIntensity: 2.2, depthWrite: false });
    const needle = new THREE.MeshStandardMaterial({ color: 0xc0281e, roughness: 0.4, metalness: 0.2 });
    const coil = () => new THREE.MeshStandardMaterial({ color: 0x5a2a12, roughness: 0.5, metalness: 0.6, emissive: new THREE.Color(0xff6418), emissiveIntensity: 0.15 });
    this.mats = { brass, brassDark, copper, steel, knurled, glass, glassFlat, frost, dialGlass, needle, coil };
  }

  private buildPlinth(): void {
    const wood = new THREE.CanvasTexture(walnut(this.mobile ? 512 : 1024, this.mobile ? 128 : 256));
    wood.colorSpace = THREE.SRGBColorSpace;
    wood.wrapS = wood.wrapT = THREE.RepeatWrapping;
    wood.anisotropy = 8;
    const woodMat = new THREE.MeshPhysicalMaterial({ map: wood, roughness: 0.42, metalness: 0, clearcoat: 0.85, clearcoatRoughness: 0.18, envMapIntensity: 0.6 });
    const cabinetMat = woodMat.clone();
    cabinetMat.color.setScalar(0.32);
    for (const [grp, [w, d]] of [[this.plinthDesk, DESK.plinth], [this.plinthPhone, PHONE.plinth]] as const) {
      const top = new THREE.Mesh(new RoundedBoxGeometry(w, 0.3, d, 4, 0.04), woodMat);
      top.position.y = -0.15;
      top.receiveShadow = top.castShadow = true;
      const plate = new THREE.Mesh(new RoundedBoxGeometry(w - 0.22, 0.03, d - 0.22, 3, 0.012), this.mats.brass);
      plate.position.y = BASE / 2;
      plate.receiveShadow = true;
      const trim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, 0.05, d + 0.12), this.mats.brass);
      trim.position.y = -0.325;
      trim.receiveShadow = true;
      const cab = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, 2.2, d + 0.06), cabinetMat);
      cab.position.y = -0.35 - 1.1;
      cab.receiveShadow = true;
      // brass corner screws
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) {
          const s = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.012, 16), this.mats.brassDark);
          s.position.set(sx * (w / 2 - 0.2), BASE + 0.004, sz * (d / 2 - 0.2));
          grp.add(s);
        }
      grp.add(top, plate, trim, cab);
    }
    this.bench.add(this.plinthDesk, this.plinthPhone);

    // engraved plaques (front face)
    const mk = (text: string, sub: string) => {
      const tex = new THREE.CanvasTexture(plaque(640, 118, text, sub));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.17, 0.012), [this.mats.brassDark, this.mats.brassDark, this.mats.brassDark, this.mats.brassDark, new THREE.MeshPhysicalMaterial({ map: tex, metalness: 0.85, roughness: 0.35, clearcoat: 0.5, envMapIntensity: 1.2 }), this.mats.brassDark]);
      this.bench.add(m);
      return m;
    };
    this.plaques.hard = mk("HARD WAY", "count the heat");
    this.plaques.easy = mk("EASY WAY", "read the dials");
    this.plaques.land = mk("ENERGY LANDSCAPE", "free energy F(T, V)");
  }

  private setLandPlaque(p: Potential): void {
    if (this.plaquePot === p) return;
    this.plaquePot = p;
    const n = POTENTIAL_NAME[p];
    const tex = new THREE.CanvasTexture(plaque(640, 118, "ENERGY LANDSCAPE", n.plaque.toLowerCase().replace(/\s+/g, " ")));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const mats = this.plaques.land.material as THREE.MeshPhysicalMaterial[];
    mats[4].map?.dispose();
    mats[4].map = tex;
    mats[4].needsUpdate = true;
  }

  private buildRigs(): void {
    const n = this.mobile ? 150 : 240;
    this.left = new Rig(this.mats, "left", n, this.dotTex);
    this.right = new Rig(this.mats, "right", n, this.dotTex);
    const tTicks = [150, 300, 450, 600, 750, 900].map((T) => ({ f: (T - 150) / 750, label: String(T) }));
    this.thermoFaceTex = new THREE.CanvasTexture(dialFace(this.mobile ? 256 : 512, "THERMOMETER", "kelvin", tTicks, [0.85, 1]));
    this.thermoFaceTex.colorSpace = THREE.SRGBColorSpace;
    this.thermoFaceTex.anisotropy = 4;
    this.right.addThermo(this.thermoFaceTex);
    const pTicks = [1, 2, 3, 4, 5].map((e, i) => ({ f: i / 4, label: ["10", "100", "1k", "10k", "100k"][i] ?? String(e) }));
    const gFace = new THREE.CanvasTexture(dialFace(this.mobile ? 256 : 512, "PRESSURE", "kPa", pTicks, [0.78, 1]));
    gFace.colorSpace = THREE.SRGBColorSpace;
    gFace.anisotropy = 4;
    this.right.addGauge(gFace);
    this.bench.add(this.left.group, this.right.group);
  }

  private buildBars(): void {
    const g = this.bars;
    const base = new THREE.Mesh(new RoundedBoxGeometry(0.54, 0.07, 0.26, 3, 0.02), this.mats.brass);
    base.position.y = 0.035;
    base.castShadow = base.receiveShadow = true;
    g.add(base);
    const cols = [ORANGE, TEAL];
    [-BAR_X, BAR_X].forEach((x, i) => {
      const tube = new THREE.Mesh(tubeGeom(0.075, 0.009, BAR_H + 0.04, 40), this.mats.glass);
      tube.position.set(x, 0.07, 0);
      tube.renderOrder = 2;
      const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.077, 0.077, BAR_H + 0.04, 32, 1, true), fresnelMat(0xd8ecff, 0, 0.55));
      shell.position.set(x, 0.07 + (BAR_H + 0.04) / 2, 0);
      shell.renderOrder = 6;
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.079, 0.012, 10, 40), this.mats.brass);
      collar.rotation.x = Math.PI / 2;
      collar.position.set(x, 0.075, 0);
      const topc = collar.clone();
      topc.position.y = 0.07 + BAR_H + 0.04;
      const col = new THREE.Color(cols[i]);
      const fillMat = new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(1.35), transparent: true, opacity: 0.95, toneMapped: false });
      const fill = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 1, 32), fillMat);
      fill.position.set(x, 0.075, 0);
      fill.renderOrder = 4;
      const capMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).lerp(col, 0.55).multiplyScalar(2.2), toneMapped: false, transparent: true, opacity: 0.95 });
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.012, 32), capMat);
      cap.position.set(x, 0.08, 0);
      cap.renderOrder = 4;
      // engraved scale rings
      for (let k = 1; k <= 4; k++) {
        const r = new THREE.Mesh(new THREE.TorusGeometry(0.0755, 0.0025, 4, 40), this.mats.brassDark);
        r.rotation.x = Math.PI / 2;
        r.position.set(x, 0.075 + (BAR_H * k) / 4, 0);
        g.add(r);
      }
      g.add(fill, cap, tube, shell, collar, topc);
      this.barFill.push(fill);
      this.barCap.push(cap);
    });
    // equals bracket: a brass ⊓ over both bars with a glowing "=" on top
    this.bracketMat = new THREE.MeshStandardMaterial({ color: 0x1c2a2e, emissive: new THREE.Color(CYAN), emissiveIntensity: 0, roughness: 0.35, metalness: 0.4, toneMapped: false });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(BAR_X * 2 + 0.12, 0.02, 0.034), this.mats.brass);
    const seam = new THREE.Mesh(new THREE.BoxGeometry(BAR_X * 2 + 0.1, 0.006, 0.036), this.bracketMat);
    seam.position.y = -0.004;
    const legs = [-1, 1].map((s) => {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.07, 0.034), this.mats.brass);
      l.position.set(s * (BAR_X + 0.05), -0.04, 0);
      return l;
    });
    const eq1 = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.022, 0.024), this.bracketMat);
    eq1.position.y = 0.05;
    const eq2 = eq1.clone();
    eq2.position.y = 0.095;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.dotTex, color: new THREE.Color(CYAN), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.setScalar(0.5);
    glow.position.y = 0.07;
    glow.name = "glow";
    this.bracket.add(beam, seam, ...legs, eq1, eq2, glow);
    g.add(this.bracket);
    this.bench.add(g);
  }

  private buildLandscape(): void {
    const n = NT * NV;
    // rim loop (grid indices), shared by the edge line and the glass slab's side wall
    const rimIdx: number[] = [];
    for (let j = 0; j < NV; j++) rimIdx.push(j);
    for (let i = 1; i < NT; i++) rimIdx.push(i * NV + NV - 1);
    for (let j = NV - 2; j >= 0; j--) rimIdx.push((NT - 1) * NV + j);
    for (let i = NT - 2; i > 0; i--) rimIdx.push(i * NV);
    this.rimIdx = rimIdx;
    const RL = rimIdx.length;
    const nv = 2 * n + 2 * RL;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(nv * 3).fill(1), 3));
    const idx: number[] = [];
    for (let i = 0; i < NT - 1; i++)
      for (let j = 0; j < NV - 1; j++) {
        const a = i * NV + j, b = (i + 1) * NV + j, c = (i + 1) * NV + j + 1, d = i * NV + j + 1;
        idx.push(a, b, d, b, c, d);
        idx.push(n + a, n + d, n + b, n + b, n + d, n + c);
      }
    for (let q = 0; q < RL; q++) {
      const t0 = 2 * n + q * 2, b0 = t0 + 1, t1 = 2 * n + ((q + 1) % RL) * 2, b1 = t1 + 1;
      idx.push(t0, b0, t1, t1, b0, b1);
    }
    geo.setIndex(idx);
    this.surfGeo = geo;
    // matte, opaque "frosted enamel" surface coloured by height: legible first, no glare (bloom threshold is never reached)
    // the bench's key light is very strong, so most of the colour is self-lit (emissive × vertex colour) and the
    // dimmed diffuse term only adds gentle shading for shape
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.1, 0.1, 0.1), vertexColors: true, metalness: 0, roughness: 0.95, side: THREE.DoubleSide, envMapIntensity: 0.05, emissive: new THREE.Color(0.8, 0.8, 0.8), polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    mat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace("vec3 totalEmissiveRadiance = emissive;", "vec3 totalEmissiveRadiance = emissive * vColor.rgb;");
    };
    this.surf = new THREE.Mesh(geo, mat);
    this.surf.receiveShadow = true;
    this.surf.scale.set(LAND.sx, LAND.sy, LAND.sz);
    this.surf.renderOrder = 2;
    this.surfShell = new THREE.Mesh(geo, fresnelMat(0xb48cff, 0.02, 0.32));
    this.surfShell.visible = false; // the glassy rim glow made the surface hard to read
    this.surfShell.scale.copy(this.surf.scale);
    this.surfShell.renderOrder = 6;
    this.land.add(this.surf, this.surfShell);

    // contour lines: constant T (cyan) and constant V (violet), plus a fine engraved grid
    const lineGeo = (pairs: number[]) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pairs.length * 3), 3));
      g.userData.idx = pairs;
      return g;
    };
    const pT: number[] = [], pV: number[] = [], pM: number[] = [];
    const STEP = 7;
    for (let i = 0; i < NT; i++)
      for (let j = 0; j < NV - 1; j++) {
        const a = i * NV + j, b = a + 1;
        if (i % STEP === 0 || i === NT - 1) pT.push(a, b);
        else if (i % 2 === 0) pM.push(a, b);
      }
    for (let j = 0; j < NV; j++)
      for (let i = 0; i < NT - 1; i++) {
        const a = i * NV + j, b = a + NV;
        if (j % STEP === 0 || j === NV - 1) pV.push(a, b);
        else if (j % 2 === 0) pM.push(a, b);
      }
    const lm = (c: string, op: number, k: number) => new THREE.LineBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), transparent: true, opacity: op, depthWrite: false, toneMapped: false });
    this.majorT = new THREE.LineSegments(lineGeo(pT), lm("#ffffff", 0.32, 1));
    this.majorV = new THREE.LineSegments(lineGeo(pV), lm("#ffffff", 0.32, 1));
    this.minor = new THREE.LineSegments(lineGeo(pM), lm("#ffffff", 0.0, 1));
    this.minor.visible = false;
    // height contours: dark ink lines of equal energy (rebuilt as the surface morphs)
    const cg = new THREE.BufferGeometry();
    cg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(CONTOUR_LEVELS.length * NT * NV * 4 * 3), 3));
    cg.setDrawRange(0, 0);
    this.contours = new THREE.LineSegments(cg, new THREE.LineBasicMaterial({ color: 0x120c1c, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }));
    this.contours.scale.copy(this.surf.scale);
    this.contours.renderOrder = 7;
    this.contours.frustumCulled = false;
    this.land.add(this.contours);
    for (const l of [this.majorT, this.majorV, this.minor]) {
      l.scale.copy(this.surf.scale);
      l.renderOrder = 7;
      l.frustumCulled = false;
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(rimIdx.length * 3), 3));
    rg.userData.idx = rimIdx;
    this.rim = new THREE.LineLoop(rg, lm("#f2d9a0", 0.9, 1));
    this.rim.scale.copy(this.surf.scale);
    this.rim.renderOrder = 7;
    this.rim.frustumCulled = false;
    this.land.add(this.majorT, this.majorV, this.minor, this.rim);

    // bead, its light and the two slope arrows
    // current state: a bright white pearl with a dark halo ring and a pin down to the surface
    this.bead = new THREE.Mesh(new THREE.SphereGeometry(0.05, 32, 20), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e0, emissiveIntensity: 0.55, roughness: 0.4, metalness: 0 }));
    this.bead.castShadow = true;
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.012, 10, 40), new THREE.MeshBasicMaterial({ color: 0x120c1c }));
    halo.rotation.x = Math.PI / 2;
    halo.position.y = -0.035;
    this.bead.add(halo);
    this.beadLight = new THREE.PointLight(0xf0e0ff, 0.35, 0.7, 2);
    this.land.add(this.bead, this.beadLight);
    for (const c of [CYAN, VIOLET]) {
      const a = new THREE.Group();
      const m = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(c), emissive: new THREE.Color(c), emissiveIntensity: 0.9, roughness: 0.1, transparent: true, opacity: 0.85, clearcoat: 1 });
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 10), m);
      shaft.position.y = 0.08;
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.06, 16), m);
      head.position.y = 0.18;
      a.add(shaft, head);
      this.arrows.push(a);
      this.land.add(a);
    }
    // show-why paths
    const pm = (c: string) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(2.2), toneMapped: false, transparent: true, opacity: 0.95 });
    this.whyA = new THREE.Mesh(new THREE.BufferGeometry(), pm(ORANGE));
    this.whyB = new THREE.Mesh(new THREE.BufferGeometry(), pm(TEAL));
    const fillGeo = new THREE.BufferGeometry();
    fillGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12), 3));
    fillGeo.setIndex([0, 1, 2, 0, 2, 3]);
    this.whyFill = new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(GOLD), transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.whyGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.dotTex, color: new THREE.Color(GOLD), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.whyGlow.scale.setScalar(0.13);
    for (const o of [this.whyA, this.whyB, this.whyFill, this.whyGlow]) {
      o.visible = false;
      o.renderOrder = 8;
      this.land.add(o);
    }
    // critical point star
    const st = new THREE.CanvasTexture(star());
    this.critStar = new THREE.Sprite(new THREE.SpriteMaterial({ map: st, color: new THREE.Color(1.5, 1.35, 1.0), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.critStar.scale.setScalar(0.2);
    this.critStar.renderOrder = 9;
    this.critStar.visible = false;
    this.land.add(this.critStar);

    // stand: brass base, post and cradle
    const sBase = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.05, 48), this.mats.brass);
    sBase.position.y = 0.025;
    sBase.castShadow = sBase.receiveShadow = true;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.034, 1, 20), this.mats.brass);
    post.name = "post";
    post.castShadow = true;
    const cradle = new THREE.Mesh(new THREE.SphereGeometry(0.06, 24, 12), this.mats.brass);
    cradle.name = "cradle";
    this.landStand.add(sBase, post, cradle);
    // brass tick rails along the two axis edges (rebuilt to follow the glass as it morphs)
    for (let k = 0; k < 2; k++) {
      const r = new THREE.Mesh(new THREE.BufferGeometry(), this.mats.brass);
      this.rails.push(r);
      this.land.add(r);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
      s.scale.set(0.84, 0.105, 1);
      this.railLabels.push(s);
      this.land.add(s);
    }
    this.bench.add(this.land, this.landStand);
  }

  private setRailText(p: Potential): void {
    const ax = POTENTIAL_NAME[p].axes;
    const words = [`${ax[0]} →`, ax[1] === "pressure" ? "← pressure" : `${ax[1]} →`];
    this.railLabels.forEach((s, i) => {
      const m = s.material as THREE.SpriteMaterial;
      m.map?.dispose();
      const t = new THREE.CanvasTexture(railText(512, 64, words[i]));
      t.colorSpace = THREE.SRGBColorSpace;
      m.map = t;
      m.needsUpdate = true;
    });
  }

  private buildDust(): void {
    const n = this.mobile ? 160 : 320;
    const p = new Float32Array(n * 3);
    const r = makeRng(3);
    for (let i = 0; i < n; i++) {
      p[i * 3] = (r() - 0.5) * 9;
      p[i * 3 + 1] = -0.2 + r() * 3.5;
      p[i * 3 + 2] = (r() - 0.6) * 6;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    this.dust = new THREE.Points(g, new THREE.PointsMaterial({ map: this.dotTex, size: 0.018, color: 0xbfcfff, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.scene.add(this.dust);
  }

  private arrange(a: Arrangement): void {
    this.arr = a;
    const phone = a === PHONE;
    this.plinthDesk.visible = !phone;
    this.plinthPhone.visible = phone;
    this.left.group.position.set(a.left[0], BASE, a.left[1]);
    this.right.group.position.set(a.right[0], BASE, a.right[1]);
    this.right.placeThermo(phone);
    this.bars.position.set(a.bars[0], BASE, a.bars[1]);
    this.land.position.set(a.land[0], a.land[1], a.land[2]);
    this.land.rotation.set(phone ? 0.85 : 0.8, phone ? 0 : -0.3, 0);
    this.land.scale.setScalar(phone ? 1.25 : 1.22);
    this.landStand.position.set(a.land[0], BASE, a.land[2] - 0.05);
    const post = this.landStand.getObjectByName("post")!;
    const top = a.land[1] - BASE - 0.12;
    post.scale.y = top;
    post.position.y = top / 2;
    this.landStand.getObjectByName("cradle")!.position.y = top;
    const fz = a.plinth[1] / 2 + 0.008;
    this.plaques.hard.position.set(a.plaques.hard[0], -0.15, fz);
    this.plaques.easy.position.set(a.plaques.easy[0], -0.15, fz);
    this.plaques.land.position.set(a.plaques.land[0], -0.15, fz);
    const sc = phone ? 0.9 : 1;
    for (const p of Object.values(this.plaques)) p.scale.setScalar(sc);
    // the key light follows the bench centre
    this.keyLight.target.position.set(a.focus[0], 0.3, phone ? -0.1 : 0);
  }

  // ───────────────────────────── view API ─────────────────────────────
  resize(w: number, h: number, layout: Layout): void {
    this.w = w;
    this.h = h;
    this.layout = layout;
    const want = layout.phone ? PHONE : DESK;
    if (want !== this.arr) this.arrange(want);
    if (!this.lay.w) this.lay = { cx: layout.x + layout.w / 2, cy: layout.y + layout.h / 2, w: layout.w, h: layout.h };
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    const k = this.mobile ? 0.4 : 0.5;
    this.bloom.resolution.set(Math.max(64, w * k), Math.max(64, h * k));
  }

  setStepped(): void {
    /* deterministic per frame already */
  }

  orbit(dx: number, dy: number): void {
    this.dragging = true;
    this.yawV = -dx * 0.005;
    this.pitchV = dy * 0.003;
    this.yaw = Math.max(-1.1, Math.min(1.1, this.yaw + this.yawV));
    this.pitch = Math.max(0.04, Math.min(0.95, this.pitch + this.pitchV));
    this.idle = 0;
  }
  release(): void {
    this.dragging = false;
  }
  zoom(f: number): void {
    this.zoomT = Math.max(0.55, Math.min(1.6, this.zoomT * f));
    this.idle = 0;
  }
  poke(): void {
    this.idle = 0;
  }
  focus(f: Focus): void {
    this.focusName = f;
    this.idle = 0;
  }

  private setRay(clientX: number, clientY: number): void {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
  }

  pick(clientX: number, clientY: number): Pick {
    this.setRay(clientX, clientY);
    // generous hit zones (spheres) for the small handles
    const near = (o: THREE.Object3D, r: number) => {
      o.getWorldPosition(this.v3);
      const d = this.ray.ray.distanceSqToPoint(this.v3);
      return d < r * r ? this.v3.distanceTo(this.ray.ray.origin) : Infinity;
    };
    const tol = this.layout.phone ? 0.2 : 0.14;
    const cands: [Pick, number][] = [
      ["handle", near(this.left.handle, tol)],
      ["thermo", this.right.thermo ? near(this.right.thermo.group, tol + 0.04) : Infinity],
    ];
    const hits = this.ray.intersectObjects([this.plaques.hard, this.plaques.easy, this.plaques.land], false);
    if (hits.length) {
      const o = hits[0].object;
      cands.push([o === this.plaques.hard ? "plaque-hard" : o === this.plaques.easy ? "plaque-easy" : "plaque-land", hits[0].distance]);
    }
    cands.sort((a, b) => a[1] - b[1]);
    return cands[0][1] < Infinity ? cands[0][0] : null;
  }

  handlePixelsPerLogV(): number {
    const g = this.left.group;
    const a = this.v3.set(0, FLOOR_Y + GAS_MIN, 0).applyMatrix4(g.matrixWorld).project(this.camera).y;
    const b = this.v3.set(0, FLOOR_Y + GAS_MAX, 0).applyMatrix4(g.matrixWorld).project(this.camera).y;
    const px = (Math.abs(b - a) / 2) * this.h;
    return Math.max(40, px / Math.log(V_MAX / V_MIN));
  }

  anchors(): Anchors {
    return this.anch;
  }

  // ───────────────────────────── per frame ─────────────────────────────
  private updateCamera(dt: number): void {
    this.time += dt;
    this.idle += dt;
    const k = 1 - Math.exp(-dt * 6);
    const L = this.layout;
    this.lay.cx += (L.x + L.w / 2 - this.lay.cx) * k;
    this.lay.cy += (L.y + L.h / 2 - this.lay.cy) * k;
    this.lay.w += (L.w - this.lay.w) * k;
    this.lay.h += (L.h - this.lay.h) * k;
    if (!this.dragging) {
      this.yaw = Math.max(-1.1, Math.min(1.1, this.yaw + this.yawV));
      this.pitch = Math.max(0.04, Math.min(0.95, this.pitch + this.pitchV));
      const damp = Math.exp(-dt * 4);
      this.yawV *= damp;
      this.pitchV *= damp;
      if (this.idle > 5) {
        // slow breathing orbit, about ±8°
        const base = this.layout.phone ? 0 : -0.1;
        const target = base + Math.sin(this.time * 0.19) * 0.14;
        const pt = (this.layout.phone ? 0.36 : 0.3) + Math.sin(this.time * 0.13) * 0.03;
        const s = 1 - Math.exp(-dt * 0.5);
        this.yaw += (target - this.yaw) * s;
        this.pitch += (pt - this.pitch) * s;
      }
    }
    // focus point and zoom
    const a = this.arr;
    const fp = this.v3;
    let fz = 1;
    if (this.focusName === "hard") {
      this.left.group.getWorldPosition(fp).add(new THREE.Vector3(0, 0.75, 0));
      fz = 0.48;
    } else if (this.focusName === "easy") {
      this.right.group.getWorldPosition(fp).add(new THREE.Vector3(0.12, 0.8, 0));
      fz = 0.55;
    } else if (this.focusName === "land") {
      // on a phone aim at the middle of the tilted sheet, not its base, so it sits below the title row
      if (this.layout.phone) this.land.localToWorld(fp.set(0, LAND.sy * 0.5, 0));
      else fp.copy(this.land.position);
      // the phone hero box is narrow, so the landscape needs less push-in to stay whole
      fz = this.layout.phone ? 0.86 : 0.48;
    } else fp.set(a.focus[0], a.focus[1], a.focus[2]);
    const kf = 1 - Math.exp(-dt * 3);
    if (this.time < 0.05) this.focusP.copy(fp);
    this.focusP.lerp(fp, kf);
    this.focusZ += (fz - this.focusZ) * kf;
    // opening push-in
    this.zoomF += (this.zoomT - this.zoomF) * (1 - Math.exp(-dt * (this.time < 5 ? 0.7 : 5)));

    const cam = this.camera;
    const { w, h } = this;
    cam.aspect = w / h;
    const tan = Math.tan((cam.fov * Math.PI) / 360);
    // fit the hero box (heroW × heroH world units) into the layout region
    const visH = Math.max((a.heroH * h) / Math.max(80, this.lay.h), (a.heroW * h) / Math.max(80, this.lay.w));
    const dist = (visH / (2 * tan)) * this.zoomF * this.focusZ;
    const F = this.focusP;
    cam.position.set(F.x + Math.sin(this.yaw) * Math.cos(this.pitch) * dist, F.y + Math.sin(this.pitch) * dist, F.z + Math.cos(this.yaw) * Math.cos(this.pitch) * dist);
    cam.lookAt(F);
    cam.setViewOffset(w, h, w / 2 - this.lay.cx, h / 2 - this.lay.cy, w, h);
    cam.updateProjectionMatrix();
  }

  private ensureLandscape(model: Model): void {
    if (this.shapeKey === model.shapeKey && this.landTo) return;
    this.shapeKey = model.shapeKey;
    const next = buildLandscape(model.pot, model.gas);
    this.landStart.set(this.landPos);
    const first = !this.landTo;
    this.landFrom = this.landTo ?? next;
    this.landTo = next;
    this.morph = first ? 1 : 0;
    if (first) this.landStart.set(next.pos);
    // colours: unstable region tinted gold
    const col = this.surfGeo.attributes.color as THREE.BufferAttribute;
    let cx = 0, cy = 0, cz = 0, cn = 0;
    for (let k = 0; k < NT * NV; k++) {
      const u = next.unstable[k];
      const hc = heightColor(next.pos[k * 3 + 1], !!u).map((v) => Math.pow(v, 2.2)); // sRGB ramp → linear
      col.setXYZ(k, hc[0], hc[1], hc[2]);
      col.setXYZ(NT * NV + k, hc[0] * 0.55, hc[1] * 0.55, hc[2] * 0.55);
      if (u) {
        cx += next.pos[k * 3];
        cy += next.pos[k * 3 + 1];
        cz += next.pos[k * 3 + 2];
        cn++;
      }
    }
    for (let q = 2 * NT * NV; q < col.count; q++) col.setXYZ(q, 0.42, 0.32, 0.18); // brass-toned slab edge
    col.needsUpdate = true;
    this.unstableTo = cn > 20 ? new THREE.Vector3(cx / cn, cy / cn, cz / cn) : null;
    this.setLandPlaque(model.pot);
    this.setRailText(model.pot);
  }

  private applyLandscape(dt: number): void {
    if (!this.landTo) return;
    const was = this.morph;
    this.morph = Math.min(1, this.morph + dt / 0.6);
    if (was >= 1 && this.morph >= 1 && this.landPos[0] === this.landTo.pos[0] && this.landPos[4] === this.landTo.pos[4]) return;
    const e = ease(this.morph);
    const a = this.landStart, b = this.landTo.pos, p = this.landPos;
    for (let k = 0; k < p.length; k++) p[k] = a[k] + (b[k] - a[k]) * e;
    const pos = this.surfGeo.attributes.position as THREE.BufferAttribute;
    const arr0 = pos.array as Float32Array;
    const n = NT * NV;
    const th = SLAB / LAND.sy;
    arr0.set(p);
    for (let k = 0; k < n; k++) {
      arr0[(n + k) * 3] = p[k * 3];
      arr0[(n + k) * 3 + 1] = p[k * 3 + 1] - th;
      arr0[(n + k) * 3 + 2] = p[k * 3 + 2];
    }
    const R0 = 2 * n;
    this.rimIdx.forEach((k, q) => {
      const t = (R0 + q * 2) * 3;
      arr0[t] = arr0[t + 3] = p[k * 3];
      arr0[t + 1] = p[k * 3 + 1];
      arr0[t + 4] = p[k * 3 + 1] - th;
      arr0[t + 2] = arr0[t + 5] = p[k * 3 + 2];
    });
    pos.needsUpdate = true;
    const cpos = this.contours.geometry.attributes.position as THREE.BufferAttribute;
    const cn = contourSegments(p, CONTOUR_LEVELS, cpos.array as Float32Array, 0.008);
    cpos.needsUpdate = true;
    this.contours.geometry.setDrawRange(0, cn / 3);
    this.surfGeo.computeVertexNormals();
    this.surfGeo.computeBoundingSphere();
    // rails: front edge (first variable) and left edge (second variable), just under the slab
    const drop = (SLAB + 0.03) / LAND.sy;
    const edge = (ks: number[]) => ks.map((k) => new THREE.Vector3(p[k * 3] * LAND.sx, (p[k * 3 + 1] - drop) * LAND.sy, p[k * 3 + 2] * LAND.sz));
    const front = edge(Array.from({ length: NT }, (_, i) => i * NV + NV - 1));
    const side = edge(Array.from({ length: NV }, (_, j) => j));
    [front, side].forEach((pts, i) => {
      const r = this.rails[i];
      r.geometry.dispose();
      r.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.008, 6, false);
      const mid = pts[Math.floor(pts.length * (i ? 0.5 : 0.55))];
      this.railLabels[i].position.set(mid.x + (i ? -0.18 : 0), mid.y - 0.07, mid.z + (i ? 0 : 0.1));
    });
    for (const l of [this.majorT, this.majorV, this.minor, this.rim]) {
      const idx = l.geometry.userData.idx as number[];
      const lp = l.geometry.attributes.position as THREE.BufferAttribute;
      const arr = lp.array as Float32Array;
      for (let q = 0; q < idx.length; q++) {
        const k = idx[q] * 3;
        arr[q * 3] = p[k];
        arr[q * 3 + 1] = p[k + 1] + 0.012;
        arr[q * 3 + 2] = p[k + 2];
      }
      lp.needsUpdate = true;
    }
  }

  /** State → landscape-local position (scaled), following the morph. */
  private landPoint(T: number, V: number, out = new THREE.Vector3()): THREE.Vector3 {
    const b = this.landTo!.map(T, V);
    let x = b[0], y = b[1], z = b[2];
    if (this.morph < 1 && this.landFrom) {
      const a = this.landFrom.map(T, V);
      const e = ease(this.morph);
      x = a[0] + (b[0] - a[0]) * e;
      y = a[1] + (b[1] - a[1]) * e;
      z = a[2] + (b[2] - a[2]) * e;
    }
    return out.set(x * LAND.sx, y * LAND.sy, z * LAND.sz);
  }

  private tube(mesh: THREE.Mesh, pts: THREE.Vector3[]): void {
    mesh.geometry.dispose();
    mesh.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.013, 6, false);
  }

  private updateLandscapeExtras(model: Model): void {
    const gas: Gas = model.gas;
    const T = model.T, V = model.V;
    const p0 = this.landPoint(T, V);
    this.bead.position.copy(p0).add(new THREE.Vector3(0, 0.04, 0));
    this.beadLight.position.copy(p0).add(new THREE.Vector3(0, 0.22, 0.05));
    const pot = model.pot;
    const span = naturalSpan(pot, gas);
    const sgn2 = pot === "G" || pot === "H" ? -1 : 1;
    const st = naturalSteps(pot, gas, T, V, span[0] * 0.05, sgn2 * span[1] * 0.05);
    const dirs = [st.s1, st.s2].map(([t, v]) => this.landPoint(t, v).sub(p0).normalize());
    this.arrows.forEach((a, i) => {
      a.position.copy(this.bead.position);
      a.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dirs[i]);
      a.scale.setScalar(this.layout.phone ? 1.3 : 1);
    });
    // show why: the two orders of steps meet at one corner
    const on = model.showWhy;
    for (const o of [this.whyA, this.whyB, this.whyFill, this.whyGlow]) o.visible = on;
    if (on) {
      const q = naturalSteps(pot, gas, T, V, span[0] * 0.16, sgn2 * span[1] * 0.18);
      const lift = new THREE.Vector3(0, 0.022, 0);
      const leg = (a: [number, number], b: [number, number]) => {
        const out: THREE.Vector3[] = [];
        for (let k = 0; k <= 10; k++) {
          const s = k / 10;
          const t = a[0] + (b[0] - a[0]) * s;
          const v = Math.exp(Math.log(a[1]) + (Math.log(b[1]) - Math.log(a[1])) * s);
          out.push(this.landPoint(t, v).add(lift));
        }
        return out;
      };
      const s0: [number, number] = [T, V];
      const A = [...leg(s0, q.s2), ...leg(q.s2, q.s12).slice(1)];
      const B = [...leg(s0, q.s1), ...leg(q.s1, q.s12).slice(1)];
      this.tube(this.whyA, B);
      this.tube(this.whyB, A);
      this.whyPts = { a: B[Math.floor(B.length * 0.3)], b: A[Math.floor(A.length * 0.3)], c: B[B.length - 1] };
      const fp = this.whyFill.geometry.attributes.position as THREE.BufferAttribute;
      [s0, q.s1, q.s12, q.s2].forEach((s, i) => {
        const p = this.landPoint(s[0], s[1]).add(lift);
        fp.setXYZ(i, p.x, p.y, p.z);
      });
      fp.needsUpdate = true;
      this.whyFill.geometry.computeBoundingSphere();
      this.whyGlow.position.copy(this.landPoint(q.s12[0], q.s12[1]).add(lift));
      this.whyGlow.material.opacity = 0.7 + 0.3 * Math.sin(this.time * 5);
    }
    // critical point star
    const c = model.crit;
    const showStar = !!c && c.Tc >= T_MIN && c.Tc <= T_MAX && c.Vc >= V_MIN;
    this.critStar.visible = showStar;
    if (c && showStar) {
      this.critStar.position.copy(this.landPoint(c.Tc, c.Vc)).add(new THREE.Vector3(0, 0.03, 0));
      const near = Math.exp(-Math.pow(Math.log(T / c.Tc) / 0.08, 2) - Math.pow(Math.log(V / c.Vc) / 0.5, 2));
      this.critStar.scale.setScalar((0.13 + 0.06 * near) * (model.showWhy ? 0.6 : 1) * (1 + 0.08 * Math.sin(this.time * 3)));
    }
    // unstable region marker follows the morph
    if (this.unstableTo) {
      const u = this.unstableTo;
      this.unstableCentroid = new THREE.Vector3(u.x * LAND.sx, u.y * LAND.sy + 0.03, u.z * LAND.sz);
    } else this.unstableCentroid = null;
  }

  render(dt: number, model: Model): void {
    this.updateCamera(dt);
    this.ensureLandscape(model);
    this.applyLandscape(dt);
    this.updateLandscapeExtras(model);
    const rel = RELATIONS[model.relation];
    const runT = model.runT;
    const running = runT >= 0;

    // experiment visuals
    const heatWindow = running ? ease((runT - 0.2) / 0.3) * (1 - ease((runT - 1.85) / 0.4)) : 0;
    const slide = running ? easeBack((runT - 0.3) / 1.2) * (1 - ease((runT - (RUN_S - 0.35)) / 0.35)) : 0;
    const live = model.live;
    const baseH = gasH(model.V);
    const vis = 0.09;
    const lm: LeftMode = rel.left, rm: RightMode = rel.right;
    const leftDir = lm === "bath-expand" || lm === "weight-heat" ? 1 : lm === "bath-squeeze" ? -1 : 0;
    const rightDir = rm === "insulated-expand" || rm === "weight-warm" ? 1 : rm === "insulated-squeeze" ? -1 : 0;
    const leftHeat = (lm === "bath-squeeze" ? -1 : 1) * heatWindow * Math.min(1, 0.45 + 0.55 * Math.tanh(Math.abs(live.q) / 20));
    const rightHeat = rm === "lock-warm" || rm === "weight-warm" ? heatWindow * 0.8 : 0;
    const pinIn = (m: string) => m === "lock-heat" || m === "lock-warm";
    const clickDelay = running && runT < 0.12;
    this.left.update(dt, baseH + leftDir * vis * slide, model.T, leftHeat, { lock: pinIn(lm) && !clickDelay, weight: lm === "weight-heat" && !(running && runT < 0.15), insulated: false, runT });
    this.right.update(dt, baseH + rightDir * vis * slide, model.T, rightHeat, { lock: pinIn(rm) && !clickDelay, weight: rm === "weight-warm" && !(running && runT < 0.15), insulated: rm === "insulated-expand" || rm === "insulated-squeeze", runT });

    // dials: thermometer on 150..900 K, gauge log 10..100 000 kPa; the experiment swing is magnified
    const span = Math.PI * 1.5;
    const tf = (model.T - 150) / 750;
    const P = model.P;
    const pf = Math.max(0, Math.min(1, (Math.log10(Math.max(1, P)) - 1) / 4));
    const swing = 0.4 * (running ? ease((runT - 0.35) / 0.9) * (1 - ease((runT - (RUN_S - 0.3)) / 0.3)) : 0);
    const tSign = rm === "insulated-expand" ? -1 : 1;
    const pSign = rm === "insulated-expand" ? -1 : rm === "weight-warm" ? 0 : 1;
    if (this.right.thermo) {
      spring(this.right.thermo.s, -(-span / 2 + span * tf + tSign * swing), dt, 80, 7);
      this.right.thermo.needle.rotation.z = this.right.thermo.s.x;
    }
    if (this.right.gauge) {
      spring(this.right.gauge.s, -(-span / 2 + span * pf + pSign * swing), dt, 80, 7);
      this.right.gauge.needle.rotation.z = this.right.gauge.s.x;
    }

    // bars and the equals bracket
    const lv = [model.barHard, model.barEasy];
    lv.forEach((l, i) => {
      const hgt = Math.max(0.001, l * BAR_H);
      this.barFill[i].scale.y = hgt;
      this.barFill[i].position.y = 0.075 + hgt / 2;
      this.barCap[i].position.y = 0.075 + hgt;
      this.barCap[i].visible = l > 0.005;
      this.barFill[i].visible = l > 0.005;
    });
    const top = Math.max(lv[0], lv[1]);
    spring(this.bracketS, 0.075 + top * BAR_H + 0.085, dt, 50, 10);
    this.bracket.position.y = this.bracketS.x;
    const matched = model.measured && !running && Math.abs(model.live.matchPct - 100) < 1 && top > 0.02;
    const flash = Math.exp(-model.matchAge * 2.2);
    const glowI = (matched ? 1.8 : 0.05) + flash * 5;
    this.bracketMat.emissiveIntensity = glowI;
    const glow = this.bracket.getObjectByName("glow") as THREE.Sprite;
    glow.material.opacity = Math.min(1, (matched ? 0.45 : 0) + flash * 0.9);
    glow.scale.setScalar(0.45 + flash * 0.6);

    // dust drift
    const dp = this.dust.geometry.attributes.position as THREE.BufferAttribute;
    const arr = dp.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i + 1] += dt * 0.02 * (0.5 + ((i * 7) % 5) / 5);
      arr[i] += Math.sin(this.time * 0.3 + i) * dt * 0.01;
      if (arr[i + 1] > 3.3) arr[i + 1] = -0.2;
    }
    dp.needsUpdate = true;

    this.finish.uniforms.uTime.value = this.time;
    this.composer.render(dt);
    this.computeAnchors(model);
  }

  private computeAnchors(model: Model): void {
    this.scene.updateMatrixWorld();
    const r = this.canvas.getBoundingClientRect();
    const P = (o: THREE.Object3D, local: [number, number, number]) => {
      const v = this.v3.set(local[0], local[1], local[2]).applyMatrix4(o.matrixWorld);
      return this.proj(v, r);
    };
    const L = this.left.group, Rg = this.right.group;
    const lh = this.left.gasTop + PISTON_H + ROD_L + 0.12;
    const rh = CAP_Y + 0.55;
    const a: Anchors = {};
    a.hardTitle = P(L, [0, Math.max(lh, CAP_Y + 0.2), 0]);
    a.easyTitle = P(Rg, [-0.18, rh, 0.06]);
    a.heat = P(L, [0, 0.12, CYL_R + 0.12]);
    const rel = RELATIONS[model.relation];
    a.rightTag = rel.right === "lock-warm" ? P(Rg, [0.08, CAP_Y + 0.115, 0]) : rel.right === "weight-warm" ? P(Rg, [0, this.right.gasTop + PISTON_H + ROD_L + 0.14, 0]) : P(Rg, [CYL_R + 0.03, 0.75, 0.1]);
    a.leftTag2 = rel.left === "lock-heat" ? P(L, [0.08, CAP_Y + 0.115, 0]) : rel.left === "weight-heat" ? P(L, [0, this.left.gasTop + PISTON_H + ROD_L + 0.14, 0]) : undefined;
    if (this.right.gauge) a.gauge = P(this.right.gauge.group, [0.14, 0, 0]);
    if (this.right.thermo) a.thermo = P(this.right.thermo.group, this.layout.phone ? [0.05, -0.08, 0] : [0.15, -0.05, 0]);
    a.barHard = P(this.bars, [-BAR_X, 0.075 + model.barHard * BAR_H + 0.02, 0]);
    a.barEasy = P(this.bars, [BAR_X, 0.075 + model.barEasy * BAR_H + 0.02, 0]);
    a.bracket = P(this.bracket, [0, 0.06, 0]);
    a.landscape = P(this.land, [0.2, 0.62, -LAND.sz]);
    a.bead = P(this.land, [this.bead.position.x, this.bead.position.y + 0.04, this.bead.position.z]);
    a.crit = this.critStar.visible ? P(this.land, [this.critStar.position.x, this.critStar.position.y, this.critStar.position.z]) : undefined;
    a.unstable = this.unstableCentroid ? P(this.land, [this.unstableCentroid.x, this.unstableCentroid.y, this.unstableCentroid.z]) : undefined;
    const tip = (i: number) => {
      const ar = this.arrows[i];
      const v = new THREE.Vector3(0, 0.2, 0).applyQuaternion(ar.quaternion).multiplyScalar(ar.scale.x).add(ar.position);
      return P(this.land, [v.x, v.y, v.z]);
    };
    a.slope1 = tip(0);
    a.slope2 = tip(1);
    if (model.showWhy && this.whyPts) {
      const w = this.whyPts;
      a.whyA = P(this.land, [w.a.x, w.a.y, w.a.z]);
      a.whyB = P(this.land, [w.b.x, w.b.y, w.b.z]);
      a.whyC = P(this.land, [w.c.x, w.c.y, w.c.z]);
    }
    a.plaqueHard = P(this.plaques.hard, [0, 0, 0]);
    a.plaqueEasy = P(this.plaques.easy, [0, 0, 0]);
    a.plaqueLand = P(this.plaques.land, [0, 0, 0]);
    this.anch = a;
  }

  private proj(v: THREE.Vector3, r: DOMRect): { x: number; y: number; on: boolean } {
    const p = v.clone().project(this.camera);
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height, on: p.z < 1 && p.z > -1 };
  }

  stats(): Record<string, number> {
    const i = this.renderer.info;
    return { geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length ?? 0, calls: i.render.calls };
  }

  dispose(): void {
    this.renderer.dispose();
    this.composer.dispose();
    this.canvas.remove();
  }
}
