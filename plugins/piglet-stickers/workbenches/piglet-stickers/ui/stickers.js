/* Piggy Sticker World: the sticker registry.
 *
 * Every sticker is drawn here once, at load, with the helpers of art.js; its name (and a pig's
 * description) is looked up in i18n.js by the sticker's id: stk.<id> and desc.<id>. A classic
 * script with no DOM access, loaded after art.js. */

/* ---------------- The piglet family: one costume per pig, in id order ---------------- */
const PIG_DEFS = [
  /* pig1 strawberry */ { hat: "strawberry", eyes: "happy" },
  /* pig2 cream */ {
    skin: "#FFF8F2",
    shade: "#F1E2D6",
    snout: "#FDE4E9",
    hat: "cream",
    eyes: "sleepy",
    body: "round",
  },
  /* pig3 bread */ { skin: "#F7D9AE", shade: "#E6BE8B", hat: "bread", prop: "toast" },
  /* pig4 sleepyhead */ { eyes: "closed", outfit: "pajamas", prop: "pillow", body: "sit" },
  /* pig5 boss */ {
    skin: "#F3D6B0",
    shade: "#E0BC90",
    eyes: "shades",
    outfit: "suit",
    prop: "coin",
  },
  /* pig6 bunny ears */ {
    hat: "bunny",
    eyes: "open",
    ears: "none",
    skin: "#FCEDF0",
    shade: "#F2D3DA",
    snout: "#FBE3E7",
  },
  /* pig7 drowsy */ {
    eyes: "sleepy",
    body: "sit",
    extra:
      l("M86 26h8l-8 8h8", 'stroke="#E7A0AB" stroke-width="2.4" stroke-linejoin="round"') +
      l("M92 14h6l-6 6h6", 'stroke="#E7A0AB" stroke-width="2" stroke-linejoin="round"'),
  },
  /* pig8 bow */ { hat: "bow", outfit: "dress", eyes: "heart" },
  /* pig9 chef */ { hat: "chef", outfit: "chefcoat", prop: "pan", eyes: "happy" },
  /* pig10 bathrobe: cucumber slices over closed eyes, a towel wrapped round the head */
  {
    outfit: "towel",
    eyes: "closed",
    ears: "none",
    extra:
      [35, 65]
        .map(
          (x) =>
            c(x, 36.5, 7, "#E4F0CF", 'stroke="#B9CD9B" stroke-width="1.8"') +
            c(x, 36.5, 4.4, "none", 'stroke="#C9DCAF" stroke-width="1.4"') +
            c(x, 36.5, 1.2, "#C9DCAF"),
        )
        .join("") +
      p(
        "M20 26c-1.6-10.4 12.4-17.6 30-17.6s31.6 7.2 30 17.6c-1.4 5.4-7.6 8.4-14.6 7-6-4.4-24.8-4.4-30.8 0-7 1.4-13.2-1.6-14.6-7Z",
        "#FFFDF9",
        'stroke="#E3D6C8" stroke-width="2" stroke-linejoin="round"',
      ) +
      l(
        "M25 18.4q25-10 50 0M28 23q22-7.6 44 0",
        'stroke="#EBDDD0" stroke-width="1.8" stroke-linecap="round"',
      ),
  },
  /* pig11 rainy day */ { hat: "hood", outfit: "raincoat", prop: "umbrella" },
  /* pig12 seaside */ { hat: "sunhat", prop: "swimring", eyes: "happy" },
  /* pig13 gardener */ { hat: "flowercrown", outfit: "apron", prop: "wateringcan" },
  /* pig14 astronaut */ {
    skin: "#FFF8F2",
    shade: "#EFE1D5",
    snout: "#FDE4E9",
    hat: "helmet",
    body: "round",
    eyes: "star",
    ears: "none",
  },
  /* pig15 little devil */ {
    skin: "#EDC8D9",
    shade: "#DBAEBF",
    hat: "horns",
    eyes: "wink",
    extra: p(
      "M74 84q14 0 12 10l7-4-3 10-7-4 3-5q-3-4-12-3Z",
      "#E39AA8",
      'stroke="#E7A0AB" stroke-width="2" stroke-linejoin="round"',
    ),
  },
  /* pig16 angel */ {
    skin: "#FFF8F2",
    shade: "#F1E0D4",
    hat: "halo",
    eyes: "closed",
    back:
      p(
        "M20 40q-16 6-14 26 10 10 22 2-8-12-8-28Z",
        "#FFFDF8",
        'stroke="#E7A0AB" stroke-width="2.4" stroke-linejoin="round"',
      ) +
      p(
        "M80 40q16 6 14 26-10 10-22 2 8-12 8-28Z",
        "#FFFDF8",
        'stroke="#E7A0AB" stroke-width="2.4" stroke-linejoin="round"',
      ),
  },
  /* pig17 christmas */ { hat: "santa", outfit: "scarf", prop: "gift", eyes: "happy" },
  /* pig18 panda */ {
    skin: "#FFF8F2",
    shade: "#EBDCD1",
    hat: "pandaHood",
    eyes: "none",
    ears: "none",
  },
  /* pig19 cake */ { skin: "#FBEBDD", shade: "#F0D8C4", hat: "cake", body: "round", eyes: "happy" },
  /* pig20 mushroom */ {
    skin: "#F6E9DC",
    shade: "#E8D6C4",
    hat: "mushroom",
    body: "round",
    eyes: "open",
  },
  /* pig21 coffee */ { prop: "coffee", eyes: "happy", body: "sit" },
  /* pig22 tulip */ {
    hat: "tulip",
    outfit: "dress",
    skin: "#F8D8C8",
    shade: "#EABBA6",
    eyes: "open",
  },
  /* pig23 little ghost */ {
    body: "ghost",
    skin: "#FFFDF9",
    shade: "#EFE6DE",
    eyes: "dot",
    ears: "none",
    tail: false,
  },
  /* pig24 sporty */ { hat: "cap", outfit: "sports", prop: "ball", eyes: "happy" },
  /* pig25 punk */ { hat: "headphones", outfit: "vest", eyes: "cool", ears: "none" },
  /* pig26 baker */ { hat: "bonnet", outfit: "apron", prop: "donut", eyes: "happy", body: "sit" },
  /* pig27 traveller */ { hat: "cap", outfit: "coat", prop: "camera", extra: PROP.backpack() },
  /* pig28 bubble bath */ {
    body: "round",
    eyes: "happy",
    special:
      "<g>" +
      p("M26 78q0-8 8-8h32q8 0 8 8v6q0 6-8 6H34q-8 0-8-6Z", "#FFFDF9", K) +
      c(34, 66, 6, "rgba(255,255,255,.85)", K1) +
      c(66, 64, 6.5, "rgba(255,255,255,.85)", K1) +
      c(77, 72, 5, "rgba(255,255,255,.85)", K1) +
      "</g>",
  },
  /* pig29 fluffy onesie: a ring of puffs behind the head */
  {
    outfit: "fur",
    eyes: "dot",
    skin: "#F8DEE5",
    shade: "#EDC3CF",
    back: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
      .map((i) => {
        const a = -Math.PI + (i / 9) * Math.PI;
        return c(
          50 + Math.cos(a) * 35,
          42 + Math.sin(a) * 32,
          6.5,
          "#FBF0F3",
          'stroke="#E7A0AB" stroke-width="2.2"',
        );
      })
      .join(""),
  },
  /* pig30 sparkler */ {
    hat: "starpin",
    outfit: "tshirt",
    eyes: "star",
    special:
      star(12, 26, 5, C.yellow, K1) + star(90, 44, 4, C.yellow, K1) + star(16, 60, 3, C.yellow, K1),
  },
  /* pig31 baby */ { hat: "bonnet", outfit: "bib", prop: "rattle", eyes: "happy", body: "sit" },
  /* pig32 bear hoodie */ {
    hat: "bearhood",
    outfit: "overalls",
    prop: "icecream",
    eyes: "open",
    ears: "none",
  },
];

const PIGS = PIG_DEFS.map((opts, i) => ({
  id: "pig" + (i + 1),
  cat: "pig",
  opts,
  inner: pig(opts),
}));

/* Limited pigs, unlocked with stars: [costume, stars needed]. They are pig33-pig36. */
const LIMITED = [
  [{ hat: "crown", eyes: "happy" }, 3],
  [{ hat: "rainbow", eyes: "star", body: "round" }, 6],
  [{ hat: "cloud", eyes: "sleepy", body: "sit", skin: "#FFFBF8" }, 9],
  [{ hat: "starpin", eyes: "heart", outfit: "dress" }, 12],
];
LIMITED.forEach(([opts, need], i) =>
  PIGS.push({
    id: "pig" + (PIG_DEFS.length + i + 1),
    cat: "pig",
    opts,
    inner: pig(opts),
    star: need,
  }),
);

