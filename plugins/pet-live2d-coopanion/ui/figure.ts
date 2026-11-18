/**
 * The pet's Coopanion figure driver: the browser half of @penguinharness/pet-live2d-coopanion.
 *
 * The BRIDGE, and nothing else: a Coopanion figure pack — its kit (body simulation), its
 * figure (the drawn character), its textures — is loaded AT RUN TIME from the installation
 * the settings name, served by this package's own route (`/pack/…`), and called through
 * the pack frame's own contract. Nothing from Coopanion is in this file, this package or
 * this repository: the kit's `createBody`, the figure's `createWhaleBody` (or whatever
 * pack the configuration picks), are Coopanion's, imported from Coopanion's files, running
 * where they were installed. What this file owns is the translation between that body and
 * the pet package's figure contract (plugins/pet/ui/figure/contract.ts):
 *
 *   contract (page)            this file                Coopanion pack
 *   ────────────────           ─────────                ──────────────
 *   step(dt)            →      clock + frame      →     body.step(dt)
 *   do(word)            →      same word          →     body.do(word)
 *   walk(x, run)        →      wish               →     body.walk(x, run)
 *   pointer(type, at)   →      stage point        →     body.pointer(type, at)
 *   set({roam, …})      →      conditions         →     body.set({ roam, dialogOpen, … })
 *   layout().hit        ←      from               ←     body.layout().hit
 *   emit("touch", …)    ←      from               ←     the body's onEvent
 *
 * The vocabulary passes through unchanged on purpose: the kit's words (`excited`, `sad`,
 * `sit`, `sleep`, `stand`) are the page's words already — the habits and the `wish` orders
 * were written against them when the pet ran the vendored copy, so a pack that carries the
 * same words answers the same habits with no translation table to drift. A word the pack
 * does not know is a no-op inside the pack itself (its own rule).
 *
 * The pack directory comes from the pet's `figure` configuration block, `figure.pack`:
 * a relative path under the served installation ("" = the served directory itself). The
 * figure pack's `figure.json` (api 2) names its `entry` and `export`; the kit is beside
 * it at `kit/body.js` — the frame's own layout, read rather than assumed: a pack that
 * declares different names in its manifest is read through them.
 */

const PACK_URL = "/api/plugins/@penguinharness/pet-live2d-coopanion/pack/";

/** Reads one file of the served installation, as text. */
async function readPack(path: string): Promise<string> {
  const res = await fetch(new URL(path, PACK_URL), { credentials: "same-origin" });
  if (!res.ok) throw new Error(`the Coopanion installation answered ${res.status} for ${path}`);
  return res.text();
}

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

/** A pack's body, as the kit builds it: everything optional, the pack's own surface. */
interface PackBody {
  step?(dt: number): void;
  layout?(): { hit: Array<{ x: number; y: number; r: number }>; bubble: { x: number; y: number } };
  do?(word: string): void;
  cue?(kind: string): void;
  walk?(x: number, run?: boolean): unknown;
  stopWalk?(): void;
  pointer?(type: string, at: { x: number; y: number } | null): void;
  place?(x: number, facing: number, y?: number): void;
  set?(s: Record<string, unknown>): void;
  talk?(): void;
  resize?(): void;
  dispose?(): void;
  words?: readonly string[];
}

/** The kit, as the pack frame builds it: at least a body factory. */
interface PackKit {
  createBody?: (...args: unknown[]) => unknown;
  [key: string]: unknown;
}

/** A figure pack manifest (api 2): the entry, the export and the model it names. */
interface PackManifest {
  api: number;
  entry?: string;
  export?: string;
  model?: string;
}

/**
 * Creates the pet on a stage, per the contract. Resolves once the pack's figure is up;
 * rejects with the reason she cannot be drawn (no installation configured, a manifest
 * that does not parse, a module that would not import).
 */
