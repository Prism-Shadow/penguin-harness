/**
 * The covers' subjects. Three templates draw a cover from what a plugin already has — `stage`
 * (its icon on a lit app tile: any new plugin's cover in one line of the spec), `emblem` (a shield
 * with the icon's inner mark, for the sandbox backends) and `lettering` (the method's name over the
 * RSI loop, for the RSI toolkits) — and SCENES holds one drawing per plugin whose subject is built
 * from the objects of its domain. Each draws inside the kit's SAFE box with the kit's light,
 * corners and shadows; covers.mjs says which plugin uses which.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CX,
  CY,
  TILE_RADIUS,
  glyph,
  iso,
  isoBox,
  isoFootprint,
  oklch,
  pts,
  rect,
  round,
  tile,
} from "./kit.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Glyphs the scenes share, in the product's 24 × 24 line-icon format. */
export const GLYPH = {
  // ICONS.robot and ICONS.puzzle in packages/ui/src/components/icons/icons.ts.
  robot:
    '<path d="M12 8V4H8M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM2 14h2M20 14h2M9 13h.01M15 13h.01M10 16.5s.8 1 2 1 2-1 2-1"/>',
  puzzle:
    '<path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.23 8.77c.24-.24.581-.353.917-.303.515.077.877.528 1.073 1.01a2.5 2.5 0 1 0 3.259-3.259c-.482-.196-.933-.558-1.01-1.073-.05-.336.062-.676.303-.917l1.525-1.525A2.402 2.402 0 0 1 12 1.998c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  cross: '<path d="M7 7l10 10M17 7L7 17"/>',
  question: '<path d="M8.6 9a3.4 3.4 0 1 1 4.8 3.1c-.85.38-1.4 1.2-1.4 2.15V15.2M12 19.2h.01"/>',
  prompt: '<path d="M5 7.5l4.5 4.5L5 16.5M12 17h7"/>',
};

/** A plugin icon's drawing: the elements inside its `<svg>`, from `plugins/<id>/icon.svg`. */
export function iconOf(id) {
  const file = path.join(ROOT, "plugins", id, "icon.svg");
  if (!fs.existsSync(file)) throw new Error(`no icon at plugins/${id}/icon.svg`);
  return innerSvg(fs.readFileSync(file, "utf8"));
}

/** The markup between an SVG document's root tags. */
export function innerSvg(svg) {
  const open = svg.indexOf(">", svg.indexOf("<svg"));
  return svg.slice(open + 1, svg.lastIndexOf("</svg>")).trim();
}

/** The product logo, its ids prefixed so it can sit inside another drawing. */
function penguinLogo(x, y, size) {
  const file = path.join(ROOT, "packages", "web", "public", "penguin-logo.svg");
  const svg = fs.readFileSync(file, "utf8");
  const viewBox = /viewBox="([^"]+)"/.exec(svg)[1];
  const inner = innerSvg(svg)
    .replace(/id="([^"]+)"/g, 'id="pl-$1"')
    .replace(/url\(#([^)]+)\)/g, "url(#pl-$1)")
    .replace(/xlink:href="#([^"]+)"/g, 'href="#pl-$1"')
    .replace(/\shref="#([^"]+)"/g, ' href="#pl-$1"');
  return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="${viewBox}">${inner}</svg>`;
}

const deg = (a) => (a * Math.PI) / 180;
const polar = (cx, cy, r, a) => [
  round(cx + r * Math.cos(deg(a))),
  round(cy + r * Math.sin(deg(a))),
];

/** An arc from angle a0 to a1 (degrees, clockwise on screen) as a path's `d`. */
function arc(cx, cy, r, a0, a1) {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  const sweep = a1 > a0 ? 1 : 0;
  return `M${x0} ${y0}A${r} ${r} 0 ${large} ${sweep} ${x1} ${y1}`;
}

/** A speech bubble: a rounded box with a tail under it, at `tail` from its left edge. */
function bubble(x, y, w, h, r, { tail = 0.18, side = "left", drop = 70 } = {}) {
  const tx = side === "left" ? x + w * tail : x + w * (1 - tail);
  const tw = 96;
  const b = y + h;
  const [t0, t1] = side === "left" ? [tx + tw, tx] : [tx, tx - tw];
  const tip = side === "left" ? [tx - 34, b + drop] : [tx + 34, b + drop];
  return [
    `<path d="M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${b - r}A${r} ${r} 0 0 1 ${x + w - r} ${b}`,
    side === "left"
      ? `H${t0}Q${t0 - 40} ${b + drop * 0.5} ${tip[0]} ${tip[1]}Q${t1 + 6} ${b + drop * 0.35} ${t1} ${b}`
      : `H${t0}Q${t0 - 6} ${b + drop * 0.35} ${tip[0]} ${tip[1]}Q${t1 + 40} ${b + drop * 0.5} ${t1} ${b}`,
    `H${x + r}A${r} ${r} 0 0 1 ${x} ${b - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z"/>`,
  ].join("");
}

/** A row of text as a bar: covers carry no words, so a line of text is drawn as its shape. */
const bar = (x, y, w, h, fill, opacity = 1) =>
  `<rect x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${h}" rx="${h / 2}" fill="${fill}"${opacity === 1 ? "" : ` fill-opacity="${opacity}"`}/>`;

/** A robot head, filled: the product's figure for an agent, legible at a thumbnail's size. */
function robotHead(cx, cy, s, { body, eye, crown, antenna }) {
  const w = s;
  const h = s * 0.74;
  const x = cx - w / 2;
  const y = cy - h / 2 + s * 0.1;
  const out = [];
  if (crown !== undefined) {
    const cw = s * 0.62;
    const ch = s * 0.3;
    const cy0 = y - ch * 0.3;
    out.push(
      `<path d="M${cx - cw / 2} ${cy0}L${cx - cw / 2} ${cy0 - ch}L${cx - cw / 4} ${cy0 - ch * 0.45}L${cx} ${cy0 - ch * 1.15}L${cx + cw / 4} ${cy0 - ch * 0.45}L${cx + cw / 2} ${cy0 - ch}L${cx + cw / 2} ${cy0}Z" fill="${crown}" stroke="${crown}" stroke-width="${s * 0.05}" stroke-linejoin="round"/>`,
    );
  } else {
    out.push(
      `<path d="M${cx} ${y}V${y - s * 0.2}" stroke="${body}" stroke-width="${s * 0.07}" stroke-linecap="round"/>`,
      `<circle cx="${cx}" cy="${y - s * 0.24}" r="${s * 0.075}" fill="${antenna ?? body}"/>`,
    );
  }
  out.push(
    `<rect x="${x - s * 0.06}" y="${y + h * 0.36}" width="${w + s * 0.12}" height="${h * 0.26}" rx="${s * 0.06}" fill="${body}"/>`,
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${s * 0.2}" fill="${body}"/>`,
    `<circle cx="${cx - w * 0.21}" cy="${y + h * 0.44}" r="${s * 0.085}" fill="${eye}"/>`,
    `<circle cx="${cx + w * 0.21}" cy="${y + h * 0.44}" r="${s * 0.085}" fill="${eye}"/>`,
    `<path d="M${cx - w * 0.14} ${y + h * 0.7}Q${cx} ${y + h * 0.8} ${cx + w * 0.14} ${y + h * 0.7}" fill="none" stroke="${eye}" stroke-width="${s * 0.05}" stroke-linecap="round"/>`,
  );
  return out.join("");
}