/* ---------------- Furniture ---------------- */
const FURN = [
  [
    () =>
      rc(16, 42, 68, 28, 14, "#F7C8D2", K) +
      rc(12, 54, 14, 24, 7, "#F2B0C0", K) +
      rc(74, 54, 14, 24, 7, "#F2B0C0", K) +
      rc(22, 62, 56, 16, 9, "#F1AFBF", K) +
      l("M50 63v16", 'stroke="#E79CB0" stroke-width="2"') +
      rc(24, 82, 8, 6, 3, C.brown, K1) +
      rc(68, 82, 8, 6, 3, C.brown, K1) +
      heart(50, 52, 1, "#FFF6F8", K1),
  ],
  [
    () =>
      rc(18, 46, 64, 24, 12, C.mint, K) +
      rc(14, 56, 12, 22, 6, C.mintD, K) +
      rc(74, 56, 12, 22, 6, C.mintD, K) +
      rc(24, 62, 52, 14, 8, "#D6E9DC", K) +
      rc(26, 80, 7, 6, 3, C.brown, K1) +
      rc(67, 80, 7, 6, 3, C.brown, K1),
  ],
  [
    () =>
      rc(10, 44, 12, 40, 5, "#E7D6C4", K) +
      rc(10, 58, 80, 26, 8, "#FFF6EA", K) +
      rc(18, 40, 24, 16, 7, C.white, K) +
      rc(46, 42, 26, 14, 7, "#FBD3DC", K) +
      rc(20, 66, 68, 18, 6, "#E9C7D8", K) +
      l("M24 66v18M38 66v18M52 66v18M66 66v18M80 66v18", 'stroke="#DBB4C8" stroke-width="1.6"') +
      rc(16, 84, 8, 6, 3, C.brown, K1),
  ],
  [
    () =>
      rc(12, 46, 10, 36, 4, C.brown, K) +
      rc(14, 60, 74, 22, 7, "#F4EFE6", K) +
      rc(20, 38, 22, 14, 6, C.white, K) +
      rc(22, 64, 66, 16, 6, C.sky, K) +
      l("M28 64v16M44 64v16M60 64v16M76 64v16", 'stroke="#B9D3E4" stroke-width="1.6"'),
  ],
  [
    () =>
      e(50, 50, 32, 12, "#E3C39E", K) +
      rc(46, 56, 8, 26, 3, "#C8A379", K) +
      e(50, 84, 20, 6, "#D8B58D", K),
  ],
  [
    () =>
      rc(18, 44, 64, 12, 5, "#E7C8A4", K) +
      rc(24, 56, 6, 28, 3, "#C8A379", K) +
      rc(70, 56, 6, 28, 3, "#C8A379", K) +
      l("M20 50h60", 'stroke="#D3B18B" stroke-width="1.6"'),
  ],
  [
    () =>
      rc(32, 34, 36, 30, 8, "#EFCFC0", K) +
      rc(30, 60, 40, 10, 5, "#E4B9A6", K) +
      rc(34, 70, 6, 18, 3, C.brownD, K1) +
      rc(60, 70, 6, 18, 3, C.brownD, K1) +
      rc(34, 44, 32, 10, 4, "#FFF1E8", K1),
  ],
  [
    () =>
      e(50, 52, 24, 10, C.pink, K) +
      e(50, 52, 16, 6, "#FBD3DC", K1) +
      rc(38, 58, 5, 24, 2, C.brown, K) +
      rc(57, 58, 5, 24, 2, C.brown, K),
  ],
  [
    () =>
      rc(18, 22, 64, 64, 6, "#E0BF9C", K) +
      l("M18 44h64M18 64h64", 'stroke="#C8A379" stroke-width="2.4"') +
      rc(23, 28, 8, 15, 2, C.sky, K1) +
      rc(33, 30, 7, 13, 2, C.pink, K1) +
      rc(42, 26, 6, 17, 2, C.yellow, K1) +
      rc(24, 48, 9, 15, 2, C.mint, K1) +
      rc(36, 50, 7, 13, 2, C.peach, K1) +
      rc(48, 46, 6, 17, 2, C.purple, K1) +
      rc(23, 68, 26, 9, 2, "#F5E2C8", K1),
  ],
  [
    () =>
      rc(20, 20, 60, 68, 6, "#E7CDB4", K) +
      l("M50 22v64", 'stroke="#C8A379" stroke-width="2.4"') +
      c(46, 56, 2, C.brownD) +
      c(54, 56, 2, C.brownD) +
      rc(24, 26, 22, 4, 2, "#D9B997", K1) +
      rc(54, 26, 22, 4, 2, "#D9B997", K1),
  ],
  [
    () =>
      e(50, 62, 34, 22, "#F8D8DE", K) +
      e(50, 62, 22, 13, "none", 'stroke="#F1AFBF" stroke-width="2" stroke-dasharray="6 6"') +
      e(50, 62, 8, 5, "#F1AFBF"),
  ],
  [
    () =>
      rc(12, 50, 76, 32, 10, "#EAF2EC", K) +
      l("M24 50v32M36 50v32M48 50v32M60 50v32M72 50v32", 'stroke="#BCD6C7" stroke-width="3"') +
      l("M12 56h76M12 76h76", 'stroke="#BCD6C7" stroke-width="2"'),
  ],
  [
    () =>
      e(50, 88, 16, 5, C.brown, K) +
      rc(47, 46, 6, 42, 3, "#C8A379", K) +
      p("M30 46h40l-7-24H37Z", C.yellow, K) +
      e(50, 46, 20, 4, C.yellowD, K1) +
      c(50, 26, 3, "#FFF3C9", 'opacity=".9"'),
  ],
  [
    () =>
      e(50, 86, 20, 5, C.pink, K) +
      rc(46, 68, 8, 18, 3, C.pinkD, K) +
      p("M30 66q0-30 20-30t20 30Z", C.pinkL, K) +
      l("M34 58q16-8 32 0", 'stroke="#F7C8D2" stroke-width="2"'),
  ],
  [
    () =>
      rc(10, 18, 80, 7, 3, C.brown, K1) +
      p("M16 25q10 30 4 62h20q-6-32 4-62Z", "#FBE3E8", K) +
      p("M84 25q-10 30-4 62H60q6-32-4-62Z", "#FBE3E8", K) +
      l("M20 34q6 24 2 46M80 34q-6 24-2 46", 'stroke="#F3C6D2" stroke-width="2"'),
  ],
  [
    () =>
      c(50, 50, 30, C.paper, K) +
      c(50, 50, 24, "#DCEBF5", K1) +
      p(
        "M34 62q14-22 34-24",
        "none",
        'stroke="#fff" stroke-width="4" opacity=".85" stroke-linecap="round"',
      ),
  ],
  [
    () =>
      rc(20, 44, 60, 42, 6, "#E7CDB4", K) +
      l("M20 64h60", 'stroke="#C8A379" stroke-width="2"') +
      c(50, 55, 2.4, C.brownD) +
      c(50, 75, 2.4, C.brownD) +
      flower(50, 34, 6, C.pink, C.yellow, 1) +
      rc(46, 38, 8, 8, 3, C.pinkL, K1),
  ],
  [
    () =>
      rc(24, 18, 52, 72, 8, "#F2F6F8", K) +
      l("M24 46h52", 'stroke="#D3DFE6" stroke-width="2.4"') +
      rc(66, 26, 4, 14, 2, C.grayD, K1) +
      rc(66, 54, 4, 14, 2, C.grayD, K1) +
      c(38, 34, 3, C.sky) +
      c(46, 34, 3, C.pink) +
      c(38, 70, 3, C.mint),
  ],
  [
    () =>
      rc(22, 22, 56, 66, 10, "#F7F2EC", K) +
      c(50, 58, 20, "#DCEBF5", K) +
      c(50, 58, 15, "#EFF7FC", "") +
      c(50, 58, 6, "#CFE4F2", "") +
      rc(30, 30, 40, 8, 4, "#E7DFD6", K1) +
      c(36, 44, 3, C.pink, K1) +
      c(46, 44, 3, C.yellow, K1),
  ],
  [
    () =>
      p("M18 54h64v18q0 14-14 14H32q-14 0-14-14Z", C.white, K) +
      rc(16, 50, 68, 8, 4, C.paper, K) +
      l("M30 78h40", 'stroke="#DDE7EE" stroke-width="2"') +
      c(50, 42, 8, "rgba(255,255,255,.9)", K1) +
      c(64, 34, 5, "rgba(255,255,255,.9)", K1) +
      c(38, 30, 4, "rgba(255,255,255,.9)", K1) +
      l("M82 54v-8q0-6-6-6", 'stroke="#BE8F86" stroke-width="3" stroke-linecap="round"'),
  ],
  [
    () =>
      rc(18, 56, 64, 22, 8, "#FFF6EC", K) +
      e(50, 56, 20, 7, "#DCEBF5", K) +
      l("M50 50v-12q0-6 8-6", 'stroke="#BE8F86" stroke-width="3" stroke-linecap="round"') +
      c(50, 68, 2.6, C.pinkD) +
      rc(38, 78, 6, 10, 3, C.grayD, K1) +
      rc(56, 78, 6, 10, 3, C.grayD, K1),
  ],
  [
    () =>
      rc(14, 46, 72, 10, 4, "#E7C8A4", K) +
      rc(20, 56, 6, 30, 3, "#C8A379", K) +
      rc(74, 56, 6, 30, 3, "#C8A379", K) +
      rc(28, 62, 22, 16, 4, "#D9B997", K1) +
      rc(56, 36, 14, 10, 2, C.sky, K1) +
      c(63, 34, 3, C.pink, K1),
  ],
  [
    () =>
      p("M22 40q-6 14 0 26 14 10 28 0 6-12 0-26-14-10-28 0Z", "#FBD3DC", K) +
      heart(50, 54, 1, C.pink, K1),
  ],
  [
    () =>
      p("M20 42q0-8 8-8h44q8 0 8 8v18q0 8-8 8H28q-8 0-8-8Z", C.white, K) +
      l("M24 44q26 8 52 0", 'stroke="#EFE4D8" stroke-width="2"') +
      l("M28 64q22 6 44 0", 'stroke="#EFE4D8" stroke-width="2"'),
  ],
  [
    () =>
      rc(16, 26, 68, 46, 8, "#A08E9A", K) +
      rc(20, 30, 60, 38, 5, "#D5EAF6") +
      l("M30 30v38M60 30v38", 'stroke="#fff" stroke-width="1.4" opacity=".5"') +
      rc(36, 72, 6, 8, 2, "#4E4952", K1) +
      rc(58, 72, 6, 8, 2, "#4E4952", K1),
  ],
  [
    () =>
      rc(12, 48, 76, 10, 4, "#E7C8A4", K) +
      rc(16, 58, 68, 6, 3, "#D9B997", K1) +
      rc(20, 62, 6, 22, 3, C.brown, K) +
      rc(74, 62, 6, 22, 3, C.brown, K),
  ],
  [
    () =>
      rc(22, 26, 56, 62, 6, "#EAD3BC", K) +
      l("M22 46h56M22 66h56", 'stroke="#C8A379" stroke-width="2"') +
      c(50, 36, 2.2, C.brownD) +
      c(50, 56, 2.2, C.brownD) +
      c(50, 76, 2.2, C.brownD),
  ],
  [
    () =>
      c(50, 50, 28, C.paper, K) +
      c(50, 50, 23, "#FBF0E0", K1) +
      l("M50 50V34M50 50l10 7", 'stroke="#BE8F86" stroke-width="2.6" stroke-linecap="round"') +
      c(50, 50, 2.6, C.pinkD),
  ],
  [
    () =>
      rc(14, 50, 72, 8, 4, "#E7C8A4", K) +
      rc(24, 34, 12, 16, 3, C.mint, K1) +
      rc(42, 30, 10, 20, 3, C.pink, K1) +
      rc(58, 36, 14, 14, 3, C.sky, K1) +
      flower(72, 40, 4, C.white, C.yellow, 1),
  ],
  [
    () =>
      rc(24, 40, 52, 28, 6, C.pinkL, K) +
      rc(24, 38, 52, 6, 3, C.pink, K1) +
      c(30, 74, 8, "#B39AA2", K) +
      c(70, 74, 8, "#B39AA2", K) +
      l("M76 40q10-6 12-16", 'stroke="#BE8F86" stroke-width="3" stroke-linecap="round"') +
      heart(50, 54, 1.1, C.pink, K1),
  ],
].map((d, i) => ({ id: "furn" + (i + 1), cat: "furn", inner: d[0]() }));

