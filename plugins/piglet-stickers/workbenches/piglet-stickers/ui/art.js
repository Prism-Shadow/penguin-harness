/* Piggy Sticker World: the illustration engine.
 *
 * Every sticker, costume and scene is built from these SVG helpers when the page loads; nothing
 * is fetched. A classic script with no DOM access: its top-level bindings (C, K, the shape
 * helpers, FACE, HAT, OUTFIT, PROP, pig) are shared with stickers.js, scenes.js and game.js, and
 * a test can run it on its own. */
const INK = "#BE8F86";
const C = {
  ink: INK,
  cream: "#FFF9F0",
  paper: "#FFFDF8",
  pink: "#F5B8C5",
  pinkD: "#EDA3B4",
  pinkL: "#FBE3E8",
  blush: "#F7AFBD",
  yellow: "#F6E5AC",
  yellowD: "#EBD284",
  yellowL: "#FBEFC8",
  mint: "#C4DDCB",
  mintD: "#9FC8B0",
  sky: "#C7DFF0",
  skyD: "#9EC6E0",
  peach: "#F3C6A8",
  peachD: "#E7AC86",
  brown: "#B08977",
  brownD: "#8C6A5C",
  white: "#FFFFFF",
  red: "#E98C9D",
  purple: "#CFC1E8",
  violet: "#B9A7D9",
  gray: "#DCD2CB",
  grayD: "#C3B5AC",
  green: "#A9C79A",
  greenD: "#86AE78",
};
const K = 'stroke="#BE8F86" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"';
const K1 = 'stroke="#BE8F86" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"';
const K2 = 'stroke="#BE8F86" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"';
const K3 = 'stroke="#BE8F86" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round"';

const at = (...a) => a.filter(Boolean).join(" ");
const c = (cx, cy, r, f, ...a) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${f}"${at(...a) ? " " + at(...a) : ""}/>`;
const e = (cx, cy, rx, ry, f, ...a) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${f}"${at(...a) ? " " + at(...a) : ""}/>`;
const rc = (x, y, w, h, r, f, ...a) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${f}"${at(...a) ? " " + at(...a) : ""}/>`;
const p = (d, f, a) => `<path d="${d}" fill="${f}"${a ? " " + a : ""}/>`;
const l = (d, a) => `<path d="${d}" ${/fill=/.test(a || "") ? "" : 'fill="none" '}${a || K1}/>`;
const gp = (x, y, s, inner, rot) =>
  `<g transform="translate(${x},${y})${rot ? " rotate(" + rot + ")" : ""} scale(${s})">${inner}</g>`;
const mirror = (inner) => `<g transform="translate(100,0) scale(-1,1)">${inner}</g>`;

function starPath(cx, cy, r, ir) {
  ir = ir || r * 0.45;
  let d = "";
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5,
      rr = i % 2 ? ir : r;
    d +=
      (i ? "L" : "M") +
      (cx + rr * Math.cos(a)).toFixed(1) +
      " " +
      (cy + rr * Math.sin(a)).toFixed(1);
  }
  return d + "Z";
}
const star = (cx, cy, r, f, a, ir) => p(starPath(cx, cy, r, ir), f, a);
const heartPath = "M0 7C-10 0-11-8-5.5-9.5-2-10.5 0-7.5 0-5 0-7.5 2-10.5 5.5-9.5 11-8 10 0 0 7Z";
const heart = (x, y, s, f, a) =>
  `<path transform="translate(${x},${y}) scale(${s})" d="${heartPath}" fill="${f}"${a ? " " + a : ""}/>`;

/* A five-petal flower */
function flower(cx, cy, r, petal, center, stroke) {
  let s = "";
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
    s += c(
      cx + Math.cos(a) * r * 0.78,
      cy + Math.sin(a) * r * 0.78,
      r * 0.52,
      petal,
      stroke ? K1 : "",
    );
  }
  return s + c(cx, cy, r * 0.42, center || C.yellow, stroke ? K1 : "");
}
/* A cloud */
function cloud(cx, cy, s, f, a) {
  return (
    `<g transform="translate(${cx},${cy}) scale(${s})">` +
    p("M-22 8c-8 0-9-11-1-13-1-9 11-13 16-6 3-8 16-7 17 2 9-2 13 9 5 12z", f, a || K1) +
    "</g>"
  );
}
/* A leaf */
function leafShape(cx, cy, s, rot, f) {
  return `<g transform="translate(${cx},${cy}) rotate(${rot}) scale(${s})"><path d="M0 0C10-8 22-6 26 0 22 6 10 8 0 0Z" fill="${f || C.green}" ${K1}/><path d="M2 0H24" stroke="#7d9a70" stroke-width="1.2" fill="none"/></g>`;
}

/* ================= The piglet =================
 * An original emoji-style piglet drawn for this game: a wide bean-shaped head, two small upright
 * ears on the top corners whose tips fold forward, a pill-shaped snout low in the face with two
 * capsule nostrils, glossy oval eyes set wide apart, solid blush dots, a tiny mouth and one curl
 * of hair on the crown. In the 100 x 100 sticker box the head spans x 16-84 and y 11.5-63, the
 * ears reach up to y 5, and the body sits below at y 57-89. */