/** The thick ribbon of the RSI loop: two arcs chasing each other, each ending in an arrowhead. */
function loopRibbon(art, { cx, cy, r, width, face, side, shadow = true }) {
  const segs = [
    [-200, -40],
    [-20, 140],
  ];
  // An arrowhead at angle a, pointing along the clockwise tangent.
  const head = (a) => {
    const [bx, by] = polar(cx, cy, r, a);
    const t = deg(a + 90);
    const n = deg(a);
    const tip = [bx + Math.cos(t) * width * 1.15, by + Math.sin(t) * width * 1.15];
    const l = [bx + Math.cos(n) * width * 1.05, by + Math.sin(n) * width * 1.05];
    const rr = [bx - Math.cos(n) * width * 1.05, by - Math.sin(n) * width * 1.05];
    return `<path d="M${pts([l, tip, rr])}Z"/>`;
  };
  const draw = (color) =>
    `<g fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round">${segs
      .map(([a0, a1]) => `<path d="${arc(cx, cy, r, a0, a1)}"/>`)
      .join(
        "",
      )}</g><g fill="${color}" stroke="${color}" stroke-width="8" stroke-linejoin="round">${segs
      .map(([, a1]) => head(a1))
      .join("")}</g>`;
  // Shadow, then the ribbon's edge (its thickness), then its face.
  return [
    shadow ? art.cast(draw, 26) : "",
    `<g transform="translate(4 12)">${draw(side)}</g>`,
    draw(face),
  ].join("");
}

/** An arc of an ellipse rotated by `rot`, between parameters t0 and t1 (degrees). */
function ellipseArc(cx, cy, rx, ry, rot, t0, t1) {
  const at = (t) => {
    const x = rx * Math.cos(deg(t));
    const y = ry * Math.sin(deg(t));
    return [
      round(cx + x * Math.cos(deg(rot)) - y * Math.sin(deg(rot))),
      round(cy + x * Math.sin(deg(rot)) + y * Math.cos(deg(rot))),
    ];
  };
  const [x0, y0] = at(t0);
  const [x1, y1] = at(t1);
  return `M${x0} ${y0}A${rx} ${ry} ${rot} ${Math.abs(t1 - t0) > 180 ? 1 : 0} 1 ${x1} ${y1}`;
}

/* ----------------------------------------------------------------------------- templates */

/** The plugin's icon on a lit app tile, the backdrop's rounded squares around it. */
export function stage(art, { icon }) {
  return tile(art, { cx: CX, cy: CY - 10, size: 380, icon, lift: 40, glyphScale: 0.54 });
}

/** The lettering face: Mona Sans, the product's own typeface (OFL-1.1), embedded in the file. */
function letteringFace(art) {
  const file = path.join(
    ROOT,
    "packages/ui/node_modules/@fontsource-variable/mona-sans/files/mona-sans-latin-wght-normal.woff2",
  );
  if (!fs.existsSync(file)) throw new Error("lettering needs Mona Sans: run pnpm install first");
  art.def("face|mona", (id) => {
    const data = fs.readFileSync(file).toString("base64");
    return `<style>@font-face{font-family:"${id}";src:url(data:font/woff2;base64,${data}) format("woff2");font-weight:200 900}</style>`;
  });
  return art.defs.get("face|mona").id;
}

/** A line's advance in Mona Sans at its heavy weight, in em, close enough to fit it. */
function advance(line) {
  let em = 0;
  for (const ch of line) {
    if (/[ilI]/.test(ch)) em += 0.3;
    else if (/[MWmw]/.test(ch)) em += 0.88;
    else if (/[A-Z]/.test(ch)) em += 0.7;
    else em += 0.6;
  }
  return em;
}

/**
 * An RSI toolkit: the method's name set large over the loop every toolkit runs. The name is what
 * tells ten toolkits of one family apart at a glance; it is an acronym or a coined name, the same
 * in every language.
 */
export function lettering(art, { letters }) {
  const p = art.pal;
  const face = letteringFace(art);
  const lines = letters.split("\n");
  const widest = Math.max(...lines.map(advance));
  const lh = 0.94;
  const size = Math.round(Math.min(300, 660 / widest, 500 / (lines.length * lh)));
  const cap = 0.72 * size;
  const first = CY - ((lines.length - 1) * lh * size + cap) / 2 + cap;
  const text = (fill) =>
    `<text font-family="${face}" font-weight="860" font-size="${size}" letter-spacing="${round(-0.015 * size)}" text-anchor="middle" fill="${fill}">${lines
      .map((l, i) => `<tspan x="${CX}" y="${round(first + i * lh * size)}">${l}</tspan>`)
      .join("")}</text>`;
  return [
    `<g opacity="0.5">${loopRibbon(art, { cx: CX, cy: CY, r: 318, width: 40, face: p.light, side: p.base, shadow: false })}</g>`,
    art.cast(text, 30),
    text(art.linear([p.paper, p.tint])),
  ].join("");
}

/**
 * A sandbox backend: a bevelled shield inside the dashed bounds it keeps a command in, the
 * icon's inner mark on its face, and the shell prompt it confines at its foot.
 */