/* ---------------- Plants ---------------- */
const PLANTS = [
  [
    () =>
      p("M32 60h36l-5 26H37Z", "#EFAFA0", K) +
      rc(30, 56, 40, 8, 3, "#E49B8C", K) +
      l("M50 56V34", 'stroke="#86AE78" stroke-width="2.6"') +
      leafShape(49, 44, 0.9, -35, C.green) +
      leafShape(51, 36, 0.8, 200, C.mintD) +
      leafShape(52, 30, 0.7, -25, C.green),
  ],
  [
    () =>
      p("M34 58h32l-4 28H38Z", "#E7DCCF", K) +
      rc(32, 54, 36, 6, 3, "#D6C8B8", K1) +
      l("M50 54V24", 'stroke="#86AE78" stroke-width="2.6"') +
      p("M50 26q-24-4-26 12 14 6 26-4Z", C.green, K) +
      p("M50 24q22-8 26 6-12 8-26 0Z", C.mintD, K) +
      p("M50 18q-8-10 0-16 8 6 0 16Z", C.green, K) +
      c(36, 34, 2.4, "#EFF7EA") +
      c(66, 30, 2, "#EFF7EA"),
  ],
  [
    () =>
      p("M34 62h32l-3 24H37Z", C.peach, K) +
      rc(32, 58, 36, 6, 3, C.peachD, K1) +
      p("M42 58V36q0-10 8-10t8 10v22Z", C.mintD, K) +
      p("M42 48q-12 0-12-12", "none", 'stroke="#9FC8B0" stroke-width="7" stroke-linecap="round"') +
      p("M58 42q12 0 12-10", "none", 'stroke="#9FC8B0" stroke-width="7" stroke-linecap="round"') +
      l("M46 34v4M54 38v4M50 46v4", 'stroke="#7FA792" stroke-width="1.6"'),
  ],
  [
    () =>
      p("M35 64h30l-3 22H38Z", "#F3C6A8", K) +
      rc(33, 60, 34, 6, 3, C.peachD, K1) +
      p("M41 60V40q0-10 9-10t9 10v20Z", C.mintD, K) +
      flower(50, 26, 9, C.pink, C.yellow, 1) +
      l("M44 44v4M56 44v4", 'stroke="#7FA792" stroke-width="1.6"'),
  ],
  [
    () =>
      l("M50 92V54", 'stroke="#86AE78" stroke-width="3"') +
      leafShape(52, 72, 0.8, -40, C.green) +
      leafShape(48, 62, 0.7, 200, C.greenD) +
      c(50, 38, 15, C.red, K1) +
      l(
        "M41 34q9-8 18 0M44 42q6-5 12 0M50 30v14",
        'stroke="#D2737F" stroke-width="2" stroke-linecap="round"',
      ),
  ],
  [
    () =>
      l("M50 92V52", 'stroke="#86AE78" stroke-width="3"') +
      leafShape(46, 74, 1, 210, C.green) +
      leafShape(54, 66, 0.8, -40, C.mintD) +
      p("M36 46q-2-18 7-18 2 8 7 8t7-8q9 0 7 18-9 6-14 6t-14-6Z", "#F3A6B8", K),
  ],
  [
    () =>
      l("M50 92V56", 'stroke="#86AE78" stroke-width="3"') +
      leafShape(52, 76, 0.9, -35, C.green) +
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
        .map((i) => {
          const a = (i / 12) * Math.PI * 2;
          return e(
            50 + Math.cos(a) * 15,
            34 + Math.sin(a) * 15,
            5.4,
            3.4,
            "#F8C86A",
            K1,
            `transform="rotate(${i * 30} ${50 + Math.cos(a) * 15} ${34 + Math.sin(a) * 15})"`,
          );
        })
        .join("") +
      c(50, 34, 10, "#B08977", K) +
      l("M45 31h.01M55 31h.01", 'stroke="#7A5C4E" stroke-width="2"'),
  ],
  [
    () =>
      l("M50 92V50", 'stroke="#86AE78" stroke-width="2.6"') +
      leafShape(52, 78, 0.8, -30, C.green) +
      flower(50, 40, 14, C.white, C.yellow, 1) +
      flower(72, 64, 9, C.white, C.yellow, 1) +
      l("M50 54q6 12 22 10", 'stroke="#86AE78" stroke-width="2"'),
  ],
  [
    () =>
      p("M38 58q0-26 12-26t12 26Z", "#F09A9A", K) +
      rc(42, 56, 16, 34, 6, "#FFF6EC", K) +
      c(44, 46, 3.4, "#FFF0EA") +
      c(56, 50, 3, "#FFF0EA") +
      e(42, 90, 8, 3, "rgba(128,102,93,.12)"),
  ],
  [
    () =>
      p("M60 66q0-20 9-20t9 20Z", "#F3B3B3", K) +
      rc(63, 64, 12, 26, 5, "#FFF6EC", K) +
      p("M22 72q0-16 8-16t8 16Z", "#EBA0C0", K) +
      rc(26, 70, 8, 20, 4, "#FFF6EC", K) +
      c(30, 62, 2.2, "#FFF0EA") +
      l("M22 90q28-4 56 0", 'stroke="#D9C7B6" stroke-width="2"'),
  ],
  [
    () =>
      rc(46, 62, 9, 30, 3, "#B08977", K) +
      c(50, 46, 26, C.mint, K) +
      c(34, 56, 14, C.mintD, K) +
      c(66, 56, 14, C.mintD, K) +
      c(44, 38, 3, "#E2F0E5") +
      c(58, 48, 2.6, "#E2F0E5"),
  ],
  [
    () =>
      rc(47, 70, 6, 22, 2, C.brown, K) +
      p("M50 16l20 30H30Z", C.greenD, K) +
      p("M50 34l22 28H28Z", C.green, K) +
      p("M50 52l24 26H26Z", "#8FBF86", K) +
      star(50, 14, 5, C.yellow, K1),
  ],
  [
    () =>
      p("M26 54h48l-8 30H34Z", "#E3C39E", K) +
      rc(22, 48, 56, 8, 4, "#D8B58D", K) +
      l("M30 56q20 12 40 0", 'stroke="#C8A379" stroke-width="2"') +
      flower(38, 38, 9, C.pink, C.yellow, 1) +
      flower(62, 36, 9, C.white, C.yellow, 1) +
      flower(50, 26, 9, C.yellow, C.pinkD, 1) +
      l("M38 46v8M62 44v10M50 34v14", 'stroke="#86AE78" stroke-width="2"'),
  ],
  [
    () =>
      l(
        "M50 6q-14 14 0 26t0 28M50 6q14 14 0 26t0 28",
        'stroke="#86AE78" stroke-width="3" stroke-linecap="round"',
      ) +
      leafShape(44, 20, 0.7, 200, C.green) +
      leafShape(58, 32, 0.7, -20, C.mintD) +
      leafShape(42, 48, 0.7, 200, C.green) +
      leafShape(58, 60, 0.7, -20, C.mintD),
  ],
  [
    () =>
      l("M50 10v14", 'stroke="#C8A379" stroke-width="2"') +
      p("M30 24h40l-6 18H36Z", "#EFAFA0", K) +
      l(
        "M38 42q-14 16-8 34M50 42q0 20 0 34M62 42q14 16 8 34",
        'stroke="#86AE78" stroke-width="2.6" stroke-linecap="round"',
      ) +
      leafShape(30, 74, 0.7, 120, C.green) +
      leafShape(70, 74, 0.7, 60, C.mintD) +
      leafShape(50, 76, 0.7, -90, C.green),
  ],
  [
    () =>
      l(
        "M30 84q-4-26 6-34M42 84q-2-30 4-36M56 84q2-26 8-32M68 84q4-20 10-24",
        'stroke="#86AE78" stroke-width="3" stroke-linecap="round"',
      ) +
      l("M50 84q0-10 0-14", 'stroke="#9FC8B0" stroke-width="2.6" stroke-linecap="round"') +
      e(50, 86, 26, 4, "rgba(128,102,93,.10)"),
  ],
  [
    () =>
      l("M42 88V22M58 88V30", 'stroke="#9FC8B0" stroke-width="6" stroke-linecap="round"') +
      l("M42 40h0M42 56h0M42 72h0M58 48h0M58 64h0", 'stroke="#7FA792" stroke-width="2"') +
      leafShape(42, 26, 0.7, -30, C.green) +
      leafShape(58, 36, 0.6, -20, C.greenD) +
      leafShape(42, 44, 0.6, 210, C.mintD),
  ],
  [
    () =>
      p("M34 60h32l-4 26H38Z", C.mint, K) +
      rc(32, 56, 36, 7, 3, C.mintD, K1) +
      [0, 1, 2]
        .map((i) => l(`M${42 + i * 8} 56V${30 - i * 4}`, 'stroke="#86AE78" stroke-width="2"'))
        .join("") +
      [0, 1, 2].map((i) => e(42 + i * 8, 30 - i * 4, 4, 7, C.purple, K1)).join(""),
  ],
  [
    () =>
      l("M12 84q26-8 34-30t40-38", 'stroke="#B08977" stroke-width="3.4" stroke-linecap="round"') +
      flower(34, 62, 8, C.pinkL, C.pinkD, 1) +
      flower(56, 40, 8, C.pink, C.yellow, 1) +
      flower(76, 22, 7, C.pinkL, C.pinkD, 1) +
      flower(62, 62, 6, C.pinkL, C.pinkD, 1),
  ],
  [
    () =>
      p("M26 74q0-40 46-46 6 40-32 48-8 2-14-2Z", C.green, K) +
      l("M30 72q20-22 40-38", 'stroke="#7D9A70" stroke-width="2"'),
  ],
  [
    () =>
      p("M34 62h32l-4 24H38Z", "#F3C6A8", K) +
      rc(32, 58, 36, 6, 3, C.peachD, K1) +
      [0, 1, 2, 3, 4, 5]
        .map((i) =>
          e(
            50 + Math.cos((i / 6) * Math.PI * 2) * 9,
            50 + Math.sin((i / 6) * Math.PI * 2) * 6,
            7,
            5,
            "#A9C9A0",
            K1,
            `transform="rotate(${i * 60} ${50 + Math.cos((i / 6) * Math.PI * 2) * 9} ${50 + Math.sin((i / 6) * Math.PI * 2) * 6})"`,
          ),
        )
        .join("") +
      c(50, 48, 6, "#C4DDCB", K1),
  ],
  [
    () =>
      rc(16, 58, 68, 22, 5, "#E3C39E", K) +
      l("M22 58v22M78 58v22", 'stroke="#D8B58D" stroke-width="2"') +
      flower(30, 44, 8, C.pink, C.yellow, 1) +
      flower(50, 38, 8, C.white, C.yellow, 1) +
      flower(70, 44, 8, C.yellow, C.pinkD, 1) +
      l("M30 52v10M50 46v14M70 52v10", 'stroke="#86AE78" stroke-width="2"'),
  ],
  [
    () =>
      l("M50 90V44", 'stroke="#86AE78" stroke-width="2.6"') +
      leafShape(44, 76, 0.8, 200, C.green) +
      [0, 1, 2, 3, 4, 5, 6, 7]
        .map((i) => {
          const a = (i / 8) * Math.PI * 2;
          return l(
            `M50 34l${(Math.cos(a) * 15).toFixed(1)} ${(Math.sin(a) * 15).toFixed(1)}`,
            'stroke="#D9CFC4" stroke-width="1.8" stroke-linecap="round"',
          );
        })
        .join("") +
      c(50, 34, 5, C.white, K1),
  ],
  [
    () =>
      l("M50 92V56", 'stroke="#86AE78" stroke-width="2.6"') +
      [0, 90, 180, 270]
        .map((a) =>
          e(
            50 + Math.cos((a * Math.PI) / 180) * 11,
            42 + Math.sin((a * Math.PI) / 180) * 11,
            11,
            11,
            C.green,
            K1,
            `transform="rotate(${a} ${50 + Math.cos((a * Math.PI) / 180) * 11} ${42 + Math.sin((a * Math.PI) / 180) * 11})"`,
          ),
        )
        .join("") +
      c(50, 42, 4, C.greenD),
  ],
  [
    () =>
      p("M32 62h36l-5 24H37Z", "#E7DCCF", K) +
      l("M50 62V26", 'stroke="#86AE78" stroke-width="2.6"') +
      [0, 1, 2, 3, 4]
        .map((i) =>
          l(
            `M50 ${56 - i * 7}q${-8 - i * 2} -3 ${-12 - i * 3} 2`,
            'stroke="#9FC8B0" stroke-width="2.4" stroke-linecap="round"',
          ),
        )
        .join("") +
      [0, 1, 2, 3, 4]
        .map((i) =>
          l(
            `M50 ${56 - i * 7}q${8 + i * 2} -3 ${12 + i * 3} 2`,
            'stroke="#9FC8B0" stroke-width="2.4" stroke-linecap="round"',
          ),
        )
        .join(""),
  ],
  [
    () =>
      p("M26 66h48l-6 20H32Z", "#E3C39E", K) +
      rc(24, 62, 52, 7, 3, "#D8B58D", K) +
      l("M50 62V46", 'stroke="#B08977" stroke-width="4" stroke-linecap="round"') +
      c(42, 40, 12, C.mint, K) +
      c(60, 36, 10, C.green, K) +
      c(52, 30, 8, C.mintD, K),
  ],
  [
    () =>
      e(50, 62, 26, 22, "#F0B37E", K) +
      e(50, 62, 12, 22, "none", 'stroke="#D9945C" stroke-width="2"') +
      e(38, 62, 8, 20, "none", 'stroke="#D9945C" stroke-width="2"') +
      e(62, 62, 8, 20, "none", 'stroke="#D9945C" stroke-width="2"') +
      l("M50 40q2-12 10-12", 'stroke="#86AE78" stroke-width="3" stroke-linecap="round"') +
      heart(50, 64, 1.3, "#F7D8B8"),
  ],
  [
    () =>
      c(50, 50, 28, "none", 'stroke="#C4DDCB" stroke-width="6"') +
      flower(50, 22, 8, C.pink, C.yellow, 1) +
      flower(74, 50, 8, C.white, C.yellow, 1) +
      flower(50, 78, 8, C.pinkL, C.pinkD, 1) +
      flower(26, 50, 8, C.white, C.yellow, 1) +
      leafShape(32, 26, 0.6, -140, C.green) +
      leafShape(68, 26, 0.6, -40, C.mintD),
  ],
].map((d, i) => ({ id: "plant" + (i + 1), cat: "plant", inner: d[0]() }));

