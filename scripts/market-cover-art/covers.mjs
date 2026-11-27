/**
 * The spec: every plugin the market document gives a cover, by its folder there (the package's
 * unscoped name), with the template or scene it is drawn with and its colour.
 *
 * - `hue` is an OKLCH hue angle; `l` and `c` the field's lightness and chroma. Each plugin keeps
 *   the hue family its `tone` in the market document names, so the field a card shows while the
 *   picture loads is the picture's own colour; neighbours that share a family differ by shade.
 * - `template`: `scene` (SCENES[id] in scenes.mjs), `stage` or `emblem` (drawn from the plugin's
 *   icon) or `lettering` (drawn from `letters`, a `\n` between lines).
 * - `icon`: the plugin's 24 × 24 line icon, read from `plugins/<id>/icon.svg` when it is not given.
 * - `scale` and `shift`: the subject's size and offset about the centre, to fill the safe area.
 * - `backdrop`: `rings` or `squares` behind the subject, or `none`.
 */

/** The market document's hue families, in OKLCH: the tones it names, converted. */
const FAMILY = {
  violet: { hue: 295, l: 0.54, c: 0.12 },
  amber: { hue: 80, l: 0.72, c: 0.14 },
  teal: { hue: 189, l: 0.55, c: 0.1 },
  blue: { hue: 255, l: 0.54, c: 0.12 },
  plum: { hue: 350, l: 0.54, c: 0.12 },
  green: { hue: 150, l: 0.54, c: 0.12 },
  slate: { hue: 248, l: 0.52, c: 0.03 },
  orange: { hue: 50, l: 0.64, c: 0.15 },
  red: { hue: 25, l: 0.58, c: 0.15 },
};

const of = (family, shade = {}) => ({ ...FAMILY[family], ...shade });
const scene = (family, shade, rest = {}) => ({ template: "scene", ...of(family, shade), ...rest });
const emblem = (shade) => ({ template: "emblem", ...of("slate", shade), scale: 1.15 });
const lettering = (letters, family, shade) => ({
  template: "lettering",
  letters,
  ...of(family, shade),
});

export const COVERS = {
  a2ui: scene("violet", {}, { scale: 1.18 }),
  "agent-company": scene("amber", {}, { scale: 1.1 }),
  "agent-development": scene("blue", { hue: 262, l: 0.5 }, { scale: 1.25, backdrop: "rings" }),
  "agent-evaluation": scene("teal", {}, { scale: 1.12 }),
  "browser-automation": scene("blue", {}, { scale: 1.15 }),
  "continual-learning": scene("violet", { hue: 285, l: 0.5 }, { scale: 1.15, backdrop: "rings" }),
  "data-analysis": scene("green", { hue: 156, l: 0.5 }, { scale: 1.25 }),
  "default-rsi-toolkit": scene("plum", {}, { scale: 1.08 }),
  goal: scene("green", { hue: 145, l: 0.58, c: 0.14 }, { scale: 1.12 }),
  "model-development": scene("orange", { hue: 46, l: 0.6 }, { scale: 1.22, backdrop: "rings" }),
  "penguin-support": scene("teal", { hue: 196, l: 0.58 }, { scale: 1.15 }),
  "sandbox-bwrap": emblem({ c: 0.035 }),
  "sandbox-dsh": emblem({ hue: 205, l: 0.5, c: 0.035 }),
  "sandbox-seatbelt": emblem({ hue: 275, l: 0.47 }),
  "sandbox-wsl": emblem({ hue: 232, l: 0.56, c: 0.04 }),
  "skill-porting": scene("blue", { hue: 245, l: 0.58 }, { scale: 1.1 }),
  "software-development": scene("violet", { hue: 300, l: 0.5 }, { scale: 1.15 }),
  "trace-lookup": scene("amber", { hue: 72, l: 0.68 }, { scale: 1.12 }),
  "use-bento-slides": scene("orange", { hue: 54, l: 0.66 }, { scale: 1.2 }),
  "use-firecrawl": scene("red", {}, { scale: 1.2 }),
  humanizer: scene("plum", { hue: 345, l: 0.5 }, { scale: 1.12 }),
  "use-claude-code": scene("teal", { hue: 182, l: 0.52 }, { scale: 1.2 }),
  "ace-rsi-toolkit": lettering("ACE", "blue"),
  "ape-rsi-toolkit": lettering("APE", "orange"),
  "awm-rsi-toolkit": lettering("AWM", "teal"),
  "openskill-rsi-toolkit": lettering("Open\nSkill", "green"),
  "opro-rsi-toolkit": lettering("OPRO", "red"),
  "rrsi-rsi-toolkit": lettering("RRSI", "violet"),
  "skilladam-rsi-toolkit": lettering("Skill\nAdam", "amber"),
  "skillopt-rsi-toolkit": lettering("Skill\nOpt", "plum", { hue: 340 }),
  "trace-rsi-toolkit": lettering("TRACE", "red", { hue: 18, l: 0.54 }),
};
