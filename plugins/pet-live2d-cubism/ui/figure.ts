/**
 * The pet's Cubism figure driver: the browser half of @penguinharness/pet-live2d-cubism.
 *
 * An adapter over the official Cubism Web SDK, answering the pet package's figure contract
 * (plugins/pet/ui/figure/contract.ts — the whole interface, and the only thing this file
 * knows of the pet). The SDK itself is NOT in this repository: `scripts/fetch-cubism.mjs`
 * puts it in `./vendor/cubism/` from the official download (Core is Live2D's proprietary
 * build, the Framework its Open Software License, and both travel under their own terms),
 * and this file imports it by bare specifier resolved from there at run time.
 *
 * The model pack is the operator's too, served by this package's own route
 * (`/api/plugins/@penguinharness/pet-live2d-cubism/model/…`) from a directory the
 * settings name. `pet.model3.json` inside it is the entry; its FileReferences name
 * everything else the pack carries, and nothing here knows the pack's insides beyond
 * what that document says.
 *
 * What the adapter owns besides the SDK calls:
 *
 *   - the parameter map (`./parameter-map.json`): the model's parameter IDs differ from
 *     pack to pack (AAAAGENT's lesson), so the names this file drives — head yaw/pitch/roll,
 *     body swing, eye gaze, eye open, mouth open — are looked up through it, and a model
 *     that lacks a parameter is driven as far as it goes rather than not at all;
 *   - the state curves (`Motion` below): the pet's conditions — speaking, thinking,
 *     listening, idle, and the widget's cues — become parameter targets over time, with
 *     the same shape of curve whatever the model;
 *   - the walk: the contract's walk is horizontal travel on the stage, so the adapter
 *     moves the CANVAS and leans the model, not the rig inside it — the model walks as a
 *     whole, the way a sprite would, while its idle breathing plays beneath.
 *
 * Everything the SDK should own, it owns: deformation, physics, blending, the WebGL
 * render. No deformer is re-implemented here.
 */

/* ---------- the vendor seam ----------
 *
 * The SDK resolves from `./vendor/cubism/`, which fetch-cubism.mjs fills. The specifier is a
 * VARIABLE on purpose: the vendor tree is fetched, never committed, so TypeScript cannot see
 * the module — a dynamic import of a non-literal specifier is typed `any`, a literal one
 * would be a compile error.
 */

const BASE = new URL("./", import.meta.url);
const MODEL_URL = "/api/plugins/@penguinharness/pet-live2d-cubism/model/";
const VENDOR_ENTRY = "./vendor/cubism/entry.js";

/** Reads one file of the model pack through this package's own route. */
async function readPack(path: string): Promise<Response> {
  const res = await fetch(new URL(path, MODEL_URL), { credentials: "same-origin" });
  if (!res.ok) throw new Error(`model pack answered ${res.status} for ${path}`);
  return res;
}

/** The parameter map, as fetch-cubism.mjs validated it against the SDK's parameter list. */
const PARAMS = (await fetch(new URL("./parameter-map.json", BASE), {
  credentials: "same-origin",
}).then((r) => r.json())) as Record<string, unknown>;

const SDK = await import(VENDOR_ENTRY);

/* ---------- state curves ----------
 *
 * Semantic timing only, on the AAAAGENT shape: the model IDs and their ranges belong to
 * the parameter map, and these curves only say how a condition feels over time. Targets
 * are unitless (−1..1 across a parameter's own range, 0..1 for the opens) and eased by
 * one tau per group, so a condition change lands as a motion, not a teleport.
 */

/** One named parameter value the adapter drives, as a motion holds it over time. */
type MotionValues = {
  yaw: number;
  pitch: number;
  roll: number;
  body: number;
  gazeX: number;
  gazeY: number;
  eyeOpen: number;
  mouth: number;
};

const smooth = (t: number) => t * t * (3 - 2 * t);

/** One curve sampled at `t`: piecewise-smooth through [time, value] points. */
function curve(t: number, points: ReadonlyArray<readonly [number, number]>): number {
  for (let i = 1; i < points.length; i++) {
    const [end, value] = points[i]!;
    const [start, previous] = points[i - 1]!;
    if (t <= end)
      return previous + (value - previous) * smooth(Math.max(0, (t - start) / (end - start)));
  }
  return points.at(-1)![1];
}

/** How the pet's conditions feel over time: eased targets toward the curve's values. */
class Motion {
  values: MotionValues = { yaw: 0, pitch: 0, roll: 0, body: 0, gazeX: 0, gazeY: 0, eyeOpen: 1, mouth: 0 };
  attentionAt: number | null = null;
  /** Seconds since the walk started, or null when standing. */
  walkPhase: number | null = null;

  attend(now: number) {
    this.attentionAt = now;
  }

