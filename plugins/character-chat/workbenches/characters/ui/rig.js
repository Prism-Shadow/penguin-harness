// Imported and edited cards use the parametric rig. The original looks also have local art.
import { illustratedPortrait } from "./illustrations.js";

export const MOODS = [
  "neutral",
  "happy",
  "laugh",
  "shy",
  "sad",
  "pout",
  "surprised",
  "thinking",
  "sleepy",
  "wink",
];

const INK = "#232838";
const OUT = `stroke="${INK}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"`;
const THIN = `stroke="${INK}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"`;
const LINE = `fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"`;

const DEFAULTS = {
  penguin: {
    body: "#2f3e5c",
    belly: "#fff7ea",
    accent: "#f4a12a",
    trim: "#e2553d",
    accessory: "none",
    hat: "none",
  },
  robot: { body: "#3c8f8a", face: "#16212b", glow: "#ffe7a3", accent: "#e9b44c", trim: "#27635f" },
  teapot: {
    body: "#9cc9b3",
    belly: "#f6fbf7",
    accent: "#d98e73",
    trim: "#5f9c85",
    accessory: "leaf",
  },
  human: {
    hair: "#5b4a7a",
    skin: "#ffe2d2",
    eyes: "#4f86d6",
    top: "#f2b84b",
    trim: "#e2553d",
    accent: "#ffd166",
    hairstyle: "bob",
    accessory: "none",
  },
  cat: {
    body: "#8d99ae",
    belly: "#f6f2ec",
    accent: "#f29a8c",
    trim: "#e2553d",
    accessory: "none",
    pattern: "plain",
  },
};

/** The kinds of body a card can name, in the order the card editor offers them. */
export const KINDS = ["penguin", "robot", "teapot", "human", "cat"];

/** The parts each kind can wear, in the order the card editor offers them. */
export const PARTS = {
  penguin: { accessory: ["none", "scarf", "bow"], hat: ["none", "cap"] },
  robot: {},
  teapot: { accessory: ["none", "leaf"] },
  human: {
    hairstyle: ["bob", "short", "twintails"],
    accessory: ["none", "sun-clip", "star-clip", "glasses"],
  },
  cat: { accessory: ["none", "collar"], pattern: ["plain", "tabby"] },
};

const COLOUR = /^#[0-9a-fA-F]{6}$/;
const WORD = /^[a-z][a-z0-9-]{0,23}$/;

/**
 * A card's look over the kind's own: a key the kind draws takes a value of its own type (a
 * colour where it has a colour, a word where it has a part); anything else is dropped.
 */
export function lookOf(kind, look) {
  const base = DEFAULTS[kind] ?? DEFAULTS.penguin;
  const out = { ...base };
  for (const [key, value] of Object.entries(look ?? {})) {
    if (typeof value !== "string" || !Object.hasOwn(base, key)) continue;
    if (COLOUR.test(base[key]) ? COLOUR.test(value) : WORD.test(value)) out[key] = value;
  }
  return out;
}