/* ---------------- Food, decorations, nature and everyday things ---------------- */
const FOOD = [
  [
    () =>
      p("M20 58h60v20q0 8-8 8H28q-8 0-8-8Z", "#FBE7D6", K) +
      p("M20 58q30-8 60 0v8q-30 6-60 0Z", "#FFF6EC", K1) +
      rc(24, 74, 52, 5, 2, "#F6C9B3", "") +
      e(50, 40, 14, 10, "#F6C9B3", K) +
      p("M50 26q8 4 6 12-6 4-12 0-2-8 6-12Z", C.red, K) +
      l("M44 32l3 2M56 32l-3 2", 'stroke="#D2737F" stroke-width="1.6"') +
      p("M50 26q3-6 8-4-2 4-8 4Z", C.green, K1),
  ],
  [
    () =>
      p("M26 66l24-34 24 34Z", "#FBE7D6", K) +
      p("M32 66l18-26 18 26Z", "#F6C9B3", K1) +
      l("M40 52h20", 'stroke="#FFF6EC" stroke-width="5"') +
      p("M50 36q6 3 5 9-5 3-10 0-1-6 5-9Z", C.red, K) +
      e(50, 68, 26, 5, "rgba(128,102,93,.12)"),
  ],
  [
    () =>
      c(50, 50, 26, "#F3D3A8", K) +
      p(
        "M50 24c-14 0-26 12-26 26s12 26 26 26 26-12 26-26-12-26-26-26Zm0 16c5.5 0 10 4.5 10 10s-4.5 10-10 10-10-4.5-10-10 4.5-10 10-10Z",
        "#F5B8C5",
        K,
      ) +
      c(50, 50, 10, "#FFF7EE", K1) +
      [
        [34, 38],
        [66, 38],
        [38, 64],
        [62, 64],
        [50, 28],
      ]
        .map(([x, y]) =>
          l(`M${x} ${y}l2 4`, 'stroke="#FFF3D8" stroke-width="2.6" stroke-linecap="round"'),
        )
        .join(""),
  ],
  [
    () =>
      p("M32 30h36l-4 50q0 6-6 6H42q-6 0-6-6Z", "#F3E0C9", K) +
      rc(30, 24, 40, 8, 4, "#E7CBB0", K) +
      l("M46 24l4-16M54 24l-4-16", 'stroke="#B08977" stroke-width="3.4" stroke-linecap="round"') +
      [38, 46, 54, 62].map((x) => c(x, 78, 3, "#8C6A5C")).join("") +
      e(50, 56, 15, 4, "#EAD3BC", 'opacity=".8"'),
  ],
  [
    () =>
      rc(26, 36, 44, 42, 10, C.paper, K) +
      e(48, 36, 22, 6, "#C8A379", K1) +
      l(
        "M70 44q14 2 12 12t-14 8",
        'stroke="#BE8F86" stroke-width="3" fill="none" stroke-linecap="round"',
      ) +
      l(
        "M40 28q5-8 0-14M52 28q5-8 0-14",
        'stroke="#C9AFA0" stroke-width="2.6" stroke-linecap="round"',
      ) +
      heart(48, 54, 0.9, "#E7CBB0"),
  ],
  [
    () =>
      p("M20 56q-4-22 12-24 8-2 12 6h12q4-8 12-6 16 2 12 24-18 14-40 14T20 56Z", "#F0C98A", K) +
      l(
        "M34 48q16-8 32 0M40 58q10-4 20 0",
        'stroke="#D9A765" stroke-width="2" stroke-linecap="round"',
      ),
  ],
  [
    () =>
      p("M24 56q-8-14 4-20-2-14 22-14t22 14q12 6 4 20v22q-26 8-52 0Z", "#F0C98A", K) +
      p("M30 56q-6-10 4-14-2-10 16-10t16 10q10 4 4 14v18q-20 5-40 0Z", "#FFF0D2", "") +
      c(44, 54, 1.8, "#E3BE83"),
  ],
  [
    () =>
      p("M34 52h32L50 92Z", "#F0C98A", K) +
      l("M38 60l24 22M44 52l14 40M56 52l-24 30", 'stroke="#D9A765" stroke-width="1.6"') +
      c(50, 44, 12, C.pinkL, K) +
      c(50, 30, 10, C.white, K) +
      c(50, 18, 7, C.pinkL, K) +
      c(52, 12, 3, C.red, K1),
  ],
  [
    () =>
      p("M30 54h40l-6 32H36Z", "#FBE3E8", K) +
      rc(28, 48, 44, 8, 4, C.paper, K) +
      c(40, 40, 11, C.white, K) +
      c(60, 40, 11, C.pinkL, K) +
      c(50, 30, 9, C.yellowL, K) +
      c(58, 22, 3.4, C.red, K1) +
      l("M58 22q6-6 10-2", 'stroke="#86AE78" stroke-width="2"'),
  ],
  [
    () =>
      e(50, 42, 26, 12, C.pink, K) +
      e(50, 58, 26, 12, C.pink, K) +
      rc(26, 48, 48, 6, 3, "#FFF3D8", K1) +
      e(50, 42, 26, 8, "#FBD3DC", ""),
  ],
  [
    () =>
      p("M22 62h56l-4-16H26Z", "#F6DCAE", K) +
      p("M24 46l8-16h36l8 16Z", "#F0C98A", K) +
      p("M26 50h48v8H26Z", "#E9C7A4", K1) +
      p("M28 54q10-8 20 0t22 0v6H28Z", "#A9C79A", K1) +
      c(50, 38, 3, "#E98C9D"),
  ],
  [
    () =>
      p("M22 26l56 12-40 44Z", "#F6DCAE", K) +
      p("M28 32l44 10-32 34Z", "#F0C98A", "") +
      c(44, 44, 4, "#E98C9D") +
      c(56, 52, 3.4, "#E98C9D") +
      c(38, 52, 3, "#A9C79A") +
      c(50, 62, 3, "#F8C86A") +
      [36, 54, 66]
        .map((x, i) => l(`M${x} ${30 + i * 7}l-2 4`, 'stroke="#D9A765" stroke-width="1.6"'))
        .join(""),
  ],
  [
    () =>
      p("M26 74q0-44 48-44l-48 60Z", "#8FBF86", K) +
      p("M30 72q2-38 42-38L30 80Z", "#F2A6B6", "") +
      p("M34 70q4-32 34-32L34 76Z", "#F8C3CE", "") +
      [
        [46, 56],
        [54, 48],
        [40, 62],
      ]
        .map(([x, y]) => e(x, y, 2, 3, INK))
        .join(""),
  ],
  [
    () =>
      p("M50 90C32 78 24 62 30 50q6-10 20-10t20 10c6 12-2 28-20 40Z", "#EE8E9C", K) +
      p("M34 46q4-10 16-10t16 10q-16-6-32 0Z", "#F09A9A", "") +
      [
        [40, 56],
        [52, 54],
        [60, 62],
        [46, 68],
        [50, 76],
        [36, 66],
      ]
        .map(([x, y]) => e(x, y, 1.5, 2.2, "#FFF3D8"))
        .join("") +
      p("M50 38q-8-10 0-16 8 6 0 16Z", C.green, K1) +
      p("M32 44q-10-6-8-14 8 2 8 14Z", C.green, K1),
  ],
  [
    () =>
      p("M28 44h44l-6 38H34Z", "#F6DCAE", K) +
      e(50, 44, 22, 7, "#E7CBB0", K) +
      p("M40 40q3-12 14-10 10 2 8 10Z", "#B08977", K1) +
      e(50, 84, 20, 5, "rgba(128,102,93,.12)") +
      c(42, 54, 2, "#FFF3D8"),
  ],
  [
    () =>
      c(36, 40, 10, "#F0C98A", K) +
      c(64, 40, 10, "#F0C98A", K) +
      c(50, 58, 20, "#F0C98A", K) +
      c(43, 52, 2.4, "#8C6A5C") +
      c(57, 52, 2.4, "#8C6A5C") +
      e(50, 62, 4, 3, "#C9899A") +
      c(36, 40, 4, "#D9A765") +
      c(64, 40, 4, "#D9A765"),
  ],
  [
    () =>
      rc(22, 46, 56, 34, 8, "#FFF6EC", K) +
      rc(22, 40, 56, 12, 6, "#F2A6B6", K) +
      c(50, 66, 9, "#A9C79A", K1) +
      l("M42 66h16", 'stroke="#86AE78" stroke-width="2"') +
      l("M30 34h40", 'stroke="#3E5A4A" stroke-width="3" stroke-linecap="round"'),
  ],
  [
    () =>
      rc(18, 40, 64, 42, 8, "#E9A9A0", K) +
      l("M18 58h64", 'stroke="#D68F86" stroke-width="2"') +
      c(32, 50, 7, "#FFF6EC", K1) +
      c(48, 50, 7, "#FFF6EC", K1) +
      c(64, 50, 7, "#A9C79A", K1) +
      c(32, 70, 7, "#F8C86A", K1) +
      c(50, 70, 7, "#E98C9D", K1) +
      rc(58, 64, 18, 12, 4, "#F6DCAE", K1),
  ],
  [
    () =>
      c(50, 52, 28, "#FBE7D6", K) +
      c(50, 52, 22, "#F6DCAE", K1) +
      e(50, 52, 18, 12, "#F0C98A") +
      l("M36 46q14 6 28 0M38 56q14-6 26 2", 'stroke="#E3BE83" stroke-width="2"') +
      c(44, 48, 5, C.white, K1) +
      c(60, 54, 4, "#F7D8B8", K1) +
      l("M60 34l14-16M66 36l14-14", 'stroke="#B08977" stroke-width="2.6" stroke-linecap="round"'),
  ],
  [
    () =>
      e(50, 62, 26, 10, "#F0C98A", K) +
      p("M24 62l6 22q20 6 40 0l6-22Z", "#E3B77E", K) +
      e(50, 60, 19, 7, "#F8D98F", K1) +
      e(50, 60, 12, 4, "#E9A150", 'opacity=".5"') +
      l("M30 66l4 16M70 66l-4 16", 'stroke="#C99A62" stroke-width="1.6"'),
  ],
  [
    () =>
      e(50, 74, 26, 9, "#F0C98A", K) +
      e(50, 64, 26, 9, "#F0C98A", K) +
      e(50, 54, 26, 9, "#F0C98A", K) +
      e(50, 46, 18, 6, "#F7D8B8", K1) +
      p("M42 44q8-8 16 0Z", "#FFF3D8") +
      c(50, 38, 4, C.red, K1) +
      rc(34, 58, 10, 5, 2, "#F8C86A"),
  ],
  [
    () =>
      p("M34 46h32l-3 38q0 4-5 4H42q-5 0-5-4Z", "#F8D98F", K) +
      e(50, 46, 16, 5, "#E9C77E", K1) +
      rc(40, 38, 20, 8, 3, "#E3B77E", K) +
      p("M44 30q3-6 6-3 3-3 6 3-6 4-12 0Z", "#F7D8B8", K1) +
      heart(50, 66, 0.9, "#E3B77E"),
  ],
  [
    () =>
      p("M24 50l-8-10v20Z", "#F5B8C5", K) +
      p("M76 50l8-10v20Z", "#F5B8C5", K) +
      c(50, 50, 20, C.yellowL, K) +
      l("M40 42q10 8 0 16M60 42q-10 8 0 16", 'stroke="#F3C6A8" stroke-width="2"') +
      c(50, 50, 5, C.pink),
  ],
  [
    () =>
      l("M50 92V56", 'stroke="#E0C7A8" stroke-width="5" stroke-linecap="round"') +
      c(50, 40, 24, C.pinkL, K) +
      p(
        "M50 40a12 12 0 0 1 12 12 8 8 0 0 1-8 8 5 5 0 0 1-5-5",
        "none",
        'stroke="#F09CB0" stroke-width="4" stroke-linecap="round"',
      ) +
      heart(66, 26, 0.8, C.pink, K1),
  ],
  [
    () =>
      rc(22, 34, 56, 44, 6, "#8C6A5C", K) +
      l("M22 48h56M22 62h56M36 34v44M50 34v44M64 34v44", 'stroke="#6B4F45" stroke-width="2"') +
      rc(24, 36, 10, 10, 2, "#A5796A") +
      rc(52, 64, 10, 10, 2, "#A5796A"),
  ],
  [
    () =>
      c(38, 58, 16, "#FFF6EC", K) +
      c(62, 58, 16, "#FFF6EC", K) +
      c(50, 46, 16, C.pinkL, K) +
      e(32, 54, 4, 2.6, C.blush, 'opacity=".7"') +
      e(44, 42, 4, 2.6, C.blush, 'opacity=".7"') +
      l("M44 50q3 3 6 0", 'stroke="#C9899A" stroke-width="1.8"'),
  ],
  [
    () =>
      p("M30 52h40l-6 32q-14 5-28 0Z", "#F5B8C5", K) +
      l("M36 52l4 34M50 52v34M64 52l-4 34", 'stroke="#EDA3B4" stroke-width="2"') +
      p("M28 50q-2-14 10-14 2-10 12-10t12 10q12 0 10 14-22 6-44 0Z", "#FFF6EC", K) +
      c(50, 22, 4, C.red, K1),
  ],
  [
    () =>
      p(
        "M50 44q-22-26-32-10t10 22q-14 6-4 18t26-14q16 22 26 14t-4-18q20-6 10-22T50 44Z",
        "#F0C98A",
        K,
      ) + l("M32 54q10 6 18-10M68 54q-10 6-18-10", 'stroke="#D9A765" stroke-width="2"'),
  ],
  [
    () =>
      l(
        "M40 56q4-30 10-40M62 60q-2-26-6-40",
        'stroke="#86AE78" stroke-width="2.6" stroke-linecap="round"',
      ) +
      c(38, 68, 12, "#E98C9D", K) +
      c(64, 70, 11, "#E98C9D", K) +
      c(34, 64, 3.4, "#fff", 'opacity=".55"') +
      l("M50 16q6-6 12-4", 'stroke="#86AE78" stroke-width="2.6" stroke-linecap="round"'),
  ],
  [
    () =>
      p("M34 34h32l-6 46q0 6-6 6h-8q-6 0-6-6Z", "#F8D98F", K, 'opacity=".95"') +
      e(50, 34, 16, 5, "#E9C77E", K1) +
      rc(46, 18, 6, 18, 3, C.pink, K1) +
      e(44, 44, 10, 3, C.peach) +
      p("M50 34c8 0 12 10 10 20-6 6-14 6-20 0-2-10 2-20 10-20Z", "#F7C6A8", 'opacity=".6"') +
      c(44, 60, 3, C.white, K1),
  ],
].map((d, i) => ({ id: "food" + (i + 1), cat: "food", inner: d[0]() }));