  sample({
    now,
    dt,
    elapsed,
    state,
    walkK,
  }: {
    now: number;
    dt: number;
    elapsed: number;
    state: string;
    walkK: number;
  }): MotionValues {
    const age = this.attentionAt === null ? Infinity : Math.max(0, (now - this.attentionAt) / 1000);
    if (age > 0.9) this.attentionAt = null;
    const nod = age <= 0.9 ? curve(age, [[0, 0], [0.12, -1], [0.32, 0.42], [0.7, 0], [0.9, 0]]) : 0;
    const blink = age <= 0.4 ? curve(age, [[0, 0], [0.09, 1], [0.16, 1], [0.35, 0], [0.4, 0]]) : 0;
    const speaking = state === "speaking", thinking = state === "thinking", listening = state === "listening";
    const target: MotionValues = {
      yaw: thinking ? 4 + Math.sin(elapsed * 0.45) * 0.7 : Math.sin(elapsed * 0.75) * (speaking ? 7 : 2) + walkK * 5,
      pitch: (thinking ? -4 : listening ? 3 : Math.sin(elapsed * 1.1) * 2) + nod * 12,
      roll: (thinking ? -7 + Math.sin(elapsed * 0.35) * 0.6 : Math.sin(elapsed * 0.65) * (speaking ? 5 : 2)) + nod * 2,
      body: Math.sin(elapsed * 0.75) * (speaking ? 3 : 1) + nod * 1.8 + (this.walkPhase !== null ? Math.sin(this.walkPhase * 6) * 4 : 0),
      gazeX: thinking ? 0.3 + Math.sin(elapsed * 0.4) * 0.035 : 0,
      gazeY: thinking ? 0.18 : age < 0.9 ? 0.1 : 0,
      eyeOpen: 1 - blink,
      mouth: speaking ? 0.35 + Math.sin(elapsed * 9) * 0.3 : 0,
    };
    const keys = Object.keys(target) as Array<keyof MotionValues>;
    for (const key of keys) {
      const tau = key === "eyeOpen" ? 0.035 : age < 0.9 ? 0.055 : 0.22;
      this.values[key] += (target[key] - this.values[key]) * (1 - Math.exp(-Math.max(0, dt) / tau));
    }
    if (this.walkPhase !== null) this.walkPhase += dt;
    return this.values;
  }
}

/* ---------- the adapter ---------- */

const EXPRESSION_WORDS: Record<string, string> = {
  excited: "happy",
  sad: "sad",
  happy: "happy",
  surprised: "surprised",
  neutral: "neutral",
};

/** The stage, as the pet package's figure contract hands it over (a copy of its shape). */
interface PetStage {
  root: HTMLElement;
  bounds(): { W: number; H: number; floorY: number; S: number };
  emit(kind: string, detail?: unknown): void;
  talk(text: string): void;
  start?: { x: number; y: number };
}

/** The configuration, as the contract hands it over: this driver's own block, verbatim. */
interface PetFigureConfig {
  url: string;
  figure?: unknown;
  dark?: () => boolean;
}

/** The model, as this adapter drives it: the vendor adapter's own PetModel surface. */
interface PetModel {
  load(): Promise<void>;
  apply(values: MotionValues, opts: { facing: number; walkK: number }): void;
  draw(gl: WebGLRenderingContext | WebGL2RenderingContext | null, at: { x: number; groundY: number; scale: number }): void;
  express(emotion: string): void;
  pose(word: string): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

/**
 * Creates the pet on a stage, per the contract. Resolves once the model is loaded and the
 * first frame is ready to draw; rejects with the reason she cannot be drawn (no model
 * configured, a pack that does not parse, a context that will not start).
 */
export async function createFigure(stage: PetStage, config: PetFigureConfig): Promise<CubismPet> {
  const figure = (config.figure ?? {}) as Record<string, unknown>;
  const canvas = document.createElement("canvas");
  canvas.className = "pet-figure-cubism";
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;";
  stage.root.appendChild(canvas);

  const pet = new CubismPet(canvas, stage, figure);
  await pet.load();
  return pet;
}

type Walk = { from: number; to: number; run: boolean };

class CubismPet {
  #canvas: HTMLCanvasElement;
  #stage: PetStage;
  #figure: Record<string, unknown>;
  #model: PetModel | null = null;
  #motion = new Motion();
  #state = "idle";
  #roam: "free" | "off" = "free";
  #dialogOpen = false;
  /** Stage pixels, the anchor's ground point. */
  #x = 0;
  #facing: 1 | -1 = 1;
  #walk: Walk | null = null;
  #elapsed = 0;
  #disposed = false;
  #dark: boolean | null = null;
  #pressed = false;

  constructor(canvas: HTMLCanvasElement, stage: PetStage, figure: Record<string, unknown>) {
    this.#canvas = canvas;
    this.#stage = stage;
    this.#figure = figure;
    this.#x = stage.start?.x ?? 0;
  }