export async function createFigure(stage: PetStage, config: PetFigureConfig): Promise<CoopanionFigure> {
  const figure = (config.figure ?? {}) as Record<string, unknown>;
  const pack = typeof figure.pack === "string" ? figure.pack : "";

  // The manifest first: it names the entry and the export this bridge calls.
  const manifest = JSON.parse(await readPack(join(pack, "figure.json"))) as PackManifest;
  if (manifest.api !== 2) throw new Error(`figure.json api ${manifest.api}, this bridge speaks 2`);
  const entry = typeof manifest.entry === "string" ? manifest.entry : "figure.js";
  const exported = typeof manifest.export === "string" ? manifest.export : null;

  // The kit is the frame's own, from the same installation (web/kit/body.js beside the pack).
  const kit = (await import(new URL(join(pack, "kit", "body.js"), PACK_URL).href)) as PackKit;

  // The pack's entry: the export the manifest names (createWhaleBody on the shipped packs).
  const mod = (await import(new URL(join(pack, entry), PACK_URL).href)) as Record<string, unknown>;
  const create = exported !== null ? mod[exported] : (mod.createFigure ?? mod.default);
  if (typeof create !== "function")
    throw new Error(`the pack's ${entry} exports no ${exported ?? "create"}`);

  // The model.json read here, the way the page used to: the first file the figure needs,
  // and the one whose URL must carry the pack's own stamp — the route revalidates, so the
  // query is only for the browser's memory of it across this document's reloads.
  const model = (await fetch(new URL(join(pack, manifest.model ?? "model.json"), PACK_URL), {
    credentials: "same-origin",
  }).then((r) => r.json())) as unknown;

  // The stage element: what the kit draws into. The page's root is hers whole.
  const root = document.createElement("div");
  root.style.cssText = "position:absolute;inset:0;pointer-events:none;";
  stage.root.appendChild(root);

  // Call the pack the frame calls it: the kit handed over, the model and the asset loader
  // with it. `ground: "free"` is the stage contract — she stands and walks on the whole
  // page — and the drop point is wherever the stage's start says.
  const body = (await create(new URL(join(pack, ""), PACK_URL).href, {
    kit,
    model,
    asset: (p: string) => new URL(join(pack, p), PACK_URL).href,
    ground: "free",
    host: {
      root,
      bounds: stage.bounds,
      emit: stage.emit,
      sound: () => {},
      start: stage.start,
    },
  })) as PackBody;

  return new CoopanionFigure(body, root);
}

/** `a/b` with exactly one slash, however the parts were written. */
function join(...parts: Array<string>): string {
  return parts
    .filter((p) => p !== "")
    .map((p, i) => (i === 0 ? p.replace(/\/+$/, "") : p.replace(/^\/+|\/+$/g, "")))
    .join("/");
}

/**
 * The contract's face over the pack's body. Everything the page may ask is in the
 * interface; everything the body answers is in the kit's return — this class is the
 * seam, and holds no state of its own beyond the frame loop the page drives.
 */
class CoopanionFigure {
  #body: PackBody;
  #root: HTMLElement;
  #disposed = false;

  constructor(body: PackBody, root: HTMLElement) {
    this.#body = body;
    this.#root = root;
  }

  step(dt: number) {
    if (!this.#disposed) this.#body.step?.(dt);
  }

  layout() {
    return (
      this.#body.layout?.() ?? {
        hit: [{ x: 0, y: 0, r: 0 }],
        bubble: { x: 0, y: 0 },
      }
    );
  }

  do(word: string) {
    this.#body.do?.(word);
  }

  cue(kind: string) {
    // The kit's own moments, same names the body contract already carried.
    this.#body.cue?.(kind);
  }

  walk(x: number, run?: boolean): boolean {
    return this.#body.walk ? !!this.#body.walk(x, run) : false;
  }

  stopWalk() {
    this.#body.stopWalk?.();
  }

  pointer(type: "down" | "move" | "up" | "cancel" | "leave", at: { x: number; y: number } | null) {
    this.#body.pointer?.(type, at);
  }

  place(x: number, facing: 1 | -1, y?: number) {
    this.#body.place?.(x, facing, y);
  }

  set(s: { roam?: "free" | "off"; dialogOpen?: boolean; dark?: boolean }) {
    // The kit body's own set() reads s.theme, not s.dark: the page's mode word lands on
    // the documentElement through it, where the kit's CSS (prefers-color-scheme and the
    // [data-theme] attribute) picks it up.
    this.#body.set?.(s.dark === undefined ? s : { ...s, theme: s.dark === true ? "dark" : "light" });
  }

  talk() {
    this.#body.talk?.();
  }

  resize() {
    this.#body.resize?.();
  }

  dispose() {
    this.#disposed = true;
    this.#body.dispose?.();
    this.#root.remove();
  }

  get words(): readonly string[] {
    return this.#body.words ?? [];
  }
}