const DECOR = [
  [
    () =>
      heart(50, 50, 3, "#F5A9BC", K) +
      p(
        "M40 40q4-4 8-2",
        "none",
        'stroke="#fff" stroke-width="3" opacity=".6" stroke-linecap="round"',
      ),
  ],
  [() => heart(40, 48, 2.2, "#F5A9BC", K) + heart(62, 58, 1.6, "#F3C6A8", K)],
  [() => star(50, 50, 32, C.yellow, K) + star(50, 50, 14, "#FFF1C4")],
  [
    () =>
      star(34, 34, 10, C.yellow, K1) +
      star(66, 44, 7, "#F8C86A", K1) +
      star(46, 68, 5.4, C.yellow, K1) +
      c(64, 70, 2.4, "#F8C86A"),
  ],
  [
    () =>
      p("M50 20c14 0 24 12 24 24S62 68 50 68 26 56 26 44s10-24 24-24Z", C.pink, K) +
      p("M50 68l4 6h-8Z", C.pinkD, K1) +
      l("M50 74q6 8-2 14t2 12", 'stroke="#C0AFA4" stroke-width="2" stroke-linecap="round"') +
      p(
        "M36 34q4-6 10-6",
        "none",
        'stroke="#fff" stroke-width="3.4" opacity=".7" stroke-linecap="round"',
      ),
  ],
  [
    () =>
      p("M30 16c8 0 14 8 14 15s-7 15-14 15-14-7-14-15 6-15 14-15Z", C.sky, K) +
      p("M66 12c8 0 14 8 14 15s-7 15-14 15-14-7-14-15 6-15 14-15Z", C.pinkL, K) +
      p("M48 34c7 0 12 7 12 13s-6 13-12 13-12-6-12-13 5-13 12-13Z", C.yellow, K) +
      l(
        "M30 50q8 20 18 34M66 46q-6 22-18 38M48 62q2 20 0 24",
        'stroke="#C0AFA4" stroke-width="1.8" stroke-linecap="round"',
      ),
  ],
  [
    () =>
      p("M50 48C38 32 18 30 18 44s20 14 32 4Z", C.pink, K) +
      p("M50 48c12-16 32-18 32-4s-20 14-32 4Z", C.pink, K) +
      c(50, 48, 8, C.pinkD, K) +
      p("M48 54l-6 18 8-4 4 6 4-20Z", C.pink, K1),
  ],
  [
    () =>
      p("M20 36h60v28H20Z", "#FBE3E8", K, 'opacity=".9"') +
      l("M20 40h60M20 60h60", 'stroke="#F5B8C5" stroke-width="1.6"') +
      [
        [30, 46],
        [42, 56],
        [54, 46],
        [66, 56],
      ]
        .map(([x, y]) => heart(x, y, 0.5, "#F5A9BC"))
        .join("") +
      p("M20 36l6 4-6 4ZM80 36l-6 4 6 4Z", "#FFF6EC"),
  ],
  [
    () =>
      p("M26 22h48v44l-8 12H26Z", C.yellowL, K) +
      p("M66 66h8l-8 12Z", "#F6E5AC", K1) +
      l("M34 36h30M34 46h30M34 56h20", 'stroke="#E0CB93" stroke-width="2" stroke-linecap="round"') +
      p("M28 24h10v8l-5-3-5 3Z", "#F5B8C5"),
  ],
  [
    () =>
      rc(18, 34, 64, 42, 6, "#FFF6EC", K) +
      p(
        "M18 38l32 24 32-24",
        "none",
        'stroke="#E2CEBD" stroke-width="2.4" stroke-linejoin="round"',
      ) +
      heart(50, 58, 0.9, "#F5A9BC", K1),
  ],
  [
    () =>
      rc(22, 24, 56, 54, 6, "#E7CDB4", K) +
      rc(29, 31, 42, 40, 3, "#FFF6EC", K1) +
      c(42, 44, 7, C.yellow) +
      p("M32 66l12-12 10 10 8-6 8 8Z", C.mintD),
  ],
  [
    () =>
      p("M24 30h34q6 0 6 6v38H30q-6 0-6-6Z", C.sky, K) +
      p("M64 30h6v44H30", "none", 'stroke="#BE8F86" stroke-width="2.4"') +
      l("M34 42h20M34 52h14", 'stroke="#9EC6E0" stroke-width="2.4" stroke-linecap="round"') +
      p("M58 66l8-4v-32l-8 4Z", "#FBE3E8", K1),
  ],
  [
    () =>
      rc(18, 66, 64, 12, 3, C.pink, K) +
      rc(22, 54, 56, 11, 3, C.sky, K) +
      rc(26, 42, 48, 11, 3, C.yellow, K) +
      l(
        "M30 72h20M34 60h24M38 48h18",
        'stroke="#fff" stroke-width="3" opacity=".6" stroke-linecap="round"',
      ),
  ],
  [
    () =>
      l("M12 40q38 22 76 0", 'stroke="#C8A379" stroke-width="2" stroke-linecap="round"') +
      [0, 1, 2, 3, 4]
        .map((i) => {
          const t = 0.16 + i * 0.17,
            x = 12 + t * 76,
            y = 40 + Math.sin(Math.PI * t) * 25;
          return (
            c(x, y + 8, 6, ["#F8C86A", "#F5B8C5", "#C4DDCB", "#C7DFF0", "#F3C6A8"][i], K1) +
            l(`M${x} ${y} v4`, 'stroke="#C8A379" stroke-width="1.6"')
          );
        })
        .join(""),
  ],
  [
    () =>
      rc(28, 22, 44, 56, 5, C.white, K) +
      rc(33, 27, 34, 32, 2, "#EAF2EC", K1) +
      flower(44, 40, 6, C.pink, C.yellow, 1) +
      flower(56, 48, 5, C.white, C.yellow, 1) +
      l("M34 66h32", 'stroke="#E6DCD2" stroke-width="3" stroke-linecap="round"'),
  ],
  [
    () =>
      l("M50 12v14", 'stroke="#C0AFA4" stroke-width="2"') +
      rc(20, 26, 60, 46, 5, "#E7CDB4", K) +
      rc(26, 32, 48, 34, 3, "#FBE3E8", K1) +
      c(40, 44, 7, C.yellow) +
      p("M30 62l14-14 12 12 8-8 10 10Z", C.mintD) +
      p("M66 22l4 8h-8Z", "#C0AFA4"),
  ],
  [
    () =>
      c(50, 54, 26, C.pinkL, K) +
      c(50, 54, 20, C.paper, K1) +
      l("M50 54V40M50 54l9 6", 'stroke="#BE8F86" stroke-width="2.6" stroke-linecap="round"') +
      c(50, 54, 2.4, C.pinkD) +
      c(34, 32, 6, C.pink, K) +
      c(66, 32, 6, C.pink, K) +
      rc(44, 86, 6, 6, 2, C.brown, K1) +
      rc(52, 86, 6, 6, 2, C.brown, K1),
  ],
  [
    () =>
      c(34, 42, 14, C.yellow, K) +
      c(34, 42, 6, "#FFF6EC", K1) +
      l(
        "M46 52l24 26M64 70l6-6M70 76l6-6",
        'stroke="#BE8F86" stroke-width="4" stroke-linecap="round"',
      ),
  ],
  [
    () =>
      p("M20 46q16-10 30 4 14-14 30-4 8 6-2 12-12 6-28-4-16 10-28 4-10-6-2-12Z", C.pink, K) +
      c(50, 50, 4, C.pinkD, K1) +
      l("M30 50q20-4 40 0", 'stroke="#FBD3DC" stroke-width="2"'),
  ],
  [
    () =>
      c(50, 34, 14, C.pink, K) + p("M46 48h8l-2 34h-4Z", "#C0AFA4", K1) + c(46, 30, 4, "#FBD3DC"),
  ],
  [
    () =>
      l(
        "M38 30v40q0 12 12 12t12-12V34q0-8-8-8t-8 8v34q0 5 4 5t4-5V38",
        'stroke="#B9C6CE" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"',
      ),
  ],
  [
    () =>
      rc(24, 30, 52, 50, 2, "#FFF6EC", K, 'stroke-dasharray="4 3"') +
      rc(32, 38, 36, 24, 2, "#DCEBF5", K1) +
      flower(50, 50, 6, C.pink, C.yellow, 1) +
      l("M34 68h32", 'stroke="#E2CEBD" stroke-width="2"'),
  ],
  [
    () =>
      p("M22 30h56v34q-6 10-14 12H22Z", C.pinkL, K) +
      l(
        "M32 42h34M32 52h34M32 62h20",
        'stroke="#E7A3B4" stroke-width="2.4" stroke-linecap="round"',
      ) +
      heart(66, 40, 0.8, C.pink),
  ],
  [
    () =>
      l("M10 34q40 16 80 0", 'stroke="#C8A379" stroke-width="2"') +
      [0, 1, 2, 3, 4]
        .map((i) => {
          const x = 18 + i * 16,
            y = 36 + Math.sin((Math.PI * (x - 10)) / 80) * 8;
          return p(`M${x} ${y}l10 2-5 12Z`, [C.pink, C.yellow, C.mint, C.sky, C.peach][i], K1);
        })
        .join(""),
  ],
  [
    () =>
      rc(40, 44, 20, 40, 6, "#FFF6EC", K) +
      l("M40 56h20", 'stroke="#F5B8C5" stroke-width="4"') +
      l("M50 44V36", 'stroke="#BE8F86" stroke-width="2"') +
      p("M50 22q8 8 0 14-8-6 0-14Z", "#F8C86A", K1) +
      e(50, 88, 16, 4, "rgba(128,102,93,.1)"),
  ],
  [
    () =>
      c(50, 50, 26, "rgba(220,235,245,.72)", K) +
      c(50, 66, 16, "#DCEBF5", K1) +
      stemPine() +
      [0, 1, 2, 3].map((i) => c(34 + i * 10, 34 + (i % 2) * 14, 2.2, C.white)).join("") +
      rc(38, 76, 24, 8, 4, "#E7CDB4", K),
  ],
  [
    () =>
      p("M32 22h34q6 0 6 6v30q0 6-6 6H44l-12 12V64q-6 0-6-6V28q0-6 6-6Z", C.mint, K) +
      flower(46, 42, 8, C.white, C.yellow, 1) +
      l("M56 52q6 0 10 4", 'stroke="#9FC8B0" stroke-width="2"'),
  ],
  [
    () =>
      rc(22, 24, 56, 52, 4, "#FFF6EC", K) +
      l("M30 36h40M30 46h40M30 56h26", 'stroke="#E9DACB" stroke-width="2" stroke-linecap="round"') +
      heart(64, 66, 0.9, "#F5A9BC", K1),
  ],
  [
    () =>
      rc(24, 22, 52, 58, 5, "#FFF6EC", K) +
      rc(30, 28, 40, 34, 3, "#F7EDE2", K1) +
      flower(44, 40, 8, C.pinkL, C.yellow, 1) +
      leafShape(58, 52, 0.7, -30, C.green) +
      l("M50 66h16", 'stroke="#E2CEBD" stroke-width="2"'),
  ],
  [
    () =>
      l("M50 12v8", 'stroke="#B08977" stroke-width="2"') +
      rc(40, 20, 20, 6, 2, C.yellowD, K1) +
      c(50, 48, 20, "#F5A9BC", K) +
      l("M32 48h36M35 36h30M35 60h30", 'stroke="#E58FA3" stroke-width="2"') +
      rc(42, 66, 16, 6, 2, C.yellowD, K1) +
      l("M50 72v10M46 82h8", 'stroke="#C0AFA4" stroke-width="2" stroke-linecap="round"'),
  ],
].map((d, i) => ({ id: "deco" + (i + 1), cat: "deco", inner: d[0]() }));