const EYE = "#6B4A43";
const EX1 = 35,
  EX2 = 65,
  EY = 36.5;
const eyeLine = (d, w) =>
  l(d, `stroke="${EYE}" stroke-width="${w || 2.9}" stroke-linecap="round" stroke-linejoin="round"`);
/** A glossy emoji eye: a tall oval with one white glint. */
const glossy = (x, y, rx, ry) =>
  e(x, y, rx, ry, EYE) + c(x + rx * 0.38, y - ry * 0.4, Math.max(0.9, rx * 0.4), "#FFFFFF");
const STAR_LINE = 'stroke="#D97B84" stroke-width="1.6" stroke-linejoin="round"';
const FACE = {
  none: () => "",
  open: () => glossy(EX1, EY, 3.6, 4.8) + glossy(EX2, EY, 3.6, 4.8),
  happy: () => eyeLine("M30.6 38.6q4.4-6 8.8 0") + eyeLine("M60.6 38.6q4.4-6 8.8 0"),
  sleepy: () =>
    [EX1, EX2]
      .map(
        (x) =>
          p(`M${x - 3.8} 36.4a3.8 3.6 0 0 0 7.6 0Z`, EYE) + eyeLine(`M${x - 4.4} 36.4h8.8`, 2.4),
      )
      .join(""),
  closed: () => eyeLine("M30.8 36q4.2 4 8.4 0", 2.7) + eyeLine("M60.8 36q4.2 4 8.4 0", 2.7),
  wink: () => glossy(EX1, EY, 3.6, 4.8) + eyeLine("M68.6 33.4l-7.2 3.1 7.2 3.1", 2.7),
  star: () =>
    star(EX1, EY + 0.3, 5.6, "#F8C86A", STAR_LINE) +
    star(EX2, EY + 0.3, 5.6, "#F8C86A", STAR_LINE) +
    c(EX1 + 1.4, EY - 1.4, 0.9, "#FFFFFF") +
    c(EX2 + 1.4, EY - 1.4, 0.9, "#FFFFFF"),
  shades: () =>
    rc(25.4, 31, 19.2, 11, 5.5, "#6E6470", 'stroke="#D97B84" stroke-width="1.9"') +
    rc(55.4, 31, 19.2, 11, 5.5, "#6E6470", 'stroke="#D97B84" stroke-width="1.9"') +
    l("M44.6 34.4h10.8", 'stroke="#6E6470" stroke-width="2.4" stroke-linecap="round"') +
    l(
      "M25.6 34.2l-5.6-2.6M74.4 34.2l5.6-2.6",
      'stroke="#6E6470" stroke-width="2" stroke-linecap="round"',
    ) +
    p("M29 33.6h4.4l-2.2 3.2Z", "#FFF", 'opacity=".55"') +
    p("M59 33.6h4.4l-2.2 3.2Z", "#FFF", 'opacity=".55"'),
  dot: () =>
    [EX1, EX2].map((x) => c(x, EY + 0.6, 3, EYE) + c(x + 1.1, EY - 0.6, 0.9, "#FFFFFF")).join(""),
  heart: () =>
    heart(EX1, EY + 2, 0.8, "#EE93A8", 'stroke="#D97B84" stroke-width="1.3"') +
    heart(EX2, EY + 2, 0.8, "#EE93A8", 'stroke="#D97B84" stroke-width="1.3"'),
  cool: () =>
    glossy(EX1, EY, 3.6, 4.8) +
    glossy(EX2, EY, 3.6, 4.8) +
    eyeLine("M29.6 29.2l7.6 1.6", 2.2) +
    eyeLine("M70.4 29.2l-7.6 1.6", 2.2),
};

/* Costumes. A hat is drawn over the head, scaled a little from the head's top (see pig()); the
   ones named in HATS_IN_FACE_SPACE frame the face itself and are drawn in its own coordinates. */