export function emblem(art, { icon }) {
  const p = art.pal;
  const shieldD = "M12 3l7 3v5.2c0 4.4-3 8.2-7 9.8-4-1.6-7-5.4-7-9.8V6l7-3z";
  // The icon's own shield is its first element; what follows is the backend's mark.
  const mark = icon.replace(/<path d="M12 3l7 3v5\.2[^"]*"\s*\/>/, "").trim();
  const s = 25;
  const tx = CX - 12 * s;
  const ty = CY - 12 * s - 10;
  const at = (inner) => `<g transform="translate(${tx} ${ty}) scale(${s})">${inner}</g>`;
  const shield = at(`<path d="${shieldD}"/>`);
  const inner = `<g transform="translate(${CX - 12 * s * 0.8} ${ty + 12 * s * 0.2 + 12}) scale(${s * 0.8})"><path d="${shieldD}"/></g>`;
  const bounds = 300;
  return [
    `<rect x="${CX - bounds}" y="${CY - bounds - 10}" width="${2 * bounds}" height="${2 * bounds}" rx="70" fill="none" stroke="${p.light}" stroke-opacity="0.5" stroke-width="5" stroke-dasharray="28 20"/>`,
    art.solid(shield, { fill: art.linear([p.paper, p.tint]), lift: 36, rim: 0 }),
    // The bevel: the right half of the face turned from the light.
    `<g clip-path="${art.clip(`<rect x="${CX}" y="0" width="${CX}" height="900"/>`)}" fill="${p.soft}" fill-opacity="0.55">${shield}</g>`,
    `<g fill="${art.linear([p.mid, p.ink])}">${inner}</g>`,
    `<g clip-path="${art.clip(`<rect x="${CX}" y="0" width="${CX}" height="900"/>`)}" fill="${p.deep}" fill-opacity="0.28">${inner}</g>`,
    `<g transform="translate(${tx} ${ty + 10}) scale(${s})" fill="none" stroke="${p.paper}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${mark}</g>`,
    tile(art, {
      cx: CX + 210,
      cy: CY + 210,
      size: 150,
      icon: GLYPH.prompt,
      fill: art.linear([p.ink, p.deep]),
      color: p.paper,
      width: 2.2,
      lift: 22,
      glyphScale: 0.6,
    }),
  ].join("");
}

/* -------------------------------------------------------------------------------- scenes */