const NATURE = [
  [() => cloud(50, 48, 1.25, C.white, K) + cloud(58, 40, 0.7, "#F4FAFD", "")],
  [() => cloud(34, 40, 0.9, C.white, K) + cloud(64, 60, 0.75, C.paper, K)],
  [
    () =>
      c(50, 50, 22, "#F8D98F", K) +
      l(
        "M50 14v10M50 76v10M14 50h10M76 50h10M25 25l7 7M68 68l7 7M75 25l-7 7M32 68l-7 7",
        'stroke="#F0C86A" stroke-width="3.4" stroke-linecap="round"',
      ) +
      c(43, 46, 2.4, INK) +
      c(57, 46, 2.4, INK) +
      l("M45 56q5 4 10 0", 'stroke="#BE8F86" stroke-width="2" stroke-linecap="round"'),
  ],
  [
    () =>
      p("M62 20a32 32 0 1 0 0 60 26 26 0 0 1 0-60Z", "#F8E4A8", K) +
      star(70, 34, 4, "#F8C86A", K1) +
      star(78, 52, 3, "#F8C86A"),
  ],
  [
    () =>
      [
        [30, 30, 6],
        [62, 26, 4],
        [50, 54, 7],
        [72, 62, 4],
        [30, 68, 4],
        [58, 78, 3],
      ]
        .map(([x, y, r]) => star(x, y, r, "#F8D98F", K1))
        .join(""),
  ],
  [
    () =>
      ["#F5A9BC", "#F3C6A8", "#F6E5AC", "#C4DDCB", "#C7DFF0"]
        .map((col, i) =>
          p(
            `M${12 + i * 7} 78a${38 - i * 7} ${38 - i * 7} 0 0 1 ${76 - i * 14} 0`,
            "none",
            `stroke="${col}" stroke-width="7"`,
          ),
        )
        .join("") +
      c(14, 78, 6, C.white, K1) +
      c(86, 78, 6, C.white, K1),
  ],
  [
    () =>
      p("M48 50C34 30 18 34 20 46c2 10 16 10 28 4Z", C.pinkL, K) +
      p("M52 50c14-20 30-16 28-4-2 10-16 10-28 4Z", C.pinkL, K) +
      p("M48 54C36 72 22 70 24 60c2-8 14-8 24-6Z", C.pink, K) +
      p("M52 54c12 18 26 16 24 6-2-8-14-8-24-6Z", C.pink, K) +
      e(50, 52, 3.4, 14, "#8C6A5C", K1) +
      l(
        "M50 38q-4-8-10-8M50 38q4-8 10-8",
        'stroke="#8C6A5C" stroke-width="2" stroke-linecap="round"',
      ),
  ],
  [
    () =>
      p("M48 52C30 34 18 44 24 54c5 8 16 4 24-2Z", C.sky, K) +
      p("M52 52c18-18 30-8 24 2-5 8-16 4-24-2Z", C.sky, K) +
      e(50, 52, 3, 13, "#A08E9A", K1) +
      l(
        "M50 40q-5-7-9-6M50 40q5-7 9-6",
        'stroke="#A08E9A" stroke-width="2" stroke-linecap="round"',
      ) +
      c(36, 48, 4, "#E3F0F8"),
  ],
  [
    () =>
      e(50, 52, 22, 18, C.sky, K) +
      c(64, 38, 12, C.sky, K) +
      p("M76 38l10 4-10 5Z", "#F3C6A8", K1) +
      c(66, 36, 2.2, INK) +
      p("M40 46q-16 6-10 16 10 2 16-8Z", "#9EC6E0", K) +
      p("M54 70q6 10 12 2", "none", 'stroke="#9EC6E0" stroke-width="2"'),
  ],
  [
    () =>
      e(50, 54, 24, 17, C.yellow, K) +
      l("M40 42v24M50 40v28M60 42v24", 'stroke="#8C6A5C" stroke-width="5"') +
      c(72, 46, 2, INK) +
      p("M46 38c4-14 20-14 22 0Z", C.sky, 'opacity=".7"') +
      p("M54 38c0-12 10-14 12-6", "none", 'stroke="#9EC6E0" stroke-width="2"') +
      p("M50 32l0-8", "none", 'stroke="#8C6A5C" stroke-width="2"') +
      c(50, 22, 2, "#8C6A5C"),
  ],
  [
    () =>
      [0, 60, 120]
        .map((a) =>
          l(
            `M50 20v60M18 50h64`,
            `stroke="#C7DFF0" stroke-width="4" stroke-linecap="round" transform="rotate(${a} 50 50)"`,
          ),
        )
        .join("") +
      [0, 60, 120]
        .map((a) =>
          l(
            `M50 26l-7 7M50 26l7 7M50 74l-7-7M50 74l7-7`,
            `stroke="#C7DFF0" stroke-width="3" stroke-linecap="round" transform="rotate(${a} 50 50)"`,
          ),
        )
        .join(""),
  ],
  [
    () =>
      p(
        "M50 18l8 16 14-6-6 14 16 8-16 8 6 14-14-6-8 16-8-16-14 6 6-14-16-8 16-8-6-14 14 6Z",
        "#E9A97E",
        K,
      ) + l("M50 60v22", 'stroke="#B08977" stroke-width="2.6" stroke-linecap="round"'),
  ],
  [() => leafShape(40, 62, 1.4, -38, C.green) + leafShape(62, 48, 1, -20, C.mintD)],
  [
    () =>
      [0, 1, 2, 3]
        .map((i) =>
          e(
            38 + i * 9,
            40 + (i % 2) * 16,
            6,
            9,
            i % 2 ? C.pink : C.pinkL,
            K1,
            `transform="rotate(${i * 40 - 30} ${38 + i * 9} ${40 + (i % 2) * 16})"`,
          ),
        )
        .join("") + flower(66, 66, 8, C.pink, C.yellow, 1),
  ],
  [
    () =>
      c(50, 50, 5, "#FFF3C9", K1) +
      p("M50 58c-8-4-8-14 0-16 8 2 8 12 0 16Z", C.yellow, K1) +
      c(50, 34, 14, "rgba(248,217,143,.45)") +
      c(50, 34, 22, "rgba(248,217,143,.22)") +
      c(50, 50, 4, "#FFF3C9"),
  ],
  [
    () =>
      [
        [36, 36, 7],
        [58, 30, 5],
        [66, 52, 8],
        [42, 62, 5],
        [54, 74, 4],
        [28, 52, 3.4],
      ]
        .map(([x, y, r]) => star(x, y, r, "#F8D98F", K1))
        .join(""),
  ],
  [
    () =>
      c(40, 34, 14, C.white, K1) +
      c(58, 30, 10, C.white, K1) +
      c(64, 42, 8, C.white, K1) +
      [24, 40, 56, 72]
        .map((x, i) =>
          l(
            `M${x} ${56 + (i % 2) * 8}l-5 12`,
            'stroke="#9EC6E0" stroke-width="3.4" stroke-linecap="round"',
          ),
        )
        .join(""),
  ],
  [
    () =>
      l(
        "M24 40h32q10 0 10-10t-10-10q-6 0-8 5",
        'stroke="#B9D3E4" stroke-width="3.6" stroke-linecap="round"',
      ) +
      l(
        "M20 56h46q9 0 9 9t-9 9q-6 0-8-4",
        'stroke="#B9D3E4" stroke-width="3.6" stroke-linecap="round"',
      ) +
      l("M30 72h10", 'stroke="#B9D3E4" stroke-width="3.6" stroke-linecap="round"'),
  ],
  [
    () =>
      p("M74 24C50 26 30 46 26 76c20-2 40-22 48-52Z", "#FFF6EC", K) +
      l("M28 74q18-30 44-48", 'stroke="#D8C4B6" stroke-width="2" stroke-linecap="round"') +
      [0, 1, 2, 3]
        .map((i) =>
          l(
            `M${46 + i * 6} ${60 - i * 8}l${8 - i * 2} ${-2 - i * 2}`,
            'stroke="#D8C4B6" stroke-width="1.6"',
          ),
        )
        .join(""),
  ],
  [
    () =>
      p("M50 76C30 66 22 46 34 36c8-8 22-8 32 0 12 10 4 30-16 40Z", "#FBE3E8", K) +
      l(
        "M50 76L38 36M50 76l12-40M50 76V34",
        'stroke="#EDB9C6" stroke-width="2" stroke-linecap="round"',
      ),
  ],
  [
    () =>
      e(38, 66, 16, 12, C.gray, K) + e(62, 72, 12, 9, "#E9DFD8", K) + e(60, 54, 9, 7, "#CFC3BA", K),
  ],
  [
    () =>
      p("M10 56q10-14 20 0t20 0 20 0 20 0v22H10Z", "#CFE4F2", K) +
      l(
        "M12 48q10-12 20 0t20 0 20 0 20 0",
        'stroke="#9EC6E0" stroke-width="3" stroke-linecap="round"',
      ) +
      c(30, 70, 3, C.white) +
      c(58, 72, 2.4, C.white),
  ],
  [
    () =>
      p("M40 86q-8-2-8-10h36q0 8-8 10Z", "#C8A379", K) +
      l("M50 76V48", 'stroke="#86AE78" stroke-width="2.6"') +
      p("M50 60q-16-2-16-16 14-2 16 10Z", C.green, K) +
      p("M50 52q16-4 16-18-14-2-16 10Z", C.mintD, K),
  ],
  [
    () =>
      l("M50 32v10", 'stroke="#C0AFA4" stroke-width="1.6"') +
      [0, 60, 120, 180, 240, 300]
        .map((a) =>
          l(
            `M50 32l${Math.cos((a * Math.PI) / 180) * 14} ${Math.sin((a * Math.PI) / 180) * 14}`,
            'stroke="#D9CFC4" stroke-width="1.8"',
          ),
        )
        .join("") +
      l("M50 42q-4 16 4 30", 'stroke="#C0AFA4" stroke-width="1.6"') +
      c(50, 30, 2.6, C.white, K1),
  ],
  [
    () =>
      c(50, 50, 26, "#CFC1E8", K) +
      e(
        50,
        50,
        38,
        9,
        "none",
        'stroke="#F3C6A8" stroke-width="3.4" transform="rotate(-18 50 50)"',
      ) +
      c(40, 42, 6, "#E0D6F0") +
      c(60, 58, 4, "#E0D6F0") +
      c(56, 34, 3, "#E0D6F0"),
  ],
  [
    () =>
      l(
        "M14 26l18 8M10 40l22 4M20 52l16-6",
        'stroke="#F8D98F" stroke-width="3" stroke-linecap="round"',
      ) +
      star(66, 36, 15, "#F8E4A8", K1) +
      c(66, 36, 4, C.white) +
      c(82, 62, 2.4, "#F8D98F") +
      c(30, 66, 2, "#F8D98F"),
  ],
].map((d, i) => ({ id: "nat" + (i + 1), cat: "nat", inner: d[0]() }));

