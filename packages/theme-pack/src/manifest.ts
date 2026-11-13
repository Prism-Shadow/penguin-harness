/**
 * `pack.json`, the manifest: what a picker draws for a pack and what the pre-paint script needs
 * of it, without reading its CSS. The schema is closed — a field this build does not know is
 * refused, never carried along — and the stored copy is normalised: the same fields in one order,
 * `base` written out when the upload left it to its default.
 *
 * The shared UI package declares the same shape for its built-in packs; its suite runs this
 * parser over them, so a built-in manifest can never say what an imported one may not.
 */
import { invalid } from "./problem.js";
import { THEME_PACK_LIMITS } from "./limits.js";

export const MANIFEST_FILE = "pack.json";

export type ThemePackMode = "light" | "dark";
export type ThemePackBase = "modern" | "foundation";

export interface ThemePackManifest {
  readonly api: number;
  readonly id: string;
  readonly names: { readonly zh: string; readonly en: string };
  readonly version: string;
  readonly base: ThemePackBase;
  readonly modes: readonly ThemePackMode[];
  readonly swatches: Readonly<
    Record<
      ThemePackMode,
      { readonly canvas: string; readonly ink: string; readonly accent: string }
    >
  >;
  readonly accent: {
    readonly own: Readonly<Record<ThemePackMode, string>>;
    readonly presets: readonly { readonly id: string; readonly swatch: string }[];
  };
  readonly fonts: {
    readonly sans: string;
    readonly ui: string;
    readonly mono: string;
    readonly cjk: string;
    readonly display: string;
  };
  readonly avatar?: string;
}

/** A pack's id: lowercase, a letter first, 2–32 characters. */
export const THEME_PACK_ID = /^[a-z][a-z0-9-]{1,31}$/;
/** An accent preset's id, and an avatar variant's. */
const SHORT_ID = /^[a-z][a-z0-9-]{0,31}$/;
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const SEMVER =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
/** A display name or a font family: one line of plain text a stylesheet never has to quote. */
const PLAIN_TEXT = /^[^\u0000-\u001f\u007f"'`\\;{}<>]{1,64}$/;
const MODES: readonly ThemePackMode[] = ["light", "dark"];
const FONT_ROLES = ["sans", "ui", "mono", "cjk", "display"] as const;
const MAX_PRESETS = 16;

type Json = Record<string, unknown>;

const fail = (reason: string) => invalid(MANIFEST_FILE, reason);

function object(value: unknown, where: string, keys: readonly string[], optional: string[] = []) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw fail(`${where} must be an object.`);
  }
  const record = value as Json;
  for (const key of Object.keys(record)) {
    if (!keys.includes(key)) throw fail(`${where} has a field this build does not know: "${key}".`);
  }
  for (const key of keys) {
    if (!(key in record) && !optional.includes(key)) throw fail(`${where} needs "${key}".`);
  }
  return record;
}

function text(value: unknown, where: string, pattern: RegExp, what: string): string {
  if (typeof value !== "string" || !pattern.test(value)) throw fail(`${where} must be ${what}.`);
  return value;
}

const hex = (value: unknown, where: string) =>
  text(value, where, HEX, "a hex colour (#rgb, #rrggbb or #rrggbbaa)");
const plain = (value: unknown, where: string) =>
  text(value, where, PLAIN_TEXT, "1–64 characters of plain text");

function perMode<T>(value: unknown, where: string, read: (v: unknown, at: string) => T) {
  const record = object(value, where, MODES);
  return { light: read(record.light, `${where}.light`), dark: read(record.dark, `${where}.dark`) };
}

/** The manifest the bytes hold, or the refusal that names what is wrong with it. */
export function parseManifest(bytes: Uint8Array): ThemePackManifest {
  if (bytes.byteLength > THEME_PACK_LIMITS.manifestBytes) {
    throw fail(`pack.json is over ${THEME_PACK_LIMITS.manifestBytes / 1024} KiB.`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (err) {
    throw fail(
      `pack.json is not UTF-8 JSON (${err instanceof Error ? err.message : String(err)}).`,
    );
  }
  const m = object(
    raw,
    "pack.json",
    ["api", "id", "names", "version", "base", "modes", "swatches", "accent", "fonts", "avatar"],
    ["base", "avatar"],
  );
  if (typeof m.api !== "number" || !Number.isInteger(m.api) || m.api < 1) {
    throw fail("api must be a whole number, 1 or more.");
  }
  const id = text(
    m.id,
    "id",
    THEME_PACK_ID,
    "2–32 lowercase letters, digits or hyphens, a letter first",
  );
  const names = object(m.names, "names", ["zh", "en"]);
  const version = text(m.version, "version", SEMVER, "a semantic version such as 1.0.0");
  const base = m.base ?? "modern";
  if (base !== "modern" && base !== "foundation")
    throw fail('base must be "modern" or "foundation".');
  if (!Array.isArray(m.modes) || m.modes.length === 0) {
    throw fail('modes must list "light", "dark" or both.');
  }
  const modes = m.modes.map((mode) => {
    if (mode !== "light" && mode !== "dark") throw fail('modes may hold only "light" and "dark".');
    return mode;
  });
  if (new Set(modes).size !== modes.length) throw fail("modes names a mode twice.");
  const accent = object(m.accent, "accent", ["own", "presets"]);
  if (!Array.isArray(accent.presets) || accent.presets.length > MAX_PRESETS) {
    throw fail(`accent.presets must be a list of at most ${MAX_PRESETS} presets.`);
  }
  const presets = accent.presets.map((preset, i) => {
    const p = object(preset, `accent.presets[${i}]`, ["id", "swatch"]);
    return {
      id: text(
        p.id,
        `accent.presets[${i}].id`,
        SHORT_ID,
        "1–32 lowercase letters, digits or hyphens",
      ),
      swatch: hex(p.swatch, `accent.presets[${i}].swatch`),
    };
  });
  if (new Set(presets.map((p) => p.id)).size !== presets.length) {
    throw fail("accent.presets names a preset twice.");
  }
  const fonts = object(m.fonts, "fonts", FONT_ROLES);
  const manifest: ThemePackManifest = {
    api: m.api,
    id,
    names: { zh: plain(names.zh, "names.zh"), en: plain(names.en, "names.en") },
    version,
    base,
    modes,
    swatches: perMode(m.swatches, "swatches", (value, where) => {
      const s = object(value, where, ["canvas", "ink", "accent"]);
      return {
        canvas: hex(s.canvas, `${where}.canvas`),
        ink: hex(s.ink, `${where}.ink`),
        accent: hex(s.accent, `${where}.accent`),
      };
    }),
    accent: { own: perMode(accent.own, "accent.own", hex), presets },
    fonts: {
      sans: plain(fonts.sans, "fonts.sans"),
      ui: plain(fonts.ui, "fonts.ui"),
      mono: plain(fonts.mono, "fonts.mono"),
      cjk: plain(fonts.cjk, "fonts.cjk"),
      display: plain(fonts.display, "fonts.display"),
    },
    ...(m.avatar === undefined
      ? {}
      : { avatar: text(m.avatar, "avatar", SHORT_ID, "a built-in avatar variant's id") }),
  };
  return manifest;
}

/** The stored `pack.json`: the parsed fields in schema order, two-space indented. */
export function serializeManifest(manifest: ThemePackManifest): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
}