/** The rain hood's band: along the head's outline, from one cheek over the crown to the other. */
const HOOD_ARC = "M16 55C12.5 30 28 11.5 50 11.5S87.5 30 84 55";
const HAT = {
  none: () => "",
  strawberry: () =>
    p("M50 2C38 2 30 12 30 19c0 7 9 10 20 10s20-3 20-10c0-7-8-17-20-17Z", "#EE93A3", K) +
    p("M50 2c-6 0-11 4-13 8 5-3 9-5 13-5s8 2 13 5c-2-4-7-8-13-8Z", C.greenD, K1) +
    [
      [40, 14],
      [50, 12],
      [60, 14],
      [45, 22],
      [56, 22],
      [50, 25],
    ]
      .map(([x, y]) => e(x, y, 1.4, 2, "#FFF3D8"))
      .join("") +
    p("M50 1q4-7 10-5-2 5-10 5Z", C.green, K1),
  cream: () =>
    p("M36 20c-2-8 5-11 7-6 1-8 10-9 11-3 4-5 11 0 8 7-6 4-19 4-26 2Z", C.white, K) +
    c(47, 8, 3.4, C.white, K1) +
    l("M42 16h12", 'stroke="#E8DCD0" stroke-width="1.6"'),
  bread: () =>
    p("M28 22c-4-12 8-18 22-18s26 6 22 18c-2 5-10 7-22 7s-20-2-22-7Z", "#F0C98A", K) +
    l(
      "M38 10l-3 6M50 8l-3 7M62 10l-3 6",
      'stroke="#D9A765" stroke-width="2" stroke-linecap="round"',
    ),
  mushroom: () =>
    p("M22 22C22 8 34 1 50 1s28 7 28 21c0 4-12 6-28 6S22 26 22 22Z", "#F09A9A", K) +
    c(36, 12, 4.2, "#FFF0EA", 'opacity=".9"') +
    c(56, 8, 3, "#FFF0EA", 'opacity=".9"') +
    c(64, 16, 4.6, "#FFF0EA", 'opacity=".9"') +
    e(50, 24, 13, 4, "#F7DCC6", K),
  santa: () =>
    p("M28 24q0-24 22-23 18 1 22 20-22-10-44 3Z", "#EE9AA5", K) +
    p("M66 1q10 3 7 12-5 4-9-2 5-4 2-10Z", "#EE9AA5", K) +
    c(75, 14, 4.4, C.white, K1) +
    rc(26, 20, 48, 8, 4, C.white, K) +
    c(50, 1, 3.6, C.white, K1),
  bunny: () =>
    e(36, 10, 6.5, 15, C.pinkL, K, 'transform="rotate(-12 36 10)"') +
    e(64, 10, 6.5, 15, C.pinkL, K, 'transform="rotate(12 64 10)"') +
    e(36, 10, 3, 9, C.blush, "", 'transform="rotate(-12 36 10)"') +
    e(64, 10, 3, 9, C.blush, "", 'transform="rotate(12 64 10)"'),
  chef: () =>
    p(
      "M30 22c-9 0-11-13-2-14-2-9 11-11 13-4 2-9 17-8 17 1 9-2 12 11 3 13-8 3-24 3-31 4Z",
      C.white,
      K,
    ) +
    rc(32, 20, 36, 7, 3, C.paper, K1) +
    l("M42 22v5M50 22v5M58 22v5", 'stroke="#E4D8CC" stroke-width="1.6"'),
  sunhat: () =>
    e(50, 26, 34, 8.5, C.yellowD, K) +
    p("M34 24c0-14 6-20 16-20s16 6 16 20Z", C.yellow, K) +
    rc(34, 20, 32, 6, 3, C.pink, K1) +
    flower(64, 22, 4, C.white, C.pink, 1),
  /* face space: a ring floating just above the crown, between the ears */
  halo: () =>
    e(50, 5.2, 15, 3.4, "none", 'stroke="#F6D880" stroke-width="3.6"') +
    e(50, 5.2, 15, 3.4, "none", 'stroke="#FFF6DE" stroke-width="1.4"'),
  /* face space: two small horns on the crown, inside the ears */
  horns: () =>
    p("M38.4 15.2c-4.4-3.4-5.6-9-3-11.6 3.4 1.2 6.8 5 7.8 10.2Z", "#B39AA2", K) +
    p("M61.6 15.2c4.4-3.4 5.6-9 3-11.6-3.4 1.2-6.8 5-7.8 10.2Z", "#B39AA2", K),
  flowercrown: () =>
    [0, 1, 2, 3, 4]
      .map((i) =>
        flower(
          26 + i * 12,
          15 - Math.sin((i / 4) * Math.PI) * 7,
          6.2,
          [C.pink, C.white, C.yellow][i % 3],
          C.yellow,
          0,
        ),
      )
      .join("") + l("M24 17q26-14 52 0", 'stroke="#9CC4AE" stroke-width="2"'),
  /* face space: round black ears on the head's corners and eye patches around the eyes (the
     panda pig draws no eyes of its own) */
  pandaHood: () =>
    c(24, 15, 9, "#6E6468", K) +
    c(76, 15, 9, "#6E6468", K) +
    c(24, 15, 4, "#8E8286") +
    c(76, 15, 4, "#8E8286") +
    e(35, 36.8, 7.4, 8, "#6E6468", 'transform="rotate(16 35 36.8)"') +
    e(65, 36.8, 7.4, 8, "#6E6468", 'transform="rotate(-16 65 36.8)"') +
    c(35.4, 37, 3.4, "#FFF") +
    c(64.6, 37, 3.4, "#FFF") +
    c(36, 37.6, 2.1, "#3F3A3D") +
    c(64, 37.6, 2.1, "#3F3A3D") +
    c(35.2, 36.2, 0.85, "#FFF") +
    c(63.2, 36.2, 0.85, "#FFF"),
  /* face space: a glass dome around the whole head and a collar under the chin */
  helmet: () =>
    c(50, 37, 36, "rgba(200,225,245,.42)", K) +
    p(
      "M26 21.5q8-12 21-14.5",
      "none",
      'stroke="#fff" stroke-width="3.2" stroke-linecap="round" opacity=".9"',
    ) +
    c(76, 24, 2.4, "rgba(255,255,255,.8)") +
    rc(32, 62, 36, 7, 3.5, C.sky, K1),
  cake: () =>
    rc(30, 12, 40, 16, 6, "#FBE7D6", K) +
    p("M28 20q10-6 22-3t22 3v6q-22 5-44 0Z", "#FFF6EC", K1) +
    p("M30 14q8-8 20-6t20 6v5q-20 4-40 0Z", "#F6C9B3", K1) +
    c(40, 9, 3, C.red, K1) +
    c(52, 7, 3, C.red, K1) +
    c(63, 10, 3, C.red, K1),
  headphones: () =>
    l(
      "M24 36c0-18 12-26 26-26s26 8 26 26",
      'stroke="#B39AA2" stroke-width="4.5" stroke-linecap="round"',
    ) +
    rc(15, 28, 12, 16, 5, C.pink, K) +
    rc(73, 28, 12, 16, 5, C.pink, K),
  starpin: () =>
    star(34, 12, 8, C.yellow, K1) +
    star(62, 8, 5, "#F8C86A", K1) +
    l("M34 16q6-6 14-3", 'stroke="#E3C36A" stroke-width="1.6"'),
  crown: () =>
    p("M30 19.5l2.6-13 8.4 6.4 9-10.4 9 10.4 8.4-6.4 2.6 13q-20 6.4-40 0Z", C.yellow, K) +
    c(35.6, 8.4, 2.2, C.red, K1) +
    c(50, 3.4, 2.6, C.pink, K1) +
    c(64.4, 8.4, 2.2, C.red, K1) +
    l("M32 20q18 5 36 0", 'stroke="#E3C36A" stroke-width="1.8"'),
  rainbow: () =>
    [
      ["#F7A9B8", 25],
      ["#F6DFA0", 21.5],
      ["#BFDCC8", 18],
    ]
      .map(
        ([col, r]) =>
          `<path d="M${50 - r} 24a${r} ${r * 0.78} 0 0 1 ${r * 2} 0" fill="none" stroke="${col}" stroke-width="4.6" stroke-linecap="round"/>`,
      )
      .join("") +
    cloud(23, 24, 0.46, C.white, K1) +
    cloud(77, 24, 0.46, C.white, K1),
  tulip: () =>
    p("M40 18q-3-14 6-14 2 6 4 6t4-6q9 0 6 14-6 5-10 5t-10-5Z", "#F0A7B8", K) +
    p("M50 24v-6", "none", 'stroke="#7D9A70" stroke-width="2.4"') +
    p("M43 20q-8-2-8-8 7 0 8 8Z", C.green, K1) +
    p("M57 20q8-2 8-8-7 0-8 8Z", C.green, K1),
  cap: () =>
    p("M28 20q2-18 22-18t22 18q-22-6-44 0Z", C.mint, K) +
    p("M72 20q14 2 16 8-10 4-18-2Z", C.mintD, K),
  bonnet: () =>
    p("M28 22q0-20 22-20t22 20q-22 8-44 0Z", C.pinkL, K) +
    l("M30 18q20 8 40 0", 'stroke="#EDB9C6" stroke-width="1.8"') +
    flower(30, 20, 4, C.white, C.yellow, 1),
  bearhood: () =>
    c(32, 11, 8.6, "#E2BE9E", K) +
    c(68, 11, 8.6, "#E2BE9E", K) +
    c(32, 11, 3.8, "#F6DCC4") +
    c(68, 11, 3.8, "#F6DCC4") +
    p(
      "M50 6c-17.6 0-32.4 7-32.4 17.4 0 2.8 1 5 2.8 6.6 3-6.4 15.4-10 29.6-10s26.6 3.6 29.6 10c1.8-1.6 2.8-3.8 2.8-6.6C82.4 13 67.6 6 50 6Z",
      "#E2BE9E",
      K,
    ) +
    e(50, 24, 24, 4.4, "#F6DCC4", 'opacity=".8"'),
  bow: () =>
    p("M50 12C42 4 28 4 28 12s14 8 22 0Z", C.pink, K) +
    p("M50 12c8-8 22-8 22 0s-14 8-22 0Z", C.pink, K) +
    c(50, 12, 4.4, C.pinkD, K1),
  cloud: () => cloud(50, 12, 0.9, C.white, K1),
  leaf: () =>
    p("M50 20q-4-16 4-19 6 4 3 19Z", C.green, K1) +
    p("M52 20q2-10 6-14", "none", 'stroke="#7D9A70" stroke-width="1.4"'),
  /* face space: a rain hood that frames the face, a stitched seam and two toggles */
  hood: () =>
    l(HOOD_ARC, 'stroke="#BE8F86" stroke-width="12.4" stroke-linecap="round"') +
    l(HOOD_ARC, 'stroke="#F6E5AC" stroke-width="8.6" stroke-linecap="round"') +
    l(
      HOOD_ARC,
      'stroke="#E4C469" stroke-width="1.4" stroke-dasharray="3 4" stroke-linecap="round"',
    ) +
    c(16.4, 58.6, 2.6, C.peachD, K1) +
    c(83.6, 58.6, 2.6, C.peachD, K1),
  sunhat2: () =>
    e(50, 24, 30, 7, "#F7E3B0", K) + p("M36 22c0-12 6-17 14-17s14 5 14 17Z", "#FFF2D0", K),
  goblet: () => "",
};