const LIFE = [
  [
    () =>
      rc(34, 18, 32, 64, 8, "#A08E9A", K) +
      rc(38, 24, 24, 48, 3, "#DCEBF5") +
      c(50, 77, 2.4, "#C9C2CC") +
      p("M42 40h12v6H42Z", C.pink) +
      p("M42 52h16v3H42Z", "#B9D3E4") +
      p("M42 60h12v3H42Z", "#B9D3E4"),
  ],
  [
    () =>
      l(
        "M22 52V44a28 28 0 0 1 56 0v8",
        'stroke="#B39AA2" stroke-width="5" stroke-linecap="round"',
      ) +
      rc(14, 46, 16, 26, 7, C.pink, K) +
      rc(70, 46, 16, 26, 7, C.pink, K) +
      rc(18, 52, 8, 14, 4, "#EDA3B4") +
      rc(74, 52, 8, 14, 4, "#EDA3B4"),
  ],
  [
    () =>
      rc(18, 36, 64, 42, 8, "#A08E9A", K) +
      rc(38, 28, 24, 10, 4, "#A08E9A", K1) +
      c(50, 58, 15, "#C7DFF0", K1) +
      c(50, 58, 9, "#9EC6E0") +
      c(36, 44, 3, C.yellow) +
      c(66, 44, 2.6, C.pink),
  ],
  [
    () =>
      p("M26 46h48l4 34q-28 8-56 0Z", "#F3C6A8", K) +
      l(
        "M36 46q0-18 14-18t14 18",
        'stroke="#BE8F86" stroke-width="3" fill="none" stroke-linecap="round"',
      ) +
      c(50, 62, 4, C.yellow, K1) +
      l("M26 56h48", 'stroke="#E7AC86" stroke-width="2"'),
  ],
  [
    () =>
      p("M16 54q10-26 34-26t34 26q-18-8-34 0-16-8-34 0Z", C.pink, K) +
      l("M50 28v44q0 10 9 8", 'stroke="#BE8F86" stroke-width="2.8" stroke-linecap="round"') +
      c(50, 22, 2.6, C.brown, K1),
  ],
  [
    () =>
      rc(40, 44, 20, 40, 4, C.pink, K) +
      rc(44, 52, 12, 8, 2, "#FBD3DC", K1) +
      p("M42 44V24q8-6 16 0v20Z", "#E97F92", K),
  ],
  [
    () =>
      rc(36, 44, 28, 36, 6, "#FBE3E8", K) +
      rc(44, 30, 12, 14, 3, "#E7CDB4", K) +
      rc(46, 24, 8, 8, 2, C.pink, K1) +
      heart(50, 60, 0.8, C.pink, K1) +
      c(42, 52, 2, "#fff", 'opacity=".7"'),
  ],
  [
    () =>
      c(34, 52, 16, "rgba(220,235,245,.6)", K) +
      c(66, 52, 16, "rgba(220,235,245,.6)", K) +
      l(
        "M50 50h0M48 50h4M18 48l-6-4M82 48l6-4",
        'stroke="#BE8F86" stroke-width="3" stroke-linecap="round"',
      ),
  ],
  [
    () =>
      p("M30 74q-10 0-10-12t10-18h8q8 6 8 18t-16 12Z", C.pinkL, K) +
      p("M30 44h4q4 8-2 14-6-6-2-14Z", C.pink, K1) +
      e(40, 58, 4, 3, "#FBD3DC") +
      e(38, 68, 4, 3, "#FBD3DC"),
  ],
  [
    () =>
      c(34, 36, 10, "#E2BE9E", K) +
      c(66, 36, 10, "#E2BE9E", K) +
      c(50, 56, 24, "#E9CBAE", K) +
      c(42, 52, 2.6, INK) +
      c(58, 52, 2.6, INK) +
      e(50, 62, 6, 4.6, "#F6DCC4", K1) +
      e(50, 63, 2.4, 2, "#8C6A5C") +
      c(34, 36, 4.4, "#F6DCC4") +
      c(66, 36, 4.4, "#F6DCC4"),
  ],
  [
    () =>
      rc(28, 34, 40, 44, 10, C.paper, K) +
      l(
        "M68 44q14 2 12 12t-14 8",
        'stroke="#BE8F86" stroke-width="3" fill="none" stroke-linecap="round"',
      ) +
      heart(48, 56, 1.1, "#F5A9BC", K1) +
      l(
        "M38 28q4-6 0-10M52 28q4-6 0-10",
        'stroke="#C9AFA0" stroke-width="2.4" stroke-linecap="round"',
      ),
  ],
  [
    () =>
      rc(26, 22, 48, 58, 5, "#FBE3E8", K) +
      l("M36 22v58", 'stroke="#E7A3B4" stroke-width="3"') +
      [0, 1, 2, 3, 4, 5].map((i) => c(36, 30 + i * 9, 2.4, "#FFF6EC", K1)).join("") +
      l("M46 40h20M46 52h20", 'stroke="#E7A3B4" stroke-width="2" stroke-linecap="round"'),
  ],
  [
    () =>
      p("M30 74l6-14 30-30 8 8-30 30Z", C.sky, K) +
      p("M58 26l8 8 8-8-8-8Z", "#9EC6E0", K1) +
      p("M30 74l-4 8 8-4Z", "#BE8F86", K1) +
      l("M44 52l8 8", 'stroke="#9EC6E0" stroke-width="2"'),
  ],
  [
    () =>
      c(50, 46, 24, C.pinkL, K) +
      c(50, 46, 18, "#E6F2FA", K1) +
      p(
        "M36 56q10-16 26-18",
        "none",
        'stroke="#fff" stroke-width="3" opacity=".8" stroke-linecap="round"',
      ) +
      rc(46, 70, 8, 14, 3, C.pink, K1),
  ],
  [
    () =>
      c(50, 50, 22, "none", 'stroke="#F5B8C5" stroke-width="9"') +
      c(50, 50, 22, "none", 'stroke="#FBD3DC" stroke-width="9" stroke-dasharray="8 8"') +
      p("M62 66l10 12-8 2-6-10Z", C.pink, K1),
  ],
  [
    () =>
      rc(20, 38, 60, 38, 8, "#E7CDB4", K) +
      l("M20 50h60", 'stroke="#C8A379" stroke-width="2"') +
      c(66, 56, 4, C.yellow, K1) +
      heart(40, 44, 0.8, "#C8A379"),
  ],
  [
    () =>
      l(
        "M50 26a10 10 0 1 1 0 20 10 10 0 0 1 0-20Z",
        'stroke="#C0AFA4" stroke-width="3" fill="none"',
      ) +
      c(50, 66, 14, C.pink, K) +
      flower(50, 66, 6, "none", C.yellow, 1) +
      l("M50 46v6", 'stroke="#BE8F86" stroke-width="2.4"'),
  ],
  [
    () =>
      p("M30 46h30q6 0 6 8v18q0 8-8 8H36q-8 0-8-8V54q0-8 2-8Z", C.mintD, K) +
      l("M30 52q-10 4-12 14", 'stroke="#BE8F86" stroke-width="3" stroke-linecap="round"') +
      l("M66 52q12-2 12 8t-12 10", 'stroke="#BE8F86" stroke-width="3" stroke-linecap="round"') +
      l("M44 46q0-10 8-10t8 10", 'stroke="#BE8F86" stroke-width="3" fill="none"'),
  ],
  [
    () =>
      p("M24 50h52l-4 30q-22 7-44 0Z", "#E3C39E", K) +
      l("M24 58h52", 'stroke="#C8A379" stroke-width="2"') +
      l(
        "M34 50q0-16 16-16t16 16",
        'stroke="#C8A379" stroke-width="3" fill="none" stroke-linecap="round"',
      ) +
      flower(50, 68, 7, C.pink, C.yellow, 1),
  ],
  [
    () =>
      c(50, 34, 16, "#E9CBAE", K) +
      c(38, 22, 6, "#E9CBAE", K) +
      c(62, 22, 6, "#E9CBAE", K) +
      c(44, 32, 2.2, INK) +
      c(56, 32, 2.2, INK) +
      e(50, 40, 5, 3.6, "#F6DCC4", K1) +
      e(42, 37, 3.4, 2.4, C.blush, 'opacity=".6"') +
      p("M34 56h32q6 0 6 8v20q-22 6-44 0V64q0-8 6-8Z", C.pink, K) +
      c(50, 66, 4, C.pinkD),
  ],
  [
    () =>
      p("M28 44q22-14 44 0 6 6-2 10-20-8-40 0-8-4-2-10Z", C.pink, K1) +
      flower(50, 44, 8, C.white, C.yellow, 1) +
      l("M30 60q20-6 40 0", 'stroke="#C0AFA4" stroke-width="2.4"'),
  ],
  [
    () =>
      l(
        "M40 22h20v14H40ZM40 64h20v14H40Z",
        'stroke="#F3C6A8" stroke-width="6" stroke-linecap="round"',
      ) +
      c(50, 50, 17, C.paper, K) +
      l("M50 50V40M50 50l7 5", 'stroke="#BE8F86" stroke-width="2.4" stroke-linecap="round"') +
      c(50, 50, 2, C.pinkD),
  ],
  [
    () =>
      c(50, 58, 18, "none", 'stroke="#E3C36A" stroke-width="5"') +
      heart(50, 34, 1.1, "#F5B8C5", K1) +
      c(50, 58, 18, "none", 'stroke="#F8E4A8" stroke-width="2"'),
  ],
  [
    () =>
      p("M38 20h24v34q0 10 10 12t8 12q-2 8-12 6-20-4-30-16V20Z", "#FBE3E8", K) +
      l("M38 28h24M38 36h24", 'stroke="#F5B8C5" stroke-width="3"') +
      p("M70 76q6 2 4 8-4 4-8 2", "#F5B8C5", K1),
  ],
  [
    () =>
      p("M26 32h20v44q-10 4-20 0Z", "#F3C6A8", K) +
      p("M46 32h26q6 0 6 6v10q0 6-6 6H46Z", "#F3C6A8", K) +
      l("M26 40h20M26 48h20M46 38h32M46 44h32", 'stroke="#E7AC86" stroke-width="2"') +
      l("M30 78v8M38 78v8M46 78v8", 'stroke="#E7AC86" stroke-width="3" stroke-linecap="round"'),
  ],
  [
    () =>
      p("M18 44h64l-4 16q-6 10-16 6l-6-10H44l-6 10q-10 4-16-6Z", "#A08E9A", K) +
      p("M22 48h22l-3 10q-6 6-12 2Z", "rgba(199,223,240,.8)") +
      p("M56 48h22l-3 10q-6 6-12 2Z", "rgba(199,223,240,.8)") +
      l("M50 48h0", 'stroke="#A08E9A" stroke-width="3"'),
  ],
  [
    () =>
      rc(24, 42, 52, 40, 6, "#F7EDE2", K) +
      l(
        "M36 42q0-16 14-16t14 16",
        'stroke="#BE8F86" stroke-width="3" fill="none" stroke-linecap="round"',
      ) +
      flower(50, 62, 9, C.mintD, C.yellow, 1),
  ],
  [
    () =>
      p("M36 22h20v34q0 6 8 10 10 6 6 14-12 4-26-2-8-4-8-12Z", "#F6E5AC", K) +
      l("M36 30h20", 'stroke="#E4CE8E" stroke-width="3"') +
      e(50, 84, 16, 4, "rgba(128,102,93,.12)") +
      l("M40 40v10M52 40v10", 'stroke="#E4CE8E" stroke-width="2"'),
  ],
].map((d, i) => ({ id: "life" + (i + 1), cat: "life", inner: d[0]() }));