/** `a` moved toward `b` by `t` (0 to 1); both are `#rrggbb`. */
function mix(a, b, t) {
  const channel = (hex, i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const at = (i) =>
    Math.round(channel(a, i) + (channel(b, i) - channel(a, i)) * t)
      .toString(16)
      .padStart(2, "0");
  return `#${at(0)}${at(1)}${at(2)}`;
}
const shade = (hex, t) => mix(hex, INK, t);
const tint = (hex, t) => mix(hex, "#ffffff", t);

// ---- faces drawn in ink (penguin, teapot) ----

function inkEye(mood, cx, cy, side) {
  const dot = (dx = 0, dy = 0) =>
    `<ellipse cx="${cx + dx}" cy="${cy + dy}" rx="9.5" ry="11.5" fill="${INK}"/><circle cx="${cx + dx + 3.5}" cy="${cy + dy - 4.5}" r="3.4" fill="#fff"/>`;
  const smile = `<path d="M${cx - 12} ${cy + 5} Q${cx} ${cy - 11} ${cx + 12} ${cy + 5}" ${LINE}/>`;
  switch (mood) {
    case "laugh":
      return smile;
    case "wink":
      return side < 0 ? smile : dot();
    case "sleepy":
      return `<path d="M${cx - 12} ${cy} Q${cx} ${cy + 10} ${cx + 12} ${cy}" ${LINE}/>`;
    case "pout":
      return `<path d="M${cx - 11} ${cy - 1} L${cx + 11} ${cy - 1} A11 11 0 0 1 ${cx - 11} ${cy - 1} Z" fill="${INK}"/>`;
    case "surprised":
      return `<circle cx="${cx}" cy="${cy}" r="13.5" fill="#fff" ${THIN}/><circle cx="${cx}" cy="${cy}" r="5" fill="${INK}"/>`;
    case "shy":
      return dot(side * -3, 3);
    case "thinking":
      return dot(4, -4);
    default:
      return dot();
  }
}

function inkBrow(mood, cx, cy, side) {
  const y = cy - 24;
  // `side` is -1 for the left eye: the inner end of a brow is toward the middle of the face.
  const inner = cx - side * 11;
  const outer = cx + side * 11;
  if (mood === "sad") return `<path d="M${inner} ${y - 5} L${outer} ${y + 3}" ${LINE}/>`;
  if (mood === "pout") return `<path d="M${inner} ${y + 5} L${outer} ${y - 4}" ${LINE}/>`;
  if (mood === "surprised")
    return `<path d="M${cx - 11} ${y - 6} Q${cx} ${y - 13} ${cx + 11} ${y - 6}" ${LINE}/>`;
  if (mood === "thinking" && side > 0)
    return `<path d="M${cx - 11} ${y - 4} Q${cx} ${y - 12} ${cx + 11} ${y - 6}" ${LINE}/>`;
  return "";
}

const shutEye = (cx, cy) =>
  `<path d="M${cx - 11} ${cy + 1} Q${cx} ${cy + 7} ${cx + 11} ${cy + 1}" ${LINE}/>`;

function inkMouth(mood, mx, my) {
  switch (mood) {
    case "happy":
    case "wink":
      return `<path d="M${mx - 17} ${my - 3} Q${mx} ${my + 15} ${mx + 17} ${my - 3}" ${LINE}/>`;
    case "laugh":
      return `<path d="M${mx - 18} ${my - 5} Q${mx} ${my + 26} ${mx + 18} ${my - 5} Z" fill="#b8433b" ${THIN}/><path d="M${mx - 8} ${my + 9} Q${mx} ${my + 3} ${mx + 8} ${my + 9} Q${mx} ${my + 15} ${mx - 8} ${my + 9} Z" fill="#f29a8c"/>`;
    case "shy":
      return `<path d="M${mx - 10} ${my + 1} Q${mx - 5} ${my + 6} ${mx} ${my + 1} Q${mx + 5} ${my - 4} ${mx + 10} ${my + 1}" ${LINE}/>`;
    case "sad":
      return `<path d="M${mx - 13} ${my + 8} Q${mx} ${my - 6} ${mx + 13} ${my + 8}" ${LINE}/>`;
    case "pout":
      return `<path d="M${mx - 9} ${my + 3} Q${mx} ${my - 2} ${mx + 9} ${my + 3}" ${LINE}/>`;
    case "surprised":
      return `<ellipse cx="${mx}" cy="${my + 4}" rx="7" ry="9" fill="#b8433b" ${THIN}/>`;
    case "thinking":
      return `<path d="M${mx - 4} ${my + 3} L${mx + 12} ${my + 1}" ${LINE}/>`;
    case "sleepy":
      return `<ellipse cx="${mx}" cy="${my + 3}" rx="5" ry="4" fill="#b8433b" ${THIN}/>`;
    default:
      return `<path d="M${mx - 11} ${my} Q${mx} ${my + 8} ${mx + 11} ${my}" ${LINE}/>`;
  }
}

const talkMouth = (mx, my) =>
  `<ellipse cx="${mx}" cy="${my + 4}" rx="10" ry="8" fill="#b8433b" ${THIN}/>`;

function cheeks(mood, lx, rx, y) {
  const strong = mood === "shy" || mood === "laugh";
  const opacity = strong ? 0.75 : mood === "happy" || mood === "wink" ? 0.5 : 0.28;
  let out = `<ellipse cx="${lx}" cy="${y}" rx="17" ry="10" fill="#f58f8f" opacity="${opacity}"/><ellipse cx="${rx}" cy="${y}" rx="17" ry="10" fill="#f58f8f" opacity="${opacity}"/>`;
  if (mood === "shy") {
    for (const x of [lx, rx])
      out += `<path d="M${x - 9} ${y + 4} l5 -9 M${x - 1} ${y + 4} l5 -9 M${x + 7} ${y + 4} l5 -9" fill="none" stroke="#d9606a" stroke-width="2.6" stroke-linecap="round"/>`;
  }
  return out;
}

const tear = (x, y) =>
  `<path d="M${x} ${y} C${x - 8} ${y + 12} ${x - 7} ${y + 22} ${x} ${y + 22} C${x + 7} ${y + 22} ${x + 8} ${y + 12} ${x} ${y} Z" fill="#8fd0f2" ${THIN}/>`;

/** The marks that float beside the head. */
function emote(mood, x, y) {
  const star = (cx, cy, r) =>
    `<path d="M${cx} ${cy - r} Q${cx + r * 0.18} ${cy - r * 0.18} ${cx + r} ${cy} Q${cx + r * 0.18} ${cy + r * 0.18} ${cx} ${cy + r} Q${cx - r * 0.18} ${cy + r * 0.18} ${cx - r} ${cy} Q${cx - r * 0.18} ${cy - r * 0.18} ${cx} ${cy - r} Z" fill="#ffd166" ${THIN}/>`;
  switch (mood) {
    case "happy":
      return star(x, y, 13) + star(x + 24, y + 26, 8);
    case "laugh":
      return star(x - 4, y - 4, 17) + star(x + 26, y + 26, 10) + star(x - 22, y + 30, 7);
    case "wink":
      return star(x, y + 6, 12);
    case "surprised":
      return `<path d="M${x - 5} ${y - 22} h10 l-2.5 30 h-5 Z" fill="#ff7a59" ${THIN}/><circle cx="${x}" cy="${y + 20}" r="5.5" fill="#ff7a59" ${THIN}/>`;
    case "thinking":
      return `<path d="M${x - 30} ${y - 16} h60 a14 14 0 0 1 14 14 v6 a14 14 0 0 1 -14 14 h-36 l-14 12 v-12 h-10 a14 14 0 0 1 -14 -14 v-6 a14 14 0 0 1 14 -14 Z" fill="#fff" ${THIN}/><circle cx="${x - 16}" cy="${y + 1}" r="4" fill="${INK}"/><circle cx="${x}" cy="${y + 1}" r="4" fill="${INK}"/><circle cx="${x + 16}" cy="${y + 1}" r="4" fill="${INK}"/>`;
    case "sleepy":
      return `<path d="M${x - 16} ${y + 6} h14 l-14 16 h14" fill="none" stroke="#7d8fb8" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M${x + 6} ${y - 22} h20 l-20 22 h20" fill="none" stroke="#7d8fb8" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    case "pout":
      return `<path d="M${x - 12} ${y - 4} q8 0 8 -8 M${x + 12} ${y - 4} q-8 0 -8 -8 M${x - 12} ${y + 4} q8 0 8 8 M${x + 12} ${y + 4} q-8 0 -8 8" fill="none" stroke="#e2553d" stroke-width="5" stroke-linecap="round"/>`;
    case "shy":
      return `<path d="M${x} ${y - 8} C${x - 9} ${y + 6} ${x - 8} ${y + 16} ${x} ${y + 16} C${x + 8} ${y + 16} ${x + 9} ${y + 6} ${x} ${y - 8} Z" fill="#bfe6fb" ${THIN}/>`;
    default:
      return "";
  }
}

function inkFace(mood, f) {
  const open = inkEye(mood, f.lx, f.ey, -1) + inkEye(mood, f.rx, f.ey, 1);
  const closed = shutEye(f.lx, f.ey) + shutEye(f.rx, f.ey);
  // Eyes already drawn closed do not blink.
  const blinks = !["laugh", "sleepy"].includes(mood);
  return (
    cheeks(mood, f.lx - 28, f.rx + 28, f.ey + 34) +
    inkBrow(mood, f.lx, f.ey, -1) +
    inkBrow(mood, f.rx, f.ey, 1) +
    (blinks ? `<g class="rig-open">${open}</g><g class="rig-shut">${closed}</g>` : open) +
    (mood === "sad" ? tear(f.lx - 4, f.ey + 16) : "")
  );
}

// ---- the three kinds ----

function penguin(L, mood) {
  const f = { lx: 158, rx: 242, ey: 198 };
  const beakRest = ["laugh", "surprised"].includes(mood)
    ? `<path d="M182 226 Q200 214 218 226 Q200 233 182 226 Z" fill="${L.accent}" ${THIN}/><path d="M185 235 Q200 258 215 235 Q200 241 185 235 Z" fill="${L.accent}" ${THIN}/>`
    : mood === "sad" || mood === "pout"
      ? `<path d="M183 232 Q200 220 217 232 Q200 246 183 232 Z" fill="${L.accent}" ${THIN}/>`
      : `<path d="M182 228 Q200 214 218 228 Q200 248 182 228 Z" fill="${L.accent}" ${THIN}/>`;
  const beakTalk = `<path d="M182 226 Q200 214 218 226 Q200 233 182 226 Z" fill="${L.accent}" ${THIN}/><path d="M186 236 Q200 254 214 236 Q200 241 186 236 Z" fill="${L.accent}" ${THIN}/>`;
  const scarf =
    L.accessory === "scarf"
      ? `<path d="M258 296 l30 62 l-32 -6 l-16 -52 Z" fill="${L.trim}" ${OUT}/><path d="M72 258 C122 296 278 296 328 258 L334 288 C282 328 118 328 66 288 Z" fill="${L.trim}" ${OUT}/><path d="M112 290 q6 12 2 22 M150 302 q4 12 0 22 M196 306 q2 12 -2 22" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".55"/>`
      : L.accessory === "bow"
        ? `<path d="M200 276 l-34 -16 v32 Z M200 276 l34 -16 v32 Z" fill="${L.trim}" ${OUT}/><circle cx="200" cy="276" r="9" fill="${L.trim}" ${OUT}/>`
        : "";
  const hat =
    L.hat === "cap"
      ? `<path d="M128 104 C140 52 260 52 272 104 Z" fill="${L.trim}" ${OUT}/><path d="M122 100 h156 a6 6 0 0 1 0 14 h-156 a6 6 0 0 1 0 -14 Z" fill="${INK}"/><path d="M214 110 C250 108 282 116 292 132 C262 128 236 126 214 124 Z" fill="${INK}"/><circle cx="200" cy="84" r="10" fill="${L.accent}" ${THIN}/>`
      : `<path d="M200 66 q-6 -22 -20 -24 M202 66 q0 -26 6 -32 M204 66 q10 -18 22 -18" fill="none" stroke="${L.body}" stroke-width="7" stroke-linecap="round"/>`;
  return `
    <g class="rig-arm-l"><path d="M78 232 C38 260 28 322 50 358 C76 340 90 300 94 258 Z" fill="${L.body}" ${OUT}/></g>
    <g class="rig-arm-r"><path d="M322 232 C362 260 372 322 350 358 C324 340 310 300 306 258 Z" fill="${L.body}" ${OUT}/></g>
    <ellipse cx="158" cy="423" rx="38" ry="13" fill="${L.accent}" ${OUT}/>
    <ellipse cx="242" cy="423" rx="38" ry="13" fill="${L.accent}" ${OUT}/>
    <path d="M200 66 C292 66 334 150 336 250 C338 350 292 422 200 422 C108 422 62 350 64 250 C66 150 108 66 200 66 Z" fill="${L.body}" ${OUT}/>
    <path d="M200 140 C230 108 292 124 294 190 C296 232 272 252 266 292 C258 352 240 398 200 398 C160 398 142 352 134 292 C128 252 104 232 106 190 C108 124 170 108 200 140 Z" fill="${L.belly}"/>
    ${hat}
    ${inkFace(mood, f)}
    <g class="rig-mouth-rest">${beakRest}</g><g class="rig-mouth-talk">${beakTalk}</g>
    ${scarf}
    <g class="rig-emote">${emote(mood, 326, 96)}</g>`;
}

function teapot(L, mood) {
  const f = { lx: 158, rx: 242, ey: 250 };
  const leaf =
    L.accessory === "leaf"
      ? `<path d="M210 90 C224 62 254 60 264 66 C260 92 236 104 212 98 Z" fill="#7fb069" ${THIN}/><path d="M216 94 Q238 82 258 70" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>`
      : "";
  return `
    <g class="rig-steam"><path d="M180 62 C164 44 198 34 182 12" fill="none" stroke="#ffffff" stroke-width="8" stroke-linecap="round" opacity=".85"/><path d="M150 74 C140 62 160 54 150 40" fill="none" stroke="#ffffff" stroke-width="6" stroke-linecap="round" opacity=".6"/></g>
    <path d="M330 206 C398 194 402 320 332 324" fill="none" stroke="${INK}" stroke-width="34" stroke-linecap="round"/>
    <path d="M330 206 C398 194 402 320 332 324" fill="none" stroke="${L.trim}" stroke-width="24" stroke-linecap="round"/>
    <path d="M84 244 C44 238 16 200 28 160 C32 148 52 150 56 162 C62 192 80 208 104 210 Z" fill="${L.body}" ${OUT}/>
    <path d="M200 120 C300 120 352 190 352 268 C352 352 290 412 200 412 C110 412 48 352 48 268 C48 190 100 120 200 120 Z" fill="${L.body}" ${OUT}/>
    <path d="M86 366 C128 402 272 402 314 366 C296 398 252 410 200 410 C148 410 104 398 86 366 Z" fill="${L.trim}" opacity=".6"/>
    <ellipse cx="200" cy="266" rx="106" ry="84" fill="${L.belly}" opacity=".92"/>
    <path d="M122 124 C122 102 278 102 278 124 C278 142 122 142 122 124 Z" fill="${L.trim}" ${OUT}/>
    <circle cx="200" cy="98" r="15" fill="${L.accent}" ${OUT}/>
    ${leaf}
    ${inkFace(mood, f)}
    <g class="rig-mouth-rest">${inkMouth(mood, 200, 292)}</g><g class="rig-mouth-talk">${talkMouth(200, 292)}</g>
    <g class="rig-emote">${emote(mood, 330, 108)}</g>`;
}

function ledEye(mood, cx, cy, side, glow) {
  const led = `fill="none" stroke="${glow}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"`;
  const block = (w, h, dy = 0) =>
    `<rect x="${cx - w / 2}" y="${cy - h / 2 + dy}" width="${w}" height="${h}" rx="${Math.min(w, h) / 2}" fill="${glow}"/>`;
  const arc = `<path d="M${cx - 13} ${cy + 6} Q${cx} ${cy - 12} ${cx + 13} ${cy + 6}" ${led}/>`;
  switch (mood) {
    case "happy":
      return arc;
    case "laugh":
      return `<path d="M${cx - side * 10} ${cy - 10} L${cx + side * 8} ${cy} L${cx - side * 10} ${cy + 10}" ${led}/>`;
    case "wink":
      return side < 0 ? arc : block(17, 24);
    case "shy":
      return block(15, 15, 5);
    case "sad":
      return (
        `<path d="M${cx - side * 12} ${cy - 6} L${cx + side * 12} ${cy + 4}" ${led}/>` +
        block(15, 8, 10)
      );
    case "pout":
      return block(24, 7);
    case "surprised":
      return `<circle cx="${cx}" cy="${cy}" r="12" ${led}/>`;
    case "thinking":
      return side < 0 ? block(22, 7) : block(17, 24, -3);
    case "sleepy":
      return block(22, 5, 4);
    default:
      return block(17, 24);
  }
}

function ledMouth(mood, mx, my, glow) {
  const led = `fill="none" stroke="${glow}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"`;
  switch (mood) {
    case "happy":
    case "wink":
      return `<path d="M${mx - 18} ${my - 3} Q${mx} ${my + 13} ${mx + 18} ${my - 3}" ${led}/>`;
    case "laugh":
      return `<path d="M${mx - 18} ${my - 4} Q${mx} ${my + 20} ${mx + 18} ${my - 4} Z" fill="${glow}"/>`;
    case "sad":
      return `<path d="M${mx - 14} ${my + 6} Q${mx} ${my - 6} ${mx + 14} ${my + 6}" ${led}/>`;
    case "pout":
      return `<path d="M${mx - 16} ${my + 2} l8 -6 l8 6 l8 -6 l8 6" ${led}/>`;
    case "surprised":
      return `<circle cx="${mx}" cy="${my + 3}" r="6.5" ${led}/>`;
    case "thinking":
      return `<path d="M${mx - 2} ${my + 2} h14" ${led}/>`;
    case "sleepy":
      return `<path d="M${mx - 6} ${my + 2} h12" ${led}/>`;
    case "shy":
      return `<path d="M${mx - 9} ${my + 1} q4.5 5 9 0 q4.500 -5 9 0" ${led}/>`;
    default:
      return `<path d="M${mx - 14} ${my + 1} h28" ${led}/>`;
  }
}

const BULB = {
  happy: "#ffd166",
  laugh: "#ffd166",
  wink: "#ffd166",
  shy: "#ff9fb2",
  sad: "#7fb6f2",
  pout: "#ff7a59",
  surprised: "#ffffff",
  sleepy: "#8c97ab",
};

function robot(L, mood) {
  const glow = L.glow;
  const eyes = ledEye(mood, 164, 172, -1, glow) + ledEye(mood, 236, 172, 1, glow);
  const shut = `<rect x="153" y="174" width="22" height="5" rx="2.5" fill="${glow}"/><rect x="225" y="174" width="22" height="5" rx="2.5" fill="${glow}"/>`;
  const blinks = !["laugh", "sleepy", "pout"].includes(mood);
  const bars = [10, 20, 14, 24, 12]
    .map(
      (h, i) =>
        `<rect x="${178 + i * 10}" y="${214 - h / 2}" width="5" height="${h}" rx="2.5" fill="${glow}"/>`,
    )
    .join("");
  const blush =
    mood === "shy" || mood === "laugh"
      ? `<ellipse cx="136" cy="204" rx="11" ry="6" fill="#ff9fb2" opacity=".8"/><ellipse cx="264" cy="204" rx="11" ry="6" fill="#ff9fb2" opacity=".8"/>`
      : "";
  const drop =
    mood === "sad" ? `<rect x="158" y="196" width="7" height="12" rx="3.5" fill="#7fb6f2"/>` : "";
  return `
    <g class="rig-arm-l"><rect x="66" y="300" width="34" height="96" rx="17" fill="${L.trim}" ${OUT}/></g>
    <g class="rig-arm-r"><rect x="300" y="300" width="34" height="96" rx="17" fill="${L.trim}" ${OUT}/></g>
    <rect x="104" y="288" width="192" height="146" rx="38" fill="${L.body}" ${OUT}/>
    <circle cx="200" cy="358" r="42" fill="#fbf4e2" ${OUT}/>
    <path d="M200 322 v8 M200 386 v8 M164 358 h8 M228 358 h8" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>
    <path d="M200 358 V334 M200 358 L218 368" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
    <circle cx="200" cy="358" r="5" fill="${L.accent}" ${THIN}/>
    <rect x="182" y="264" width="36" height="28" fill="${L.trim}" ${OUT}/>
    <path d="M200 92 V58" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>
    <circle class="rig-bulb" cx="200" cy="48" r="12" fill="${BULB[mood] ?? glow}" ${OUT}/>
    <rect x="72" y="150" width="24" height="52" rx="10" fill="${L.accent}" ${OUT}/>
    <rect x="304" y="150" width="24" height="52" rx="10" fill="${L.accent}" ${OUT}/>
    <rect x="90" y="92" width="220" height="178" rx="46" fill="${L.body}" ${OUT}/>
    <rect x="114" y="116" width="172" height="130" rx="30" fill="${L.face}" ${THIN}/>
    ${blush}
    ${blinks ? `<g class="rig-open">${eyes}</g><g class="rig-shut">${shut}</g>` : eyes}
    ${drop}
    <g class="rig-mouth-rest">${ledMouth(mood, 200, 212, glow)}</g><g class="rig-mouth-talk">${bars}</g>
    <g class="rig-emote">${emote(mood, 336, 84)}</g>`;
}

// ---- a person, drawn in the anime way: big glossy eyes, a small mouth, hair in locks ----

const FINE = `fill="none" stroke="${INK}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"`;
const MOUTH_RED = "#c9504f";
const TONGUE = "#f29a8c";

/**
 * One eye, open, drawn for the right side (outer corner toward +x) around the origin; the left
 * eye is its mirror. `look` moves the iris (dx, dy); `wide` is the surprised eye.
 */
function openEye(iris, { dx = 0, dy = 0, wide = false } = {}) {
  const deep = shade(iris, 0.45);
  const rx = wide ? 9.5 : 14.5;
  const ry = wide ? 12 : 19;
  const cy = 5 + dy;
  return (
    `<ellipse cx="0" cy="2" rx="${wide ? 18.5 : 17}" ry="${wide ? 24 : 22}" fill="#fff"/>` +
    `<ellipse cx="${dx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${iris}"/>` +
    `<path d="M${dx - rx} ${cy} A${rx} ${ry} 0 0 1 ${dx + rx} ${cy} Q${dx} ${cy - ry * 0.4} ${dx - rx} ${cy} Z" fill="${deep}" opacity=".6"/>` +
    `<ellipse cx="${dx}" cy="${cy + 1}" rx="${rx * 0.45}" ry="${ry * 0.5}" fill="${shade(iris, 0.72)}"/>` +
    `<path d="M${dx - rx * 0.62} ${cy + ry * 0.62} Q${dx} ${cy + ry * 0.95} ${dx + rx * 0.62} ${cy + ry * 0.62}" fill="none" stroke="${tint(iris, 0.5)}" stroke-width="3" stroke-linecap="round"/>` +
    // The upper lash, with a flick at the outer corner; the lower one is a short line.
    `<path d="M-21 ${wide ? -7 : -4} C-16 ${wide ? -28 : -24} 14 ${wide ? -31 : -28} 22 ${wide ? -15 : -12} L28 ${wide ? -20 : -17} L23 ${wide ? -8 : -5} C14 ${wide ? -22 : -18} -12 ${wide ? -22 : -18} -17 ${wide ? -2 : 1} Z" fill="${INK}"/>` +
    `<path d="M-5 ${wide ? 27 : 25} Q4 ${wide ? 29 : 27} 12 ${wide ? 24 : 22}" ${FINE} stroke-width="2.6"/>`
  );
}

/** The eye's two catch-lights, the same side on both eyes: the light comes from one place. */
const catchLights = (cx, cy, { dx = 0, dy = 0, wide = false } = {}) =>
  `<circle cx="${cx + dx - (wide ? 3 : 5)}" cy="${cy + dy - (wide ? 2 : 4)}" r="${wide ? 3.6 : 5.6}" fill="#fff"/>` +
  `<circle cx="${cx + dx + (wide ? 3 : 6)}" cy="${cy + dy + (wide ? 8 : 11)}" r="${wide ? 1.8 : 2.6}" fill="#fff"/>`;

/**
 * A lid with the iris showing under it: a sideways look of annoyance (`dx` moves the iris), or
 * with `drowsy` a heavy lid that droops at both corners.
 */
function halfEye(iris, dx = 0, drowsy = false) {
  const top = drowsy ? 8 : 3;
  const lid = drowsy
    ? `<path d="M-21 9 Q0 3 21 9" fill="none" stroke="${INK}" stroke-width="5.5" stroke-linecap="round"/>`
    : `<path d="M-22 5 Q0 -3 23 1 L27 -3" fill="none" stroke="${INK}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  return (
    `<path d="M-18 ${top + 1} Q0 ${top - 2} 18 ${top} L17 ${top + 7} Q0 ${top + 22} -17 ${top + 8} Z" fill="#fff"/>` +
    `<path d="M${dx - 12} ${top} L${dx + 12} ${top} Q${dx + 11} ${top + 16} ${dx} ${top + 17} Q${dx - 11} ${top + 16} ${dx - 12} ${top} Z" fill="${iris}"/>` +
    `<path d="M${dx - 5} ${top} L${dx + 5} ${top} Q${dx + 5} ${top + 9} ${dx} ${top + 9} Q${dx - 5} ${top + 9} ${dx - 5} ${top} Z" fill="${shade(iris, 0.72)}"/>` +
    lid +
    `<path d="M-5 25 Q4 27 12 22" ${FINE} stroke-width="2.6"/>`
  );
}

const arcEye = `<path d="M-19 5 Q0 -18 19 5" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>`;
const shutLid = `<path d="M-20 1 Q0 13 20 1" fill="none" stroke="${INK}" stroke-width="5.5" stroke-linecap="round"/><path d="M20 1 L26 -4" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`;

/** Places an eye drawn around the origin: mirrored for the left (`side` -1). */
const placeEye = (cx, cy, side, markup) =>
  `<g transform="translate(${cx} ${cy}) scale(${side} 1)">${markup}</g>`;

function animeEyes(mood, f, iris) {
  const look = { shy: { dx: -4, dy: 4 }, thinking: { dx: 5, dy: -4 }, sad: { dy: 2 } }[mood] ?? {};
  const both = (markup) =>
    placeEye(f.lx, f.ey, -1, markup(-1)) + placeEye(f.rx, f.ey, 1, markup(1));
  // The iris offset is the face's, not the eye's: undo the mirror on the left.
  const open = (opts) =>
    both((side) => openEye(iris, { ...opts, dx: (opts.dx ?? 0) * side })) +
    catchLights(f.lx, f.ey, opts) +
    catchLights(f.rx, f.ey, opts);
  switch (mood) {
    case "laugh":
      return { open: both(() => arcEye), blinks: false };
    case "wink":
      return {
        open:
          placeEye(f.lx, f.ey, -1, arcEye) +
          placeEye(f.rx, f.ey, 1, openEye(iris)) +
          catchLights(f.rx, f.ey),
        shut: placeEye(f.lx, f.ey, -1, arcEye) + placeEye(f.rx, f.ey, 1, shutLid),
        blinks: true,
      };
    case "sleepy":
      return { open: both(() => halfEye(iris, 0, true)), blinks: false };
    case "pout":
      return { open: both((side) => halfEye(iris, -5 * side)), blinks: false };
    case "surprised":
      return { open: open({ wide: true }), blinks: true };
    default:
      return { open: open(look), blinks: true };
  }
}

function animeBrow(mood, cx, y, side, colour) {
  const inner = cx - side * 12;
  const outer = cx + side * 12;
  const line = `fill="none" stroke="${colour}" stroke-width="4.5" stroke-linecap="round"`;
  switch (mood) {
    case "sad":
      return `<path d="M${inner} ${y - 6} Q${cx} ${y - 3} ${outer} ${y + 3}" ${line}/>`;
    case "pout":
      return `<path d="M${inner} ${y + 5} Q${cx} ${y - 1} ${outer} ${y - 4}" ${line}/>`;
    case "surprised":
      return `<path d="M${cx - 12} ${y - 6} Q${cx} ${y - 14} ${cx + 12} ${y - 7}" ${line}/>`;
    case "thinking":
      return side > 0
        ? `<path d="M${cx - 12} ${y - 5} Q${cx} ${y - 13} ${cx + 12} ${y - 7}" ${line}/>`
        : `<path d="M${inner} ${y + 1} Q${cx} ${y - 2} ${outer} ${y + 1}" ${line}/>`;
    default:
      return `<path d="M${inner} ${y + 1} Q${cx} ${y - 4} ${outer} ${y}" ${line}/>`;
  }
}

function animeMouth(mood, mx, my) {
  const open = (w, d) =>
    `<path d="M${mx - w} ${my - 3} Q${mx} ${my + d} ${mx + w} ${my - 3} Z" fill="${MOUTH_RED}" ${THIN} stroke-width="3"/>` +
    `<path d="M${mx - w * 0.5} ${my + d * 0.42} Q${mx} ${my + d * 0.2} ${mx + w * 0.5} ${my + d * 0.42} Q${mx} ${my + d * 0.62} ${mx - w * 0.5} ${my + d * 0.42} Z" fill="${TONGUE}"/>`;
  switch (mood) {
    case "happy":
    case "wink":
      return open(12, 17);
    case "laugh":
      return open(16, 25);
    case "shy":
      return `<path d="M${mx - 9} ${my + 1} Q${mx - 4.5} ${my + 5} ${mx} ${my + 1} Q${mx + 4.5} ${my - 3} ${mx + 9} ${my + 1}" ${FINE}/>`;
    case "sad":
      return `<path d="M${mx - 8} ${my + 4} Q${mx} ${my - 3} ${mx + 8} ${my + 4}" ${FINE}/>`;
    case "pout":
      return `<path d="M${mx - 6} ${my + 3} Q${mx} ${my - 3} ${mx + 6} ${my + 3}" ${FINE}/>`;
    case "surprised":
      return `<ellipse cx="${mx}" cy="${my + 4}" rx="6" ry="7.5" fill="${MOUTH_RED}" ${THIN} stroke-width="3"/>`;
    case "thinking":
      return `<path d="M${mx - 3} ${my + 2} L${mx + 9} ${my}" ${FINE}/>`;
    case "sleepy":
      return `<ellipse cx="${mx}" cy="${my + 3}" rx="4.5" ry="3.6" fill="${MOUTH_RED}" ${THIN} stroke-width="2.6"/>`;
    default:
      return `<path d="M${mx - 7} ${my} Q${mx} ${my + 5} ${mx + 7} ${my}" ${FINE}/>`;
  }
}

const animeTalk = (mx, my) =>
  `<ellipse cx="${mx}" cy="${my + 4}" rx="8" ry="7" fill="${MOUTH_RED}" ${THIN} stroke-width="3"/><path d="M${mx - 4.5} ${my + 7} Q${mx} ${my + 4} ${mx + 4.5} ${my + 7} Q${mx} ${my + 10.5} ${mx - 4.5} ${my + 7} Z" fill="${TONGUE}"/>`;

/** A small sun of `colour` at (x, y): the clip a person can wear in the hair. */
function sunClip(x, y, colour) {
  let rays = "";
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const x1 = (x + Math.cos(a) * 14).toFixed(1);
    const y1 = (y + Math.sin(a) * 14).toFixed(1);
    const x2 = (x + Math.cos(a) * 20).toFixed(1);
    const y2 = (y + Math.sin(a) * 20).toFixed(1);
    rays += `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${INK}" stroke-width="8" stroke-linecap="round"/><path d="M${x1} ${y1} L${x2} ${y2}" stroke="${colour}" stroke-width="3.6" stroke-linecap="round"/>`;
  }
  return `${rays}<circle cx="${x}" cy="${y}" r="11" fill="${colour}" ${THIN}/><circle cx="${x - 3.5}" cy="${y - 3.5}" r="3" fill="#fff" opacity=".7"/>`;
}