const OUTFIT = {
  none: () => "",
  suit: () =>
    rc(32, 64, 36, 24, 12, "#5F5C6A", K) +
    p("M42 64l8 8 8-8 6 4-14 10-14-10Z", C.white, K1) +
    p("M50 70l4 4-4 14-4-14Z", C.pink, K1) +
    c(50, 80, 1.6, C.pinkD),
  pajamas: () =>
    e(50, 74, 22, 20, "#DDEAF7", K) +
    l("M32 68h36M31 76h38M34 84h32", 'stroke="#B9CFE4" stroke-width="2.6" stroke-linecap="round"'),
  raincoat: () =>
    e(50, 74, 22, 20, C.yellow, K) +
    l("M50 60v30", 'stroke="#E4C469" stroke-width="2"') +
    c(50, 68, 2, C.peachD) +
    c(50, 78, 2, C.peachD) +
    c(50, 88, 2, C.peachD),
  apron: () =>
    rc(38, 62, 24, 26, 8, C.paper, K) +
    l("M44 62v-6M56 62v-6", 'stroke="#E0D2C6" stroke-width="2"') +
    heart(50, 74, 0.8, C.pink),
  dress: () =>
    p("M32 62h36l10 24q-28 10-56 0Z", C.pink, K) +
    l("M38 70h24M36 78h28", 'stroke="#FBD3DC" stroke-width="2"') +
    l("M40 62q10 6 20 0", 'stroke="#E7A3B4" stroke-width="2"'),
  sports: () =>
    e(50, 74, 22, 20, C.white, K) +
    rc(30, 76, 40, 8, 4, "#9EC6E0", K1) +
    l("M38 60v18M62 60v18", 'stroke="#9EC6E0" stroke-width="2"'),
  overalls: () =>
    e(50, 76, 21, 18, "#A8C6DE", K) +
    l("M42 60v-8M58 60v-8", 'stroke="#87AAC7" stroke-width="2.4"') +
    rc(42, 60, 16, 10, 3, "#87AAC7", K1),
  fur: () =>
    p(
      "M29 62q1-8 7-8 3-6 9-5 3-5 9-3 6-2 9 3 6-1 9 5 6 0 7 8l2 12q1 8-6 9-3 6-9 5-3 5-9 4-6 1-9-4-6 1-9-5-7-1-6-9Z",
      "#F3E6D6",
      K,
    ) + l("M50 52v34", 'stroke="#E4D2BE" stroke-width="1.6" opacity=".7"'),
  towel: () =>
    e(50, 74, 22, 21, C.white, K) +
    rc(28, 72, 44, 6, 3, "#DFE9F0", K1) +
    l("M50 60v12", 'stroke="#E4DACC" stroke-width="1.6"'),
  bib: () => rc(40, 62, 20, 16, 8, C.white, K) + heart(50, 70, 0.85, C.pink),
  vest: () =>
    e(50, 74, 22, 20, "#A08E9A", K) +
    l("M50 60v26", 'stroke="#4E4952" stroke-width="2"') +
    l("M34 66l8 2M66 66l-8 2M34 76l8 2M66 76l-8 2", 'stroke="#8E8891" stroke-width="2.4"'),
  coat: () =>
    e(50, 74, 23, 21, "#E7DCCF", K) +
    l("M50 58v32", 'stroke="#CDBDAE" stroke-width="2.2"') +
    c(50, 68, 1.8, C.brown) +
    c(50, 78, 1.8, C.brown) +
    c(50, 88, 1.8, C.brown),
  scarf: () =>
    rc(34, 58, 32, 8, 4, C.pink, K1) +
    rc(46, 62, 9, 18, 4, C.pinkD, K1) +
    l("M36 62h6M52 62h6", 'stroke="#FBD3DC" stroke-width="2"'),
  tshirt: () => e(50, 74, 22, 20, C.sky, K) + star(50, 74, 5.4, C.yellow, K1),
  chefcoat: () =>
    e(50, 74, 22, 20, C.white, K) +
    l("M50 58v32", 'stroke="#E6DACE" stroke-width="1.8"') +
    c(50, 66, 1.6, C.grayD) +
    c(50, 74, 1.6, C.grayD) +
    c(50, 82, 1.6, C.grayD),
};