export const SCENES = {
  /** A reply that carries a chart and its choices, a live clock widget lifted off its corner. */
  a2ui(art) {
    const p = art.pal;
    const shape = bubble(500, 210, 600, 380, 60, { tail: 0.16, drop: 74 });
    const donut = (cx, cy, r, w) => {
      const c = 2 * Math.PI * r;
      const seg = (from, to, color) =>
        `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${w}" stroke-dasharray="${round(c * (to - from))} ${round(c)}" stroke-dashoffset="${round(-c * from)}" transform="rotate(-90 ${cx} ${cy})"/>`;
      return seg(0, 0.6, p.accent) + seg(0.6, 0.84, p.mid) + seg(0.84, 1, p.soft);
    };
    const clock = (cx, cy, size) => {
      const r = size * 0.33;
      return [
        tile(art, { cx, cy, size, lift: 28 }),
        `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${p.ink}" stroke-width="${size * 0.06}"/>`,
        `<path d="M${cx} ${cy - r * 0.62}V${cy}L${cx + r * 0.45} ${cy + r * 0.3}" fill="none" stroke="${p.ink}" stroke-width="${size * 0.06}" stroke-linecap="round" stroke-linejoin="round"/>`,
        `<circle cx="${cx}" cy="${cy}" r="${size * 0.045}" fill="${p.accent}"/>`,
      ].join("");
    };
    return [
      art.solid(shape, { lift: 34, rim: 3 }),
      donut(660, 370, 82, 44),
      bar(800, 318, 230, 22, p.ink, 0.85),
      bar(800, 360, 180, 22, p.soft),
      bar(800, 402, 130, 22, p.soft),
      `<rect x="560" y="492" width="150" height="56" rx="28" fill="${p.accent}"/>`,
      glyph(GLYPH.check, { cx: 635, cy: 520, size: 40, color: p.paper, width: 3 }),
      `<rect x="726" y="492" width="150" height="56" rx="28" fill="${p.tint}" stroke="${p.soft}" stroke-width="5"/>`,
      clock(1070, 574, 164),
    ].join("");
  },

  /** An organization of agents: the lead with its crown, three desks under it. */
  "agent-company"(art) {
    const p = art.pal;
    const top = { cx: 800, cy: 250, s: 210 };
    const row = [570, 800, 1030].map((cx) => ({ cx, cy: 616, s: 186 }));
    const lines = `<path d="M800 356V436M570 436H1030M570 436V524M800 436V524M1030 436V524" fill="none" stroke="${p.paper}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.92"/>`;
    const heads = [p.mid, p.ink, p.base];
    return [
      lines,
      tile(art, { cx: top.cx, cy: top.cy, size: top.s, lift: 34 }),
      robotHead(top.cx, top.cy + 10, top.s * 0.56, { body: p.ink, eye: p.paper, crown: p.accent }),
      ...row.map(
        (t, i) =>
          tile(art, { cx: t.cx, cy: t.cy, size: t.s, lift: 28 }) +
          robotHead(t.cx, t.cy, t.s * 0.56, {
            body: heads[i],
            eye: p.paper,
            antenna: p.accent,
          }),
      ),
    ].join("");
  },

  /** An agent being assembled: a base of four blocks, and its head — with a face — lowering on. */
  "agent-development"(art) {
    const p = art.pal;
    const o = [800, 520];
    const u = 120;
    const g = 8;
    const b = u - g;
    const body = { top: p.tint, left: p.soft, right: p.mid };
    const head = { top: p.paper, left: p.tint, right: p.soft };
    const block = (x, y, z, colors) => isoBox(o, { x, y, z, w: b, d: b, h: b, ...colors });
    const hx = u / 2 + g / 2;
    const hz = b + 96;
    // Where the head lands on the base's top: its shadow, and a dashed outline.
    const landing = [
      iso(o, hx, hx, b),
      iso(o, hx + b, hx, b),
      iso(o, hx + b, hx + b, b),
      iso(o, hx, hx + b, b),
    ];
    const faceAt = iso(o, hx, hx + b, hz + b);
    const top = iso(o, hx + b / 2, hx + b / 2, hz + b);
    return [
      art.shadow(isoFootprint(o, { x: 0, y: 0, w: 2 * u - g, d: 2 * u - g, h: b }), 30),
      block(0, 0, 0, body),
      block(u, 0, 0, body),
      block(0, u, 0, body),
      block(u, u, 0, body),
      `<polygon points="${pts(landing)}" fill="${p.shade}" fill-opacity="0.28" filter="${art.blur(12)}"/>`,
      `<polygon points="${pts(landing)}" fill="none" stroke="${p.paper}" stroke-opacity="0.85" stroke-width="5" stroke-dasharray="16 12" stroke-linejoin="round"/>`,
      art.shadow(isoFootprint(o, { x: hx, y: hx, z: hz, w: b, d: b, h: b }), 26, 0.7),
      block(hx, hx, hz, head),
      // The face on the head's lit side.
      `<g transform="matrix(0.866 0.5 0 1 ${faceAt[0]} ${faceAt[1]})">`,
      `<circle cx="${b * 0.3}" cy="${b * 0.42}" r="${b * 0.1}" fill="${p.ink}"/>`,
      `<circle cx="${b * 0.7}" cy="${b * 0.42}" r="${b * 0.1}" fill="${p.ink}"/>`,
      `<path d="M${b * 0.34} ${b * 0.68}Q${b * 0.5} ${b * 0.8} ${b * 0.66} ${b * 0.68}" fill="none" stroke="${p.ink}" stroke-width="${b * 0.065}" stroke-linecap="round"/>`,
      `</g>`,
      // Its antenna, on the top face.
      `<path d="M${top[0]} ${top[1]}V${top[1] - 44}" stroke="${p.ink}" stroke-width="10" stroke-linecap="round"/>`,
      `<circle cx="${top[0]}" cy="${top[1] - 54}" r="16" fill="${p.accent}"/>`,
    ].join("");
  },

  /** A score dial in front of the Benchmark's case sheet. */
  "agent-evaluation"(art) {
    const p = art.pal;
    const cx = 880;
    const cy = 476;
    const R = 232;
    const sheetW = 300;
    const sheetH = 390;
    const sheet = rect(-sheetW / 2, -sheetH / 2, sheetW, sheetH, 30);
    const rows = [0, 1, 2]
      .map((i) => {
        const y = -sheetH / 2 + 110 + i * 82;
        const ok = i !== 1;
        return [
          `<rect x="${-sheetW / 2 + 36}" y="${y - 24}" width="48" height="48" rx="12" fill="${ok ? p.accent : p.soft}"/>`,
          glyph(ok ? GLYPH.check : GLYPH.cross, {
            cx: -sheetW / 2 + 60,
            cy: y,
            size: 34,
            color: p.paper,
            width: 3.2,
          }),
          bar(-sheetW / 2 + 104, y - 11, ok ? 150 : 120, 22, p.soft),
        ].join("");
      })
      .join("");
    const gauge = (a0, a1, color, w) =>
      `<path d="${arc(cx, cy, R * 0.68, a0, a1)}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`;
    const needleA = -32;
    const [nx, ny] = polar(cx, cy, R * 0.6, needleA);
    const [bx0, by0] = polar(cx, cy, 20, needleA + 90);
    const [bx1, by1] = polar(cx, cy, 20, needleA - 90);
    return [
      `<g transform="translate(612 374) rotate(-9)">`,
      art.solid(sheet, { lift: 26 }),
      `<rect x="-62" y="${-sheetH / 2 - 18}" width="124" height="44" rx="14" fill="${p.ink}"/>`,
      rows,
      `</g>`,
      art.solid(`<circle cx="${cx}" cy="${cy}" r="${R}"/>`, { lift: 40, rim: 4 }),
      `<circle cx="${cx}" cy="${cy}" r="${R - 26}" fill="none" stroke="${p.tint}" stroke-width="6"/>`,
      gauge(150, 390, p.tint, 40),
      gauge(150, 328, p.accent, 40),
      ...[150, 180, 210, 240, 270, 300, 330, 360, 390].map((a) => {
        const [x0, y0] = polar(cx, cy, R * 0.68 + 36, a);
        const [x1, y1] = polar(cx, cy, R * 0.68 + 52, a);
        return `<path d="M${x0} ${y0}L${x1} ${y1}" stroke="${p.soft}" stroke-width="6" stroke-linecap="round"/>`;
      }),
      `<path d="M${bx0} ${by0}L${nx} ${ny}L${bx1} ${by1}Z" fill="${p.ink}" stroke="${p.ink}" stroke-width="6" stroke-linejoin="round"/>`,
      `<circle cx="${cx}" cy="${cy}" r="34" fill="${p.ink}"/>`,
      `<circle cx="${cx}" cy="${cy}" r="12" fill="${p.paper}"/>`,
      `<rect x="${cx - 70}" y="${cy + 74}" width="140" height="28" rx="14" fill="${p.soft}"/>`,
    ].join("");
  },

  /** A pointer clicking a page's button: the agent's own hand on the browser. */
  "browser-automation"(art) {
    const p = art.pal;
    const back = rect(640, 150, 470, 300, 26);
    const x = 470;
    const y = 214;
    const w = 600;
    const h = 400;
    const win = rect(x, y, w, h, 30);
    const bar0 = `<path d="M${x + 30} ${y}H${x + w - 30}A30 30 0 0 1 ${x + w} ${y + 30}V${y + 62}H${x}V${y + 30}A30 30 0 0 1 ${x + 30} ${y}Z" fill="${p.tint}"/>`;
    const dots = [0, 1, 2]
      .map(
        (i) =>
          `<circle cx="${x + 38 + i * 30}" cy="${y + 31}" r="9" fill="${[p.soft, p.mid, p.accent][i]}"/>`,
      )
      .join("");
    const cursor = "M0 0L0 17.4L4.6 13.2L7.6 20L10.6 18.7L7.7 12L13.5 12Z";
    const tipX = 742;
    const tipY = 536;
    const s = 11.5;
    return [
      art.solid(back, { fill: art.linear([p.tint, p.soft]), lift: 18, rim: 2, shadow: 0.6 }),
      art.solid(win, { lift: 36 }),
      bar0,
      dots,
      bar(x + 150, y + 18, 300, 26, p.paper),
      `<rect x="${x + 36}" y="${y + 92}" width="${w - 72}" height="128" rx="20" fill="${art.linear([p.soft, p.mid])}"/>`,
      bar(x + 36, y + 246, 360, 22, p.soft),
      bar(x + 36, y + 284, 280, 22, p.tint),
      `<rect x="${x + 36}" y="${y + 322}" width="210" height="54" rx="27" fill="${p.accent}"/>`,
      `<path d="${arc(tipX, tipY, 52, 200, 320)}" fill="none" stroke="${p.paper}" stroke-width="7" stroke-linecap="round" stroke-opacity="0.9"/>`,
      `<path d="${arc(tipX, tipY, 86, 205, 315)}" fill="none" stroke="${p.paper}" stroke-width="7" stroke-linecap="round" stroke-opacity="0.55"/>`,
      art.shadow(`<path transform="translate(${tipX} ${tipY}) scale(${s})" d="${cursor}"/>`, 22),
      `<path transform="translate(${tipX} ${tipY}) scale(${s})" d="${cursor}" fill="${p.deep}" stroke="${p.paper}" stroke-width="1.5" stroke-linejoin="round"/>`,
    ].join("");
  },

  /** An open book, and what was learned rising out of it. */
  "continual-learning"(art) {
    const p = art.pal;
    const sx = 800;
    const top = 470;
    const page = (dir) => {
      const o = 270 * dir;
      return `<path d="M${sx} ${top + 24}C${sx + o * 0.35} ${top - 26} ${sx + o * 0.75} ${top - 26} ${sx + o} ${top - 6}V${top + 214}C${sx + o * 0.75} ${top + 194} ${sx + o * 0.35} ${top + 194} ${sx} ${top + 244}Z"/>`;
    };
    const cover = `<path d="M${sx} ${top + 270}C${sx - 120} ${top + 220} ${sx - 220} ${top + 226} ${sx - 292} ${top + 246}V${top + 14}L${sx - 270} ${top - 6}V${top + 214}C${sx - 190} ${top + 200} ${sx - 90} ${top + 204} ${sx} ${top + 244}C${sx + 90} ${top + 204} ${sx + 190} ${top + 200} ${sx + 270} ${top + 214}V${top - 6}L${sx + 292} ${top + 14}V${top + 246}C${sx + 220} ${top + 226} ${sx + 120} ${top + 220} ${sx} ${top + 270}Z"/>`;
    const lines = (dir) =>
      [0, 1, 2, 3]
        .map((i) => {
          const y = top + 40 + i * 40;
          const x0 = dir < 0 ? sx - 236 : sx + 44;
          const w = [176, 150, 176, 110][i];
          return `<path d="M${x0} ${y + (dir < 0 ? 0 : 0)}h${w}" stroke="${p.soft}" stroke-width="14" stroke-linecap="round"/>`;
        })
        .join("");
    const arrow = `<path d="M${sx} ${top + 30}V${310}M${sx - 92} ${398}L${sx} ${306}L${sx + 92} ${398}"/>`;
    const card = (cx, cy, rot, size, op) =>
      `<g transform="translate(${cx} ${cy}) rotate(${rot})" opacity="${op}">${art.solid(rect(-size / 2, -size * 0.36, size, size * 0.72, size * 0.12), { lift: 14, rim: 2 })}${bar(-size * 0.32, -size * 0.12, size * 0.64, size * 0.1, p.soft)}${bar(-size * 0.32, size * 0.06, size * 0.42, size * 0.1, p.tint)}</g>`;
    return [
      card(598, 300, -14, 124, 0.92),
      card(1012, 262, 11, 108, 0.85),
      card(690, 178, -6, 84, 0.6),
      art.solid(cover, { fill: art.linear([p.ink, p.deep]), lift: 30, rim: 0 }),
      `<g fill="${art.paperFill}">${page(-1)}${page(1)}</g>`,
      `<g fill="${p.shade}" fill-opacity="0.08">${page(1)}</g>`,
      lines(-1),
      lines(1),
      `<path d="M${sx} ${top + 24}V${top + 244}" stroke="${p.soft}" stroke-width="4"/>`,
      `<g fill="none" stroke-linecap="round" stroke-linejoin="round">`,
      `<g transform="translate(5 14)" stroke="${p.shade}" stroke-opacity="0.35" stroke-width="58">${arrow}</g>`,
      `<g stroke="${art.linear([p.paper, p.accent], [0, 0, 0, 1])}" stroke-width="58">${arrow}</g>`,
      `</g>`,
    ].join("");
  },

  /** Bars rising on a plinth, the trend drawn over them. */
  "data-analysis"(art) {
    const p = art.pal;
    const o = [726, 372];
    const W0 = 410;
    const D0 = 240;
    const slab = { x: 0, y: 0, z: 0, w: W0, d: D0, h: 34 };
    const heights = [92, 150, 120, 226];
    const bw = 76;
    const bars = heights.map((h, i) => ({ x: 26 + i * 98, y: 82, z: 34, w: bw, d: bw, h }));
    const tops = bars.map((b) => iso(o, b.x + bw / 2, b.y + bw / 2, b.z + b.h + 84));
    return [
      art.shadow(isoFootprint(o, slab), 34),
      isoBox(o, { ...slab, top: p.paper, left: p.tint, right: p.soft }),
      ...bars.map((b, i) =>
        isoBox(o, {
          ...b,
          ...(i === bars.length - 1
            ? { top: p.light, left: p.accent, right: p.base }
            : { top: p.soft, left: p.mid, right: p.ink }),
        }),
      ),
      `<polyline points="${pts(tops)}" fill="none" stroke="${p.paper}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>`,
      ...tops.map(
        ([x, y]) =>
          `<circle cx="${x}" cy="${y}" r="20" fill="${p.paper}"/><circle cx="${x}" cy="${y}" r="9" fill="${p.ink}"/>`,
      ),
    ].join("");
  },

  /** The trial, reflect and improve loop, round after round, each higher than the last. */
  "default-rsi-toolkit"(art) {
    const p = art.pal;
    const steps = [
      [696, 104],
      [800, 176],
      [904, 256],
    ];
    const foot = 578;
    return [
      loopRibbon(art, { cx: CX, cy: CY - 4, r: 266, width: 50, face: p.paper, side: p.soft }),
      ...steps.map(([x, h], i) =>
        art.solid(rect(x - 44, foot - h, 88, h, 24), {
          fill: i === 2 ? art.linear([p.light, p.accent]) : art.paperFill,
          lift: 20,
          rim: 3,
        }),
      ),
    ].join("");
  },

  /** A target struck dead centre, the session's loop circling it. */
  goal(art) {
    const p = art.pal;
    const cx = 780;
    const cy = 474;
    const rings = [
      [228, p.paper],
      [184, p.accent],
      [140, p.paper],
      [96, p.accent],
      [52, p.paper],
      [20, p.ink],
    ];
    const orbit = (t0, t1, op) =>
      `<path d="${ellipseArc(cx, cy, 340, 118, -14, t0, t1)}" fill="none" stroke="${p.paper}" stroke-width="13" stroke-linecap="round" stroke-dasharray="0.1 34" stroke-opacity="${op}"/>`;
    const ang = -42;
    const u = [Math.cos(deg(ang)), Math.sin(deg(ang))];
    const n = [-u[1], u[0]];
    const tail = polar(cx, cy, 310, ang);
    const shaft = `<path d="M${cx + u[0] * 8} ${cy + u[1] * 8}L${tail[0]} ${tail[1]}" fill="none" stroke-width="18" stroke-linecap="round"/>`;
    const along = (o, s) => [
      round(tail[0] - u[0] * o + n[0] * s),
      round(tail[1] - u[1] * o + n[1] * s),
    ];
    const feather = (side, o) =>
      `<path d="M${pts([along(o + 96, 0), along(o + 6, 0), along(o - 14, 54 * side), along(o + 50, 54 * side)])}Z"/>`;
    return [
      orbit(180, 360, 0.5),
      `<circle cx="${cx + 12}" cy="${cy + 24}" r="${rings[0][0]}" fill="${p.deep}"/>`,
      art.shadow(`<circle cx="${cx}" cy="${cy}" r="${rings[0][0]}"/>`, 40),
      ...rings.map(([r, c]) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}"/>`),
      `<circle cx="${cx}" cy="${cy}" r="${rings[0][0] - 2}" fill="none" stroke="${art.rim}" stroke-width="4"/>`,
      `<g stroke="${p.shade}" stroke-opacity="0.35" transform="translate(8 20)">${shaft}</g>`,
      `<g stroke="${p.deep}">${shaft}</g>`,
      `<g fill="${p.paper}" stroke="${p.paper}" stroke-width="5" stroke-linejoin="round">${feather(1, 0)}${feather(-1, 0)}</g>`,
      `<g fill="${p.soft}" stroke="${p.soft}" stroke-width="5" stroke-linejoin="round">${feather(1, 64)}${feather(-1, 64)}</g>`,
      orbit(0, 180, 0.9),
    ].join("");
  },

  /** A chip on the bench, the model's layers wired on its die. */
  "model-development"(art) {
    const p = art.pal;
    const o = [800, 286];
    const S = 340;
    const chip = { x: 0, y: 0, z: 0, w: S, d: S, h: 56 };
    const pinsX = [0, 1, 2, 3, 4, 5].map((i) => ({
      x: S,
      y: 30 + i * 50,
      z: 14,
      w: 34,
      d: 20,
      h: 18,
    }));
    const pinsY = [0, 1, 2, 3, 4, 5].map((i) => ({
      x: 30 + i * 50,
      y: S,
      z: 14,
      w: 20,
      d: 34,
      h: 18,
    }));
    const die = { x: 46, y: 46, z: 56, w: S - 92, d: S - 92, h: 64 };
    const topAt = iso(o, die.x, die.y, die.z + die.h);
    const dw = die.w;
    const layers = [
      [0.22, [0.3, 0.7]],
      [0.5, [0.18, 0.5, 0.82]],
      [0.78, [0.3, 0.7]],
    ];
    const nodes = layers.flatMap(([u, vs]) => vs.map((v) => [u * dw, v * dw]));
    const edges = [];
    for (let a = 0; a < layers.length - 1; a++) {
      for (const v0 of layers[a][1])
        for (const v1 of layers[a + 1][1])
          edges.push(`M${layers[a][0] * dw} ${v0 * dw}L${layers[a + 1][0] * dw} ${v1 * dw}`);
    }
    const pin = { top: p.light, left: p.soft, right: p.mid };
    return [
      art.shadow(isoFootprint(o, { ...chip, w: S + 34, d: S + 34 }), 34),
      ...pinsX.map((b) => isoBox(o, { ...b, ...pin })),
      ...pinsY.map((b) => isoBox(o, { ...b, ...pin })),
      isoBox(o, { ...chip, top: p.ink, left: p.deep, right: p.shade }),
      `<polygon points="${pts([iso(o, 16, 16, 56), iso(o, S - 16, 16, 56), iso(o, S - 16, S - 16, 56), iso(o, 16, S - 16, 56)])}" fill="none" stroke="${p.mid}" stroke-opacity="0.5" stroke-width="3"/>`,
      isoBox(o, { ...die, top: p.paper, left: p.tint, right: p.soft }),
      `<g transform="matrix(0.866 0.5 -0.866 0.5 ${topAt[0]} ${topAt[1]})">`,
      `<path d="${edges.join("")}" stroke="${p.mid}" stroke-width="12" stroke-linecap="round"/>`,
      ...nodes.map(
        ([x, y], i) =>
          `<circle cx="${round(x)}" cy="${round(y)}" r="${i === 3 ? 32 : 25}" fill="${i === 3 ? p.accent : p.ink}"/>`,
      ),
      `</g>`,
    ].join("");
  },

  /** A question, and the answer the product's own penguin gives, with its source beside it. */
  "penguin-support"(art) {
    const p = art.pal;
    const q = bubble(472, 168, 300, 220, 56, { tail: 0.22, drop: 60 });
    const a = bubble(612, 330, 500, 320, 58, { tail: 0.2, side: "right", drop: 70 });
    return [
      art.solid(q, { fill: art.linear([p.ink, p.deep]), lift: 26, rim: 2 }),
      glyph(GLYPH.question, { cx: 622, cy: 276, size: 150, color: p.paper, width: 3 }),
      art.solid(a, { lift: 36, rim: 3 }),
      art.shadow(rect(652, 372, 112, 112, 112 * TILE_RADIUS), 10, 0.6),
      `<g clip-path="${art.clip(rect(652, 372, 112, 112, 112 * TILE_RADIUS))}">${penguinLogo(652, 372, 112)}</g>`,
      bar(796, 392, 270, 24, p.ink, 0.85),
      bar(796, 436, 230, 24, p.soft),
      bar(652, 512, 414, 24, p.soft),
      `<rect x="652" y="562" width="240" height="52" rx="26" fill="${p.tint}" stroke="${p.soft}" stroke-width="3"/>`,
      `<path d="M680 574h18l10 10v20h-28z" fill="${p.paper}" stroke="${p.ink}" stroke-width="4" stroke-linejoin="round"/>`,
      bar(724, 580, 140, 16, p.mid),
    ].join("");
  },

  /** Skills, plugins and agents from elsewhere, dropping into this agent's own box. */
  "skill-porting"(art) {
    const p = art.pal;
    const o = [800, 476];
    const S = 280;
    const Hb = 150;
    const P = (x, y, z) => iso(o, x, y, z);
    const floor = [P(0, 0, 0), P(S, 0, 0), P(S, S, 0), P(0, S, 0)];
    const wallX = [P(0, 0, Hb), P(0, S, Hb), P(0, S, 0), P(0, 0, 0)];
    const wallY = [P(0, 0, Hb), P(S, 0, Hb), P(S, 0, 0), P(0, 0, 0)];
    const front = [P(0, S, Hb), P(S, S, Hb), P(S, S, 0), P(0, S, 0)];
    const side = [P(S, 0, Hb), P(S, S, Hb), P(S, S, 0), P(S, 0, 0)];
    const rim = [P(0, 0, Hb), P(S, 0, Hb), P(S, S, Hb), P(0, S, Hb)];
    const card = (cx, cy, rot, size, icon, lift) =>
      `<g transform="translate(${cx} ${cy}) rotate(${rot})">${tile(art, { cx: 0, cy: 0, size, icon, lift, glyphScale: 0.56 })}</g>`;
    return [
      art.shadow(isoFootprint(o, { x: 0, y: 0, w: S, d: S, h: Hb }), 32),
      `<polygon points="${pts(floor)}" fill="${p.deep}"/>`,
      `<polygon points="${pts(wallX)}" fill="${p.ink}"/>`,
      `<polygon points="${pts(wallY)}" fill="${p.deep}"/>`,
      card(800, 424, 5, 170, GLYPH.book, 16),
      `<polygon points="${pts(front)}" fill="${art.linear([p.paper, p.tint])}"/>`,
      `<polygon points="${pts(side)}" fill="${art.linear([p.tint, p.soft])}"/>`,
      `<polygon points="${pts(rim)}" fill="none" stroke="${p.paper}" stroke-width="7" stroke-linejoin="round"/>`,
      card(698, 264, -11, 176, GLYPH.puzzle, 26),
      card(900, 188, 9, 146, GLYPH.robot, 30),
    ].join("");
  },

  /** The code mark, cut thick, in front of an editor's lines. */
  "software-development"(art) {
    const p = art.pal;
    const x = 496;
    const y = 214;
    const w = 608;
    const h = 440;
    const ed = rect(x, y, w, h, 32);
    const rows = [
      [0, 180, p.accent],
      [1, 260, p.soft],
      [2, 120, p.mid],
      [3, 300, p.soft],
      [4, 200, p.mid],
      [5, 150, p.accent],
      [6, 240, p.soft],
    ];
    const code =
      '<path d="M8.5 8 5 12l3.5 4"/><path d="M15.5 8 19 12l-3.5 4"/><path d="M13.3 6.2 10.7 17.8"/>';
    const size = 470;
    const cx = 800;
    const cy = 452;
    const layers = [];
    for (let i = 14; i >= 1; i--) {
      layers.push(
        glyph(code, {
          cx: cx + i * 0.9,
          cy: cy + i * 1.5,
          size,
          color: i > 2 ? p.deep : p.ink,
          width: 2.3,
        }),
      );
    }
    return [
      art.solid(ed, { fill: art.linear([p.deep, p.shade]), lift: 30, rim: 2 }),
      [0, 1, 2]
        .map(
          (i) =>
            `<circle cx="${x + 40 + i * 28}" cy="${y + 36}" r="8" fill="${p.mid}" fill-opacity="0.6"/>`,
        )
        .join(""),
      ...rows.map(([i, bw, c], k) =>
        bar(x + 48 + (k % 3 === 1 ? 40 : 0), y + 84 + i * 48, bw, 18, c, 0.35),
      ),
      `<g opacity="0.45" filter="${art.blur(18)}" transform="translate(10 30)">${glyph(code, { cx, cy, size, color: p.shade, width: 2.3 })}</g>`,
      ...layers,
      glyph(code, { cx, cy, size, color: p.paper, width: 2.3 }),
    ].join("");
  },

  /** A long conversation, and the lens that finds the one line it needs. */
  "trace-lookup"(art) {
    const p = art.pal;
    const x = 548;
    const y = 150;
    const w = 400;
    const h = 600;
    const sheet = rect(x, y, w, h, 36);
    const rows = [
      ["l", 230],
      ["r", 170],
      ["l", 280],
      ["r", 140],
      ["l", 250],
      ["r", 200],
      ["l", 190],
    ];
    const rowAt = (i) => y + 64 + i * 72;
    const rowMarks = (scale = 1, only) =>
      rows
        .map(([side, rw], i) => {
          if (only !== undefined && i !== only) return "";
          const ry = rowAt(i);
          const rx = side === "l" ? x + 84 : x + w - 40 - rw;
          const c = i === 3 ? p.accent : side === "l" ? p.soft : p.tint;
          const dot =
            side === "l"
              ? `<circle cx="${x + 52}" cy="${ry + 15}" r="16" fill="${i === 3 ? p.accent : p.mid}"/>`
              : "";
          return `${dot}${bar(rx, ry, rw * scale, 30, c)}`;
        })
        .join("");
    const lx = 900;
    const ly = rowAt(3) + 15;
    const lr = 128;
    const zoom = `<g clip-path="${art.clip(`<circle cx="${lx}" cy="${ly}" r="${lr - 14}"/>`)}"><circle cx="${lx}" cy="${ly}" r="${lr}" fill="${p.paper}"/><g transform="translate(${lx} ${ly}) scale(1.55) translate(${-lx} ${-ly})">${rowMarks(1, 2)}${rowMarks(1, 3)}${rowMarks(1, 4)}</g></g>`;
    const handle = `<g transform="translate(${lx} ${ly}) rotate(45)"><rect x="${lr - 6}" y="-26" width="170" height="52" rx="26"/></g>`;
    return [
      art.solid(sheet, { lift: 32 }),
      rowMarks(),
      art.shadow(`<circle cx="${lx}" cy="${ly}" r="${lr + 14}"/>${handle}`, 36),
      `<g fill="${art.linear([p.ink, p.deep])}">${handle}</g>`,
      zoom,
      `<circle cx="${lx}" cy="${ly}" r="${lr}" fill="none" stroke="${art.linear([p.ink, p.deep])}" stroke-width="30"/>`,
      `<path d="${arc(lx, ly, lr - 36, 200, 250)}" fill="none" stroke="${p.paper}" stroke-width="12" stroke-linecap="round" stroke-opacity="0.85"/>`,
    ].join("");
  },

  /** A deck fanned out, the front slide laid out as a bento grid. */
  "use-bento-slides"(art) {
    const p = art.pal;
    const w = 560;
    const h = 350;
    const slide = rect(-w / 2, -h / 2, w, h, 24);
    const at = (cx, cy, rot, inner) =>
      `<g transform="translate(${cx} ${cy}) rotate(${rot})">${inner}</g>`;
    const x = -w / 2 + 28;
    const y = -h / 2 + 28;
    const bigW = 252;
    const bars = [70, 112, 92, 148]
      .map(
        (bh, i) =>
          `<rect x="${x + 34 + i * 50}" y="${y + 268 - bh}" width="32" height="${bh}" rx="8" fill="${p.paper}" fill-opacity="${i === 3 ? 1 : 0.7}"/>`,
      )
      .join("");
    const front = [
      art.solid(slide, { lift: 36 }),
      bar(x, y, 210, 26, p.ink, 0.85),
      `<rect x="${x}" y="${y + 52}" width="${bigW}" height="${h - 108}" rx="18" fill="${art.linear([p.light, p.accent])}"/>`,
      bars,
      `<rect x="${x + bigW + 16}" y="${y}" width="${w - 56 - bigW - 16}" height="150" rx="18" fill="${p.soft}"/>`,
      `<circle cx="${x + bigW + 16 + 118}" cy="${y + 75}" r="44" fill="none" stroke="${p.paper}" stroke-width="20" stroke-dasharray="190 400" transform="rotate(-90 ${x + bigW + 16 + 118} ${y + 75})"/>`,
      `<rect x="${x + bigW + 16}" y="${y + 166}" width="${w - 56 - bigW - 16}" height="${h - 56 - 166}" rx="18" fill="${p.tint}"/>`,
      bar(x + bigW + 40, y + 196, 150, 18, p.mid),
      bar(x + bigW + 40, y + 228, 110, 18, p.soft),
    ].join("");
    return [
      at(
        814,
        400,
        -9,
        art.solid(slide, { fill: art.linear([p.tint, p.soft]), lift: 16, rim: 2, shadow: 0.5 }),
      ),
      at(
        806,
        420,
        5,
        art.solid(slide, { fill: art.linear([p.paper, p.tint]), lift: 20, rim: 2, shadow: 0.6 }),
      ),
      at(800, 470, 0, front),
    ].join("");
  },

  /** A page going up in a flame: the web, crawled down to what matters. */
  "use-firecrawl"(art) {
    const p = art.pal;
    const flame = (s, dx = 0, dy = 0) =>
      `<path transform="translate(${800 + dx} ${720 + dy}) scale(${s})" d="M0 0C-118 0 -196 -82 -196 -196C-196 -276 -150 -330 -104 -380C-100 -320 -76 -284 -36 -270C-58 -350 -28 -440 34 -500C44 -420 108 -364 156 -306C188 -266 200 -232 200 -190C200 -78 116 0 0 0Z"/>`;
    const hot = (dl, dc, dh) => oklch(p.l + dl, p.c * dc, (p.h + dh + 360) % 360);
    const page = rect(-230, -200, 460, 400, 30);
    const lines = [0, 1, 2, 3, 4]
      .map((i) =>
        bar(-180, -150 + i * 58, [300, 360, 250, 330, 200][i], 24, i === 0 ? p.mid : p.soft),
      )
      .join("");
    const ember = (x, y, s, op) =>
      `<rect x="${x - s / 2}" y="${y - s / 2}" width="${s}" height="${s}" rx="${s * 0.25}" fill="${hot(0.25, 0.9, 30)}" fill-opacity="${op}" transform="rotate(20 ${x} ${y})"/>`;
    return [
      `<g transform="translate(800 430) rotate(-7)">${art.solid(page, { lift: 26 })}${lines}</g>`,
      art.shadow(flame(1), 34),
      `<g fill="${art.linear([hot(0.02, 1.1, 8), hot(-0.08, 1.05, -4)])}">${flame(1)}</g>`,
      `<g fill="${art.linear([hot(0.18, 1.15, 26), hot(0.08, 1.15, 16)])}">${flame(0.68, 0, 0)}</g>`,
      `<g fill="${art.linear([oklch(0.98, 0.04, 90), hot(0.3, 0.8, 40)])}">${flame(0.36, 4, 0)}</g>`,
      ember(944, 236, 34, 0.9),
      ember(1004, 168, 24, 0.7),
      ember(690, 196, 20, 0.6),
    ].join("");
  },

  /** A sheet of prose and the nib that rewrites it by hand. */
  humanizer(art) {
    const p = art.pal;
    const sheet = rect(-220, -270, 440, 540, 30);
    const lines = [0, 1, 2, 3]
      .map((i) => bar(-170, -200 + i * 56, [320, 280, 340, 220][i], 24, p.soft))
      .join("");
    const wave = `<path d="M-170 140C-120 96 -80 184 -30 140S60 96 110 140" fill="none" stroke="${p.ink}" stroke-width="16" stroke-linecap="round"/>`;
    const nib = "M0 0L-46 -120Q-50 -150 -30 -170L-30 -250H30L30 -170Q50 -150 46 -120Z";
    return [
      `<g transform="translate(760 450) rotate(-5)">${art.solid(sheet, { lift: 30 })}${lines}${wave}</g>`,
      `<g transform="translate(902 600) rotate(38)">`,
      art.shadow(`<path d="${nib}"/><rect x="-44" y="-470" width="88" height="230" rx="30"/>`, 30),
      `<rect x="-44" y="-470" width="88" height="230" rx="30" fill="${art.linear([p.ink, p.deep], [0, 0, 1, 0])}"/>`,
      `<rect x="-50" y="-262" width="100" height="26" rx="8" fill="${p.soft}"/>`,
      `<path d="${nib}" fill="${art.linear([p.paper, p.soft], [0, 0, 1, 0])}"/>`,
      `<path d="M0 -6V-112" stroke="${p.ink}" stroke-width="6" stroke-linecap="round"/>`,
      `<circle cx="0" cy="-122" r="12" fill="${p.ink}"/>`,
      `</g>`,
    ].join("");
  },

  /** A terminal on a far host, its prompt live, the link to it in the air. */
  "use-claude-code"(art) {
    const p = art.pal;
    const x = 520;
    const y = 300;
    const w = 520;
    const h = 360;
    const term = rect(x, y, w, h, 30);
    return [
      art.solid(term, { fill: art.linear([p.deep, p.shade]), lift: 34, rim: 2 }),
      [0, 1, 2]
        .map(
          (i) =>
            `<circle cx="${x + 40 + i * 28}" cy="${y + 36}" r="8" fill="${p.mid}" fill-opacity="0.7"/>`,
        )
        .join(""),
      glyph(GLYPH.prompt, { cx: x + 150, cy: y + 200, size: 180, color: p.paper, width: 2.6 }),
      `<rect x="${x + 250}" y="${y + 206}" width="22" height="60" rx="5" fill="${p.accent}"/>`,
      `<path d="${arc(x + w + 4, y + 4, 84, 185, 265)}" fill="none" stroke="${p.paper}" stroke-width="22" stroke-linecap="round"/>`,
      `<path d="${arc(x + w + 4, y + 4, 146, 188, 262)}" fill="none" stroke="${p.paper}" stroke-opacity="0.7" stroke-width="22" stroke-linecap="round"/>`,
      `<circle cx="${x + w + 4}" cy="${y + 4}" r="30" fill="${p.accent}"/>`,
    ].join("");
  },
};