const starShape = (cx, cy, r, colour) => {
  let d = "";
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.48;
    d += `${i === 0 ? "M" : "L"}${(cx + Math.cos(a) * rr).toFixed(1)} ${(cy + Math.sin(a) * rr).toFixed(1)} `;
  }
  return `<path d="${d}Z" fill="${colour}" ${THIN}/>`;
};

function human(L, mood) {
  const hair = L.hair;
  const style = ["bob", "short", "twintails"].includes(L.hairstyle) ? L.hairstyle : "bob";
  const f = { lx: 156, rx: 244, ey: 240 };
  // Where the locks that frame the face end.
  const tip = { bob: 296, short: 254, twintails: 274 }[style];
  const back = {
    bob: `<path d="M68 300 C50 226 52 126 116 78 C156 50 244 50 284 78 C348 126 350 226 332 300 C324 322 296 326 284 304 L116 304 C104 326 76 322 68 300 Z" fill="${hair}" ${OUT}/><path d="M98 300 C86 240 90 172 112 142 L288 142 C310 172 314 240 302 300 Z" fill="${shade(hair, 0.2)}"/>`,
    short: `<path d="M80 254 C62 168 104 74 200 68 C296 74 338 168 320 254 C314 272 292 274 284 254 L116 254 C108 274 86 272 80 254 Z" fill="${hair}" ${OUT}/><path d="M102 252 C92 210 96 168 114 146 L286 146 C304 168 308 210 298 252 Z" fill="${shade(hair, 0.2)}"/>`,
    twintails: `<path d="M78 272 C60 180 104 74 200 68 C296 74 340 180 322 272 C316 290 292 292 286 272 L114 272 C108 292 84 290 78 272 Z" fill="${hair}" ${OUT}/><path d="M100 270 C90 222 94 172 114 146 L286 146 C306 172 310 222 300 270 Z" fill="${shade(hair, 0.2)}"/>`,
  }[style];
  const tails =
    style === "twintails"
      ? `<g class="rig-tails"><path d="M94 132 C44 140 22 216 30 298 C36 350 58 386 92 392 C76 352 72 300 82 252 C90 214 102 182 118 160 Z" fill="${hair}" ${OUT}/><path d="M306 132 C356 140 378 216 370 298 C364 350 342 386 308 392 C324 352 328 300 318 252 C310 214 298 182 282 160 Z" fill="${hair}" ${OUT}/></g>`
      : "";
  const top = L.top;
  const front = `M100 ${tip} C86 ${tip - 36} 80 232 84 196 C88 112 136 66 200 64 C264 66 312 112 316 196 C320 232 314 ${tip - 36} 300 ${tip} C292 ${tip - 32} 290 234 288 206 Q278 178 262 158 Q262 186 246 210 Q240 178 226 152 Q224 188 206 216 Q200 180 186 152 Q184 184 166 208 Q160 180 146 158 Q146 188 128 210 Q120 188 112 176 C110 218 108 ${tip - 32} 100 ${tip} Z`;
  const strands = `<path d="M226 152 Q232 120 214 96 M186 152 Q184 122 194 98 M262 158 Q272 132 258 108 M146 158 Q138 132 150 110" fill="none" stroke="${shade(hair, 0.32)}" stroke-width="2.6" stroke-linecap="round" opacity=".75"/>`;
  const shine = `<path d="M128 116 Q154 98 182 96 M218 96 Q248 98 272 116" fill="none" stroke="${tint(hair, 0.4)}" stroke-width="7" stroke-linecap="round"/><path d="M196 92 L204 92" stroke="${tint(hair, 0.4)}" stroke-width="7" stroke-linecap="round"/>`;
  const ahoge = `<path d="M204 66 C204 42 228 26 248 34 C234 36 220 46 214 66 Z" fill="${hair}" ${THIN}/>`;
  const ties =
    style === "twintails"
      ? `<circle cx="100" cy="146" r="10" fill="${L.accent}" ${THIN}/><circle cx="300" cy="146" r="10" fill="${L.accent}" ${THIN}/>`
      : "";
  const wear =
    L.accessory === "sun-clip"
      ? sunClip(268, 150, L.accent)
      : L.accessory === "star-clip"
        ? starShape(268, 150, 17, L.accent)
        : "";
  const glasses =
    L.accessory === "glasses"
      ? `<g fill="#ffffff" fill-opacity=".18" stroke="${INK}" stroke-width="4"><circle cx="${f.lx}" cy="${f.ey + 2}" r="28"/><circle cx="${f.rx}" cy="${f.ey + 2}" r="28"/></g><path d="M${f.lx + 28} ${f.ey - 2} Q200 ${f.ey - 10} ${f.rx - 28} ${f.ey - 2}" fill="none" stroke="${INK}" stroke-width="4"/>`
      : "";
  const eyes = animeEyes(mood, f, L.eyes);
  const shut = placeEye(f.lx, f.ey, -1, shutLid) + placeEye(f.rx, f.ey, 1, shutLid);
  const browColour = shade(hair, 0.45);
  return `
    ${tails}
    ${back}
    <path d="M170 396 h22 v22 h-22 Z M208 396 h22 v22 h-22 Z" fill="${L.skin}" ${THIN}/>
    <path d="M154 429 C154 414 166 409 181 409 C194 409 198 418 198 429 Z" fill="${L.trim}" ${OUT}/>
    <path d="M246 429 C246 414 234 409 219 409 C206 409 202 418 202 429 Z" fill="${L.trim}" ${OUT}/>
    <path d="M146 322 C120 336 112 372 116 404 C150 413 250 413 284 404 C288 372 280 336 254 322 C236 314 164 314 146 322 Z" fill="${top}" ${OUT}/>
    <path d="M118 395 C152 403 248 403 282 395" fill="none" stroke="${shade(top, 0.3)}" stroke-width="3" stroke-linecap="round"/>
    <path d="M162 366 C172 361 228 361 238 366 L246 392 C220 397 180 397 154 392 Z" fill="${shade(top, 0.07)}" stroke="${shade(top, 0.38)}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M188 386 a6 6 0 0 1 2 -11.5 a8 8 0 0 1 15 -3 a6.5 6.5 0 0 1 7 14.5 Z" fill="#ffffff" ${THIN} stroke-width="2.6"/>
    <path d="M186 326 C186 340 184 350 182 360 M214 326 C214 340 216 350 218 360" fill="none" stroke="${L.trim}" stroke-width="4" stroke-linecap="round"/>
    <circle cx="182" cy="362" r="4.5" fill="${L.trim}"/><circle cx="218" cy="362" r="4.5" fill="${L.trim}"/>
    <g class="rig-arm-l"><path d="M150 324 C126 332 112 358 110 390 C112 400 130 402 138 394 C140 372 148 352 162 338 Z" fill="${top}" ${OUT}/><circle cx="122" cy="400" r="11" fill="${L.skin}" ${OUT}/></g>
    <g class="rig-arm-r"><path d="M250 324 C274 332 288 358 290 390 C288 400 270 402 262 394 C260 372 252 352 238 338 Z" fill="${top}" ${OUT}/><circle cx="278" cy="400" r="11" fill="${L.skin}" ${OUT}/></g>
    <path d="M186 296 L186 322 Q200 330 214 322 L214 296 Z" fill="${shade(L.skin, 0.14)}"/>
    <path d="M140 328 C150 308 176 306 186 320 Q200 326 214 320 C224 306 250 308 260 328 C240 342 160 342 140 328 Z" fill="${shade(top, 0.12)}" ${THIN} stroke-width="3.5"/>
    <path d="M98 200 C98 268 142 314 200 316 C258 314 302 268 302 200 C302 136 260 104 200 104 C140 104 98 136 98 200 Z" fill="${L.skin}" ${OUT}/>
    ${cheeks(mood, 134, 266, 272)}
    ${eyes.blinks ? `<g class="rig-open">${eyes.open}</g><g class="rig-shut">${eyes.shut ?? shut}</g>` : eyes.open}
    ${mood === "sad" ? tear(f.lx - 8, f.ey + 22) : ""}
    <path d="M201 268 l-2.5 5" fill="none" stroke="${shade(L.skin, 0.4)}" stroke-width="3" stroke-linecap="round"/>
    <g class="rig-mouth-rest">${animeMouth(mood, 200, 290)}</g><g class="rig-mouth-talk">${animeTalk(200, 290)}</g>
    <path d="${front}" fill="${hair}" ${OUT}/>
    ${strands}
    ${shine}
    ${ahoge}
    ${ties}
    ${animeBrow(mood, f.lx, 204, -1, browColour)}${animeBrow(mood, f.rx, 204, 1, browColour)}
    ${glasses}
    ${wear}
    <g class="rig-emote">${emote(mood, 334, 92)}</g>`;
}