const PROP = {
  none: () => "",
  coffee: () =>
    e(50, 76, 5, 3, "#5C4A45") +
    rc(34, 62, 32, 26, 8, C.paper, K) +
    rc(36, 60, 28, 8, 4, "#9A7E6F", K) +
    l(
      "M38 58q4-6 0-10M50 58q4-6 0-10M62 58q4-6 0-10",
      'stroke="#C9AFA0" stroke-width="2.4" stroke-linecap="round"',
    ),
  toast: () =>
    p("M38 62q-6-10 2-14 2-6 10-4 8-2 10 4 8 4 2 14v18q-12 4-24 0Z", "#F0C98A", K) +
    p("M42 66q-4-6 2-8 2-4 6-3 4-1 6 3 6 2 2 8v10q-8 3-16 0Z", "#FFF0D2", "") +
    c(48, 68, 1.4, "#E3BE83"),
  pillow: () =>
    p("M34 66q-4-10 4-12 10-4 24 0 8 2 4 12l-2 14q-14 6-28 0Z", C.sky, K) +
    l("M40 66q10 4 20 0", 'stroke="#9EC6E0" stroke-width="2"') +
    star(50, 74, 4, C.yellow, K1),
  pan: () =>
    rc(56, 46, 7, 34, 3, "#B08977", K, 'transform="rotate(12 60 60)"') +
    e(42, 72, 20, 9, "#A08E9A", K) +
    c(42, 72, 12, "#8E8891") +
    e(46, 70, 7, 4, "#F6E5AC"),
  umbrella: () =>
    p(
      "M12 32q8-30 38-30t38 30q-19-9-38 0-19-9-38 0Z",
      "rgba(198,224,243,.95)",
      'stroke="#8FB9D6" stroke-width="2.8" stroke-linejoin="round"',
    ) +
    l(
      "M24 26q10-16 26-20",
      'stroke="#fff" stroke-width="2.2" opacity=".7" stroke-linecap="round"',
    ) +
    l("M82 30v52q0 9-9 6", 'stroke="#8FB9D6" stroke-width="3.2" stroke-linecap="round"') +
    l("M50 -4v4", 'stroke="#8FB9D6" stroke-width="2.4" stroke-linecap="round"') +
    c(50, -5, 2.4, "#F5B8C5", 'stroke="#8FB9D6" stroke-width="1.6"'),
  swimring: () =>
    e(50, 88, 29, 10, "none", 'stroke="#F2A6B6" stroke-width="10"') +
    e(
      50,
      88,
      29,
      10,
      "none",
      'stroke="#FBD3DC" stroke-width="10" stroke-dasharray="9 12" opacity=".9"',
    ) +
    e(50, 88, 29, 10, "none", 'stroke="#E7A0AB" stroke-width="2.2"') +
    e(50, 88, 17, 5, "none", 'stroke="#E7A0AB" stroke-width="2.2"'),
  wateringcan: () =>
    p("M60 62h22q6 0 6 8v8q0 6-6 6H60q-6 0-6-8v-6q0-8 6-8Z", C.mintD, K) +
    l("M88 68l10-6M86 78l12 4", 'stroke="#BE8F86" stroke-width="3" stroke-linecap="round"') +
    rc(60, 58, 20, 6, 3, C.greenD, K1),
  gift: () =>
    rc(34, 66, 34, 24, 4, C.pink, K) +
    rc(32, 62, 38, 8, 3, C.pinkD, K) +
    rc(47, 66, 8, 24, 1, C.yellow, K1) +
    p("M50 62q-12-4-12-10 0-6 6-4 5 2 6 14Z", C.yellow, K1) +
    p("M50 62q12-4 12-10 0-6-6-4-5 2-6 14Z", C.yellow, K1),
  donut: () =>
    c(50, 76, 18, "#F3D3A8", K) +
    p(
      "M50 58c-10 0-18 8-18 18s8 18 18 18 18-8 18-18-8-18-18-18Zm0 12c3.3 0 6 2.7 6 6s-2.7 6-6 6-6-2.7-6-6 2.7-6 6-6Z",
      C.pink,
      K,
    ) +
    c(50, 76, 6, "#FFF7EE", K1) +
    [
      [38, 66],
      [62, 66],
      [44, 86],
      [58, 88],
      [50, 60],
    ]
      .map(([x, y]) =>
        l(`M${x} ${y}l2 3`, 'stroke="#FFF3D8" stroke-width="2" stroke-linecap="round"'),
      )
      .join(""),
  backpack: () =>
    rc(64, 58, 22, 30, 8, C.mint, K) +
    rc(68, 54, 14, 6, 3, C.mintD, K1) +
    rc(72, 68, 6, 8, 3, C.mintD, K1) +
    l("M64 60q-6 2-6 8", 'stroke="#BE8F86" stroke-width="2"'),
  camera: () =>
    rc(28, 66, 26, 20, 5, "#A08E9A", K) +
    rc(38, 62, 10, 5, 2, "#A08E9A", K1) +
    c(41, 76, 7, "#C7DFF0", K1) +
    c(41, 76, 4, "#9EC6E0") +
    c(52, 70, 2, C.yellow),
  ball: () =>
    c(56, 82, 13, C.peach, K) +
    p("M56 69q-8 8 0 26", "none", 'stroke="#E7AC86" stroke-width="2"') +
    l("M45 84q11-6 22 0", 'stroke="#E7AC86" stroke-width="2"'),
  rattle: () =>
    l("M56 66v22", 'stroke="#E0C7A8" stroke-width="6" stroke-linecap="round"') +
    c(56, 68, 8, C.pink, K) +
    c(52, 74, 3.4, C.yellow, K1),
  coin: () =>
    c(58, 82, 13, C.yellow, K) +
    c(58, 82, 9, "none", 'stroke="#E3C36A" stroke-width="2"') +
    p("M58 76v12M54 80h7", "none", 'stroke="#C9A74E" stroke-width="2"'),
  spatula: () =>
    l("M60 62v26", 'stroke="#B08977" stroke-width="5" stroke-linecap="round"') +
    rc(50, 52, 20, 14, 5, "#9A9AA6", K),
  icecream: () =>
    p("M46 70l8 22 8-22Z", "#F0C98A", K) +
    c(54, 66, 10, C.pinkL, K) +
    c(54, 56, 8, C.white, K) +
    c(54, 48, 6, C.pinkL, K) +
    c(48, 50, 1.6, C.red, K1),
  book: () =>
    p("M34 72h28v20H34q-4 0-4-4V76q0-4 4-4Z", C.sky, K) +
    l("M62 72v20", 'stroke="#9EC6E0" stroke-width="2"') +
    l("M40 78h14M40 84h10", 'stroke="#9EC6E0" stroke-width="2"'),
  phone: () =>
    rc(52, 60, 18, 30, 4, "#A08E9A", K) +
    rc(55, 64, 12, 21, 2, "#C7DFF0") +
    c(61, 87, 1.4, C.white),
  wand: () =>
    l("M56 88l14-26", 'stroke="#E0C7A8" stroke-width="4" stroke-linecap="round"') +
    star(76, 56, 9, C.yellow, K1),
  chicken: () => "",
};