/* ---------------- The registry ---------------- */
function stemPine() {
  return l(
    "M50 66V52M50 58l-8-6M50 58l8-6",
    'stroke="#9FC8B0" stroke-width="2" stroke-linecap="round"',
  );
}

/* Category ids in tray order; their names are cat.<id> in i18n.js. */
const CATS = ["pig", "furn", "plant", "food", "deco", "nat", "life"].map((id) => ({ id }));
/* Sticker ids are positional (category + index in its list: pig1, furn12, …) and saved works
   store them. Add a new sticker at the END of its list and never insert or remove one: that
   renumbers the rest, saved works then show other stickers, and a work naming a missing id fails
   to open. Pigs are numbered across PIG_DEFS and then LIMITED (pig33–pig36), so a new pig is
   pushed onto PIGS after LIMITED with the next number. A new sticker also needs its name in
   both dictionaries of i18n.js (stk.<id>, and desc.<id> for a pig). */
const STICKERS = [...PIGS, ...FURN, ...PLANTS, ...FOOD, ...DECOR, ...NATURE, ...LIFE];
const BY_ID = {};
STICKERS.forEach((s) => {
  BY_ID[s.id] = s;
});

/** A placed sticker's drawing: a pig shows the face it was given by a double-click. */
function innerFor(it) {
  const st = BY_ID[it.sid];
  if (!st) return "";
  if (st.cat === "pig" && st.opts)
    return pig(Object.assign({}, st.opts, { eyes: it.face || st.opts.eyes }));
  return st.inner;
}
/** A sticker as a standalone SVG, or a placed one (it) with its own face. */
function stickerSVG(st, extra, it) {
  const inner = it ? innerFor(it) : st.inner;
  return (
    '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">' +
    (extra || "") +
    inner +
    "</svg>"
  );
}