// ---- a cat ----

function catMouth(mood, mx, my) {
  // At rest a cat's mouth is the little "w" under its nose.
  const w = `<path d="M${mx - 13} ${my} Q${mx - 6.5} ${my + 8} ${mx} ${my} Q${mx + 6.5} ${my + 8} ${mx + 13} ${my}" ${LINE} stroke-width="4"/>`;
  if (mood === "neutral" || mood === "thinking" || mood === "shy") return w;
  return inkMouth(mood, mx, my + 4);
}

function cat(L, mood) {
  const f = { lx: 150, rx: 250, ey: 210 };
  const stripe = shade(L.body, 0.28);
  const tabby =
    L.pattern === "tabby"
      ? `<path d="M186 104 l4 22 M200 100 v26 M214 104 l-4 22 M100 340 q20 -4 30 6 M300 340 q-20 -4 -30 6 M106 372 q18 -2 26 8 M294 372 q-18 -2 -26 8" fill="none" stroke="${stripe}" stroke-width="7" stroke-linecap="round"/>`
      : "";
  const collar =
    L.accessory === "collar"
      ? `<path d="M124 300 Q200 332 276 300 L280 318 Q200 352 120 318 Z" fill="${L.trim}" ${OUT}/><circle cx="200" cy="340" r="13" fill="#ffd166" ${OUT}/><path d="M192 344 h16 M200 344 v6" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`
      : "";
  return `
    <g class="rig-tail"><path d="M282 396 C344 400 372 334 344 288 C334 272 312 280 320 298 C342 334 326 370 280 374 Z" fill="${L.body}" ${OUT}/></g>
    <path d="M200 252 C280 252 312 330 306 380 C302 420 262 428 200 428 C138 428 98 420 94 380 C88 330 120 252 200 252 Z" fill="${L.body}" ${OUT}/>
    <ellipse cx="200" cy="370" rx="62" ry="52" fill="${L.belly}"/>
    <ellipse cx="166" cy="420" rx="28" ry="14" fill="${L.belly}" ${OUT}/>
    <ellipse cx="234" cy="420" rx="28" ry="14" fill="${L.belly}" ${OUT}/>
    <path d="M86 156 L94 54 L170 102 Z" fill="${L.body}" ${OUT}/>
    <path d="M314 156 L306 54 L230 102 Z" fill="${L.body}" ${OUT}/>
    <path d="M102 136 L106 80 L148 106 Z M298 136 L294 80 L252 106 Z" fill="${L.accent}" opacity=".75"/>
    <path d="M68 210 C68 128 128 90 200 90 C272 90 332 128 332 210 C332 282 272 312 200 312 C128 312 68 282 68 210 Z" fill="${L.body}" ${OUT}/>
    ${tabby}
    <ellipse cx="200" cy="262" rx="48" ry="32" fill="${L.belly}"/>
    ${inkFace(mood, f)}
    <path d="M190 242 Q200 236 210 242 Q206 252 200 254 Q194 252 190 242 Z" fill="${L.accent}" ${THIN}/>
    <g class="rig-mouth-rest">${catMouth(mood, 200, 258)}</g><g class="rig-mouth-talk">${talkMouth(200, 262)}</g>
    <path d="M124 252 L72 244 M124 262 L70 266 M276 252 L328 244 M276 262 L330 266" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round" opacity=".7"/>
    ${collar}
    <g class="rig-emote">${emote(mood, 336, 88)}</g>`;
}

const DRAW = { penguin, robot, teapot, human, cat };
const FACE_BOX = {
  penguin: "66 62 268 268",
  robot: "62 34 276 276",
  teapot: "44 84 312 312",
  human: "48 28 304 304",
  cat: "52 40 296 296",
};

/**
 * The portrait as SVG markup. `face: true` crops to the head, for a roster row.
 * The label is set by the caller as an attribute, never as markup.
 */
export function portrait(meta, mood, { face = false, art } = {}) {
  const kind = Object.hasOwn(DRAW, meta?.kind) ? meta.kind : "penguin";
  const L = lookOf(kind, meta?.look);
  const m = MOODS.includes(mood) ? mood : "neutral";
  const illustrated = illustratedPortrait(art, m, face);
  if (illustrated) return illustrated;
  const box = face ? FACE_BOX[kind] : "0 0 400 440";
  const shadow = face
    ? ""
    : `<ellipse cx="200" cy="428" rx="130" ry="10" fill="#000" opacity=".12"/>`;
  return `<svg class="rig" viewBox="${box}" data-kind="${kind}" data-mood="${m}" aria-hidden="true" focusable="false">${shadow}<g class="rig-figure">${DRAW[kind](L, m)}</g></svg>`;
}