/* ---- Assembling a piglet ---- */
const HATS_IN_FACE_SPACE = ["hood", "pandaHood", "helmet", "halo", "horns"];
/** The three bodies with legs: an oval centred at (50, cy). The ghost has its own outline. */
const BODIES = {
  stand: { cy: 72, rx: 16, ry: 14.2 },
  round: { cy: 71.5, rx: 18.8, ry: 15 },
  sit: { cy: 71, rx: 17.6, ry: 14.2 },
};
const HEAD =
  "M50 11.5C70 11.5 84 23 84 39.5 84 54 72 63 50 63S16 54 16 39.5C16 23 30 11.5 50 11.5Z";
const HEAD_SHADE = "M16.4 42C18 55 31 61 50 61s32-6 33.6-19C83 56 71 63.4 50 63.4S17 56 16.4 42Z";
const EAR_OUTER =
  "M17.8 31C16.6 22.5 17 14 19.6 7.6c.9-2.2 3.3-2.9 5.3-1.6 5.9 3.7 11.4 7.6 16.6 11.4";
const EAR_INNER = "M21.4 25.5c-.6-5.5-.2-10.6 1.4-14.6 4 2.5 8 5.3 11.8 8.2Z";
/** The tip folded forward over the ear: a small flap below the fold line. */
const EAR_FOLD = "M19.2 9.8 26.6 6.6 22.8 14.2Z";
const CURL = "M48.6 11.4c-1.6-3.6.8-6.6 3.6-5.8 2.4.7 2.6 3.7.5 4.5-1.4.5-2.6-.6-2-1.8";
const GHOST =
  "M31 60C31 45.5 69 45.5 69 60v20.5q-4.75 6.2-9.5 1.2Q55 86.6 50 81.6q-4.75 5-9.5.2T31 80.5Z";