  /** Loads the SDK, the pack and the renderer; the promise `createFigure` waits on. */
  async load() {
    const gl =
      this.#canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: true }) ??
      this.#canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: true });
    if (!gl) throw new Error("WebGL would not start for the Cubism figure");

    const settings = (await (await readPack("pet.model3.json")).json()) as {
      FileReferences?: Record<string, unknown>;
    };
    const refs = settings.FileReferences ?? {};
    if (!refs.Moc) throw new Error("the pack's pet.model3.json names no Moc");

    this.#model = new SDK.PetModel(gl, {
      // Everything the SDK needs comes through this reader, so the pack's layout stays the
      // pack's own: named by its settings document, served by this package's route.
      read: (path: string) => readPack(path).then((r) => r.arrayBuffer()),
      settings,
      params: PARAMS,
    }) as PetModel;
    await this.#model.load();
    this.#resize();
  }

  /* ---------- the contract ---------- */

  step(dt: number) {
    if (this.#disposed || !this.#model) return;
    // The walk advances the travel; the manner plays beneath it.
    if (this.#walk !== null) {
      const speed = (this.#walk.run ? 220 : 130) * dt;
      const dx = this.#walk.to - this.#walk.from;
      const next = this.#x + Math.sign(dx) * Math.min(Math.abs(dx), speed);
      this.#x = next;
      this.#facing = (Math.sign(dx) || this.#facing) as 1 | -1;
      if (next === this.#walk.to) {
        this.#walk = null;
        this.#motion.walkPhase = null;
      }
    }
    const b = this.#stage.bounds();
    const walkK = this.#walk !== null ? 1 : 0;
    const values = this.#motion.sample({
      now: performance.now(),
      dt,
      elapsed: (this.#elapsed += dt),
      state: this.#state,
      walkK,
    });
    this.#model.apply(values, { facing: this.#facing, walkK });
    this.#draw(b);
  }

  layout() {
    const b = this.#stage.bounds();
    // The anchor stands her on the ground, one S per logo unit, the model's canvas square
    // centred on the anchor: her hit circle is the body's disc, her bubble spot the head.
    const scale = b.S * 2.2; // the model's own height is 1.9 units of the canvas square
    const groundY = this.#groundY(b);
    const cx = this.#x;
    const headY = groundY - scale * 1.55;
    return {
      hit: [{ x: cx, y: groundY - scale * 0.9, r: scale * 0.85 }],
      bubble: { x: cx, y: Math.max(0, headY) },
    };
  }

  do(word: string) {
    // A word the map does not know is a no-op, per the contract.
    const emotion = EXPRESSION_WORDS[word];
    if (emotion !== undefined) this.#model?.express(emotion);
    else if (word === "sit" || word === "sleep" || word === "stand") this.#model?.pose(word);
  }

  cue(kind: string) {
    this.#motion.attend(performance.now());
    if (kind === "cheer" || kind === "bounce") this.#model?.express("happy");
  }

  walk(x: number, run = false): boolean {
    if (this.#dialogOpen || this.#walk !== null) return false;
    const b = this.#stage.bounds();
    this.#walk = { from: this.#x, to: Math.min(Math.max(x, 0), b.W), run };
    this.#motion.walkPhase = 0;
    return true;
  }

  stopWalk() {
    this.#walk = null;
    this.#motion.walkPhase = null;
  }

  pointer(type: "down" | "move" | "up" | "cancel" | "leave", at: { x: number; y: number } | null) {
    if (type === "down" && at !== null) {
      const hit = this.layout().hit[0]!;
      const on = Math.hypot(at.x - hit.x, at.y - hit.y) < hit.r;
      if (on) {
        this.#motion.attend(performance.now());
        this.#stage.emit("touch", { kind: "poke" });
      }
    } else if (type === "move" && at !== null && this.#pressed) {
      // Dragged: she follows the pointer horizontally on the ground line.
      this.#x = at.x;
    }
  }

  place(x: number, facing: 1 | -1) {
    if (this.#walk !== null) return;
    this.#x = x;
    if (facing === 1 || facing === -1) this.#facing = facing;
  }

  set(s: { roam?: "free" | "off"; dialogOpen?: boolean; state?: string; dark?: boolean }) {
    if (s.roam === "free" || s.roam === "off") this.#roam = s.roam;
    if (typeof s.dialogOpen === "boolean") this.#dialogOpen = s.dialogOpen;
    if (typeof s.state === "string") this.#state = s.state;
    // A palette per mode arrives with the first pack that carries one; until then the
    // SDK's own rendering is mode-neutral and the word is parked.
    this.#dark = s.dark === true ? true : s.dark === false ? false : this.#dark;
  }

  resize() {
    this.#resize();
  }

  dispose() {
    this.#disposed = true;
    this.#model?.dispose();
    this.#canvas.remove();
  }

  /* ---------- internals ---------- */

  #groundY(b: { floorY: number }) {
    return b.floorY;
  }

  #resize() {
    const b = this.#stage.bounds();
    this.#canvas.width = Math.max(1, Math.round(b.W * devicePixelRatio));
    this.#canvas.height = Math.max(1, Math.round(b.H * devicePixelRatio));
    this.#model?.resize(this.#canvas.width, this.#canvas.height);
  }

  #draw(b: { floorY: number; S: number }) {
    const scale = b.S * 2.2 * devicePixelRatio;
    const groundY = this.#groundY(b) * devicePixelRatio;
    this.#model?.draw(
      this.#canvas.getContext("webgl2") ?? this.#canvas.getContext("webgl"),
      {
        x: this.#x * devicePixelRatio,
        groundY,
        scale,
      },
    );
  }
}