/**
 * One piglet as SVG markup for the 100 x 100 sticker box. Options: skin, shade, snout (colours;
 * snout 'none' leaves it off), line (the outline colour), body ('stand' | 'round' | 'sit' |
 * 'ghost'), eyes (a FACE key), ears ('none' hides them), hat (a HAT key), outfit (an OUTFIT key),
 * prop (a PROP key), tail (false hides it), noArms, curl (false hides the hair curl), and three
 * raw overlays: back (behind everything), extra (over the face, under the hat) and special (on
 * top of everything).
 */
function pig(o) {
  o = o || {};
  const skin = o.skin || "#FFF3F0",
    shade = o.shade || "#F6CFCB";
  const snoutC = o.snout && o.snout !== "none" ? o.snout : "#FBD7DE";
  const body = BODIES[o.body] || o.body === "ghost" ? o.body : "stand";
  const eyes = o.eyes || "open",
    hat = o.hat && HAT[o.hat] ? o.hat : "none";
  const ln = o.line || "#D86F87";
  const S2 = `stroke="${ln}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"`;
  const S1 = `stroke="${ln}" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"`;
  const b = BODIES[body];
  let s = e(50, 91, 16, 2.4, "#C79A92", 'opacity=".12"');
  if (o.back) s += o.back;

  /* body: stubby feet with a split hoof behind a round body, or the ghost's wavy hem */
  if (body === "ghost") {
    s +=
      p(GHOST, skin, S2) +
      p("M31 62c6 6.5 32 6.5 38 0-1 10.5-9 16-19 16s-18-5.5-19-16Z", shade, 'opacity=".26"');
  } else {
    if (body !== "sit") {
      const fx = body === "round" ? 13.4 : 11.4;
      [50 - fx, 50 + fx - 9.4].forEach((x) => {
        s += rc(x, 82.6, 9.4, 7, 3.5, shade, S2);
        s += l(
          `M${(x + 4.7).toFixed(1)} 86.6v2.3`,
          `stroke="${ln}" stroke-width="1.4" stroke-linecap="round" opacity=".55"`,
        );
      });
    }
    s += e(50, b.cy, b.rx, b.ry, skin, S2);
    s += e(50, b.cy + 3, b.rx * 0.56, b.ry * 0.56, shade, 'opacity=".32"');
    if (body === "sit") {
      [40.5, 59.5].forEach((x) => {
        s += e(x, 84.6, 6.6, 3.9, skin, S2) + e(x, 85.6, 3, 1.7, shade, "");
        s += l(
          `M${x} 84.4v2.4`,
          `stroke="${ln}" stroke-width="1.3" stroke-linecap="round" opacity=".5"`,
        );
      });
    }
  }
  const outfit = OUTFIT[o.outfit || "none"] ? o.outfit || "none" : "none";
  s += '<g transform="translate(50,78) scale(.78) translate(-50,-88)">' + OUTFIT[outfit]() + "</g>";
  /* little round arms and a curly tail */
  if (b && !o.noArms) {
    s +=
      c(50 - b.rx - 0.2, b.cy - 2.2, 4.4, skin, S2) + c(50 + b.rx + 0.2, b.cy - 2.2, 4.4, skin, S2);
  }
  if (b && o.tail !== false) {
    const tx = (50 + b.rx - 1.4).toFixed(1),
      ty = (b.cy + 3).toFixed(1);
    s += l(
      `M${tx} ${ty}c4.4-1.4 7.6 1 6.6 4-.8 2.4-3.6 2.6-4.4.8-.6-1.5.9-2.7 2.3-1.9`,
      `stroke="${ln}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"`,
    );
  }

  /* ears behind the head: upright, with the tip folded forward */
  if (o.ears !== "none" && body !== "ghost") {
    const ear =
      p(EAR_OUTER + "Z", skin) +
      l(EAR_OUTER, S2) +
      p(EAR_INNER, snoutC, 'opacity=".85"') +
      p(EAR_FOLD, shade, S1);
    s += ear + mirror(ear);
  }
  /* the head: a wide bean, a soft shade at the chin, one gloss mark, the crown curl */
  s += p(HEAD, skin, `stroke="${ln}" stroke-width="2.5" stroke-linejoin="round"`);
  s += p(HEAD_SHADE, shade, 'opacity=".24"');
  s += e(31.5, 21.5, 7.4, 3.6, "#FFFFFF", 'opacity=".55" transform="rotate(-22 31.5 21.5)"');
  if (o.curl !== false) s += l(CURL, `stroke="${ln}" stroke-width="2" stroke-linecap="round"`);
  /* solid blush dots, the eyes, the pill snout and a tiny mouth */
  s += c(24.5, 47.5, 4.4, "#F7A5B6") + c(75.5, 47.5, 4.4, "#F7A5B6");
  s += (FACE[eyes] || FACE.open)();
  if (o.snout !== "none") {
    s += rc(37.5, 44, 25, 12.6, 6.3, snoutC, `stroke="${ln}" stroke-width="2.2"`);
    s += rc(44, 47.2, 3, 6.2, 1.5, "#D2808F") + rc(53, 47.2, 3, 6.2, 1.5, "#D2808F");
    s += l(
      "M41.2 46.8q2.4-1.3 5-1.1",
      'stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round" opacity=".8"',
    );
  }
  s += l("M47.4 59q2.6 2.2 5.2 0", `stroke="${ln}" stroke-width="1.9" stroke-linecap="round"`);
  if (o.extra) s += o.extra;
  s += HATS_IN_FACE_SPACE.includes(hat)
    ? HAT[hat]()
    : '<g transform="translate(50,6) scale(1.06) translate(-50,-9.5)">' + HAT[hat]() + "</g>";
  if (o.prop && PROP[o.prop]) {
    const big = o.prop === "umbrella" || o.prop === "swimring";
    s += big
      ? PROP[o.prop]()
      : '<g transform="translate(60,88) scale(.6) translate(-50,-78)">' + PROP[o.prop]() + "</g>";
  }
  if (o.special) s += o.special;
  return s;
}
