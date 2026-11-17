// The places a character can be: flat SVG drawings on a 1200x800 field that is cropped to
// whatever shape the stage has. Each is drawn in three lights (day, dusk, night) picked from
// the reader's own clock, so the room's hour is the reader's hour.

export const SCENES = ["postroom", "library", "teahouse", "rooftop", "plain"];

/** The light of an hour of the day (0 to 23). */
export function phaseOf(hour) {
  if (hour >= 7 && hour < 16) return "day";
  if ((hour >= 16 && hour < 19) || (hour >= 5 && hour < 7)) return "dusk";
  return "night";
}

const INK = "#232838";

// A small repeatable random source, so a shelf of books is the same shelf on every draw.
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const SKY = {
  day: { top: "#9fd3f5", low: "#dff2fb", orb: "#fff3b0", star: 0 },
  dusk: { top: "#f2a97c", low: "#fbe0b5", orb: "#ffd9a0", star: 0 },
  night: { top: "#1d2547", low: "#3a4474", orb: "#f4f1dc", star: 1 },
};

function stars(x, y, w, h, n, seed) {
  const r = seeded(seed);
  let out = "";
  for (let i = 0; i < n; i++)
    out += `<circle cx="${(x + r() * w).toFixed(0)}" cy="${(y + r() * h).toFixed(0)}" r="${(1.2 + r() * 1.8).toFixed(1)}" fill="#fff" opacity="${(0.5 + r() * 0.5).toFixed(2)}"/>`;
  return out;
}

/** A lamp's light at night: three soft rings, brightest at the middle. */
function glow(x, y, r, colour) {
  return [1, 0.66, 0.38]
    .map(
      (k, i) =>
        `<circle cx="${x}" cy="${y}" r="${Math.round(r * k)}" fill="${colour}" opacity="${[0.07, 0.09, 0.12][i]}"/>`,
    )
    .join("");
}

/** A puffy cloud whose left end sits at (x, y), `s` times the base size. */
const cloud = (x, y, s, fill, opacity = 1) =>
  `<path transform="translate(${x} ${y}) scale(${s})" d="M0 40 a30 30 0 0 1 22 -46 a42 42 0 0 1 78 -8 a32 32 0 0 1 52 30 a22 22 0 0 1 -4 24 Z" fill="${fill}" opacity="${opacity}"/>`;

function postroom(phase) {
  const sky = SKY[phase];
  const wall = { day: "#f6e7cd", dusk: "#efcfa8", night: "#474462" }[phase];
  const wood = { day: "#b98058", dusk: "#a56d4b", night: "#5a4350" }[phase];
  const woodDark = { day: "#8d5c3d", dusk: "#7c4f37", night: "#3f2f3b" }[phase];
  const paper = { day: "#fffaf0", dusk: "#ffeed6", night: "#c9c6dc" }[phase];
  const sea = { day: "#5aa9d6", dusk: "#c9806a", night: "#27356b" }[phase];
  const ice = { day: "#ffffff", dusk: "#ffe9d6", night: "#aab6e0" }[phase];
  const r = seeded(7);
  let cells = "";
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 4; col++) {
      const x = 790 + col * 86;
      const y = 150 + row * 110;
      cells += `<rect x="${x}" y="${y}" width="78" height="100" rx="6" fill="${woodDark}"/>`;
      const letters = Math.floor(r() * 4);
      for (let i = 0; i < letters; i++) {
        const lx = x + 8 + i * 16;
        const tilt = (r() * 14 - 7).toFixed(1);
        cells += `<g transform="rotate(${tilt} ${lx + 14} ${y + 70})"><rect x="${lx}" y="${y + 42}" width="34" height="50" rx="3" fill="${paper}" stroke="${INK}" stroke-width="2"/><path d="M${lx} ${y + 44} l17 16 l17 -16" fill="none" stroke="${INK}" stroke-width="2"/></g>`;
      }
    }
  let snow = "";
  const sr = seeded(21);
  for (let i = 0; i < 26; i++)
    snow += `<circle cx="${(170 + sr() * 320).toFixed(0)}" cy="${(140 + sr() * 300).toFixed(0)}" r="${(2 + sr() * 3).toFixed(1)}" fill="#fff" opacity=".85"/>`;
  return `
    <rect width="1200" height="800" fill="${wall}"/>
    <path d="M0 560 h1200" stroke="${woodDark}" stroke-width="10" opacity=".35"/>
    <clipPath id="sc-port"><circle cx="330" cy="290" r="170"/></clipPath>
    <g clip-path="url(#sc-port)">
      <rect x="160" y="120" width="340" height="200" fill="${sky.top}"/>
      <rect x="160" y="250" width="340" height="90" fill="${sky.low}"/>
      ${sky.star ? stars(160, 120, 340, 150, 22, 5) : ""}
      <circle cx="420" cy="196" r="26" fill="${sky.orb}"/>
      <rect x="160" y="330" width="340" height="140" fill="${sea}"/>
      <path d="M190 336 l52 -78 l34 44 l22 -26 l44 60 Z" fill="${ice}"/>
      <path d="M390 336 l30 -40 l34 40 Z" fill="${ice}" opacity=".9"/>
      <path d="M160 372 q42 -14 84 0 t84 0 t84 0 t84 0" fill="none" stroke="#fff" stroke-width="5" opacity=".5"/>
      ${snow}
    </g>
    <circle cx="330" cy="290" r="170" fill="none" stroke="${wood}" stroke-width="26"/>
    <circle cx="330" cy="290" r="170" fill="none" stroke="${INK}" stroke-width="4" opacity=".5"/>
    <path d="M330 120 v340 M160 290 h340" stroke="${wood}" stroke-width="12"/>
    <rect x="770" y="130" width="372" height="350" rx="14" fill="${wood}" stroke="${INK}" stroke-width="4"/>
    ${cells}
    <path d="M600 0 v96" stroke="${INK}" stroke-width="5"/>
    <path d="M556 150 q44 -80 88 0 Z" fill="#e2553d" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    <circle cx="600" cy="158" r="13" fill="#ffe7a3" stroke="${INK}" stroke-width="3"/>
    ${phase === "day" ? "" : glow(600, 176, 120, "#ffe7a3")}
    <rect x="0" y="640" width="1200" height="160" fill="${wood}"/>
    <rect x="0" y="632" width="1200" height="22" fill="${woodDark}"/>
    <g transform="translate(96 588)"><rect x="0" y="0" width="92" height="56" rx="6" fill="#e2553d" stroke="${INK}" stroke-width="4"/><rect x="18" y="-12" width="56" height="16" rx="6" fill="${INK}"/><path d="M14 30 h64" stroke="${paper}" stroke-width="6" stroke-linecap="round"/></g>
    <g transform="translate(1010 574) rotate(-6)"><rect x="0" y="0" width="110" height="70" rx="5" fill="${paper}" stroke="${INK}" stroke-width="4"/><path d="M0 4 l55 38 l55 -38" fill="none" stroke="${INK}" stroke-width="4"/><rect x="82" y="8" width="20" height="22" fill="#5aa9d6" stroke="${INK}" stroke-width="2"/></g>`;
}

function library(phase) {
  const sky = SKY[phase === "day" ? "dusk" : phase];
  const wall = { day: "#e3d6bf", dusk: "#b9a08f", night: "#2b3048" }[phase];
  const shelf = { day: "#7a5237", dusk: "#6a4633", night: "#3a2c36" }[phase];
  const floor = { day: "#9a7254", dusk: "#84604a", night: "#40323c" }[phase];
  const dim = phase === "night" ? 0.62 : phase === "dusk" ? 0.85 : 1;
  const spines = [
    "#c8553d",
    "#e9b44c",
    "#3c8f8a",
    "#5d6fa3",
    "#8b5e83",
    "#d98e73",
    "#6f9f6a",
    "#efe3c8",
  ];
  const r = seeded(11);
  const stack = (x0, x1) => {
    let out = `<rect x="${x0}" y="40" width="${x1 - x0}" height="660" fill="${shelf}" stroke="${INK}" stroke-width="4"/>`;
    for (let row = 0; row < 6; row++) {
      const y = 56 + row * 108;
      out += `<rect x="${x0 + 10}" y="${y}" width="${x1 - x0 - 20}" height="96" fill="${INK}" opacity=".35"/>`;
      let x = x0 + 14;
      while (x < x1 - 30) {
        const w = 12 + Math.floor(r() * 16);
        const h = 58 + Math.floor(r() * 34);
        const lean = r() < 0.08 ? 9 : 0;
        if (x + w > x1 - 14) break;
        out += `<rect x="${x}" y="${y + 96 - h}" width="${w}" height="${h}" rx="2" fill="${spines[Math.floor(r() * spines.length)]}" opacity="${dim}" transform="rotate(${lean} ${x} ${y + 96})"/>`;
        x += w + 2 + lean;
      }
    }
    return out;
  };
  return `
    <rect width="1200" height="800" fill="${wall}"/>
    <clipPath id="sc-arch"><path d="M470 520 V250 a130 130 0 0 1 260 0 V520 Z"/></clipPath>
    <g clip-path="url(#sc-arch)">
      <rect x="470" y="110" width="260" height="420" fill="${sky.top}"/>
      <rect x="470" y="380" width="260" height="150" fill="${sky.low}"/>
      ${sky.star ? stars(470, 120, 260, 260, 30, 9) : ""}
      <circle cx="652" cy="232" r="34" fill="${sky.orb}"/>
      ${sky.star ? `<circle cx="666" cy="222" r="30" fill="${sky.top}"/>` : ""}
    </g>
    <path d="M470 520 V250 a130 130 0 0 1 260 0 V520 Z" fill="none" stroke="${shelf}" stroke-width="20"/>
    <path d="M600 122 V520 M470 330 H730" stroke="${shelf}" stroke-width="10"/>
    ${stack(0, 340)}
    ${stack(860, 1200)}
    <g opacity="${dim}"><path d="M812 700 L900 90 M884 700 L972 90" stroke="#c9a06a" stroke-width="10" stroke-linecap="round"/><path d="M826 600 h72 M840 500 h72 M854 400 h72 M868 300 h72 M882 200 h72" stroke="#c9a06a" stroke-width="8" stroke-linecap="round"/></g>
    <rect x="0" y="690" width="1200" height="110" fill="${floor}"/>
    <rect x="0" y="684" width="1200" height="14" fill="${INK}" opacity=".3"/>
    <g transform="translate(380 596)"><path d="M0 96 h70" stroke="${INK}" stroke-width="8" stroke-linecap="round"/><path d="M35 96 V30" stroke="${INK}" stroke-width="6"/><path d="M0 34 q35 -56 70 0 Z" fill="#3c8f8a" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/></g>
    ${phase === "day" ? "" : glow(415, 640, 104, "#ffe7a3")}
    <g transform="translate(760 640)"><rect x="0" y="34" width="84" height="18" rx="3" fill="#c8553d" stroke="${INK}" stroke-width="3"/><rect x="8" y="16" width="72" height="18" rx="3" fill="#e9b44c" stroke="${INK}" stroke-width="3"/><rect x="2" y="-2" width="78" height="18" rx="3" fill="#5d6fa3" stroke="${INK}" stroke-width="3"/></g>`;
}

function teahouse(phase) {
  const sky = SKY[phase];
  const far = { day: "#a9cdd8", dusk: "#d79b84", night: "#39446f" }[phase];
  const mid = { day: "#7fb3a6", dusk: "#b0766c", night: "#2c3760" }[phase];
  const near = { day: "#5f9c85", dusk: "#7d5a5a", night: "#212a4a" }[phase];
  const wood = { day: "#a8744e", dusk: "#94634a", night: "#4c3a44" }[phase];
  const woodDark = { day: "#7c5238", dusk: "#6c4636", night: "#352833" }[phase];
  const lantern = (x) =>
    `<path d="M${x} 62 v54" stroke="${INK}" stroke-width="4"/><ellipse cx="${x}" cy="168" rx="40" ry="54" fill="#f6c667" stroke="${INK}" stroke-width="4"/><path d="M${x - 22} 124 q22 -14 44 0 M${x - 22} 212 q22 14 44 0 M${x} 114 v108 M${x - 20} 122 q-10 46 0 92 M${x + 20} 122 q10 46 0 92" fill="none" stroke="${INK}" stroke-width="2.5" opacity=".55"/><path d="M${x} 222 v28" stroke="#d9603f" stroke-width="5" stroke-linecap="round"/>${phase === "day" ? "" : glow(x, 168, 96, "#f6c667")}`;
  const cup = (x) =>
    `<path d="M${x} 640 h54 l-8 40 h-38 Z" fill="#f6fbf7" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/><path d="M${x + 6} 650 h42" stroke="#9fc48a" stroke-width="6" stroke-linecap="round"/>`;
  return `
    <rect width="1200" height="800" fill="${sky.top}"/>
    <rect y="330" width="1200" height="330" fill="${sky.low}"/>
    ${sky.star ? stars(0, 70, 1200, 260, 60, 3) : ""}
    <circle cx="430" cy="176" r="50" fill="${sky.orb}"/>
    <path d="M0 520 L160 330 L300 450 L470 270 L640 460 L800 340 L980 480 L1100 380 L1200 460 V700 H0 Z" fill="${far}"/>
    <path d="M0 520 q150 -26 300 0 t300 0 t300 0 t300 0" fill="none" stroke="#fff" stroke-width="26" opacity=".35"/>
    <path d="M0 600 L140 470 L330 590 L520 430 L720 600 L900 480 L1200 610 V720 H0 Z" fill="${mid}"/>
    <path d="M0 680 L220 560 L440 670 L700 560 L960 680 L1200 590 V760 H0 Z" fill="${near}"/>
    <rect x="0" y="0" width="1200" height="64" fill="${woodDark}"/>
    <rect x="0" y="58" width="1200" height="14" fill="${wood}"/>
    <rect x="70" y="0" width="44" height="800" fill="${wood}" stroke="${INK}" stroke-width="4"/>
    <rect x="1086" y="0" width="44" height="800" fill="${wood}" stroke="${INK}" stroke-width="4"/>
    ${lantern(240)}${lantern(960)}
    <g stroke="${INK}" stroke-width="3" fill="#6f9f6a"><rect x="14" y="120" width="16" height="560" rx="6"/><rect x="38" y="220" width="14" height="460" rx="6"/><path d="M30 200 q46 -22 66 6 q-40 8 -66 -6 Z M52 300 q40 -18 58 8 q-36 6 -58 -8 Z M30 380 q-2 -40 26 -52 q4 34 -26 52 Z"/></g>
    <rect x="0" y="690" width="1200" height="110" fill="${wood}"/>
    <rect x="0" y="682" width="1200" height="18" fill="${woodDark}"/>
    ${cup(170)}${cup(980)}
    <g transform="translate(250 650)"><rect x="0" y="16" width="120" height="16" rx="6" fill="${woodDark}" stroke="${INK}" stroke-width="3"/><circle cx="34" cy="8" r="12" fill="#d98e73" stroke="${INK}" stroke-width="3"/><circle cx="66" cy="8" r="12" fill="#f6fbf7" stroke="${INK}" stroke-width="3"/><circle cx="96" cy="8" r="12" fill="#9fc48a" stroke="${INK}" stroke-width="3"/></g>`;
}

function rooftop(phase) {
  const sky = SKY[phase];
  const far = { day: "#a9c6dd", dusk: "#c98f86", night: "#2a3358" }[phase];
  const near = { day: "#8eaec7", dusk: "#a86f6b", night: "#1f2747" }[phase];
  const lit = { day: "#d8ecf7", dusk: "#f6d7a8", night: "#ffd98a" }[phase];
  const wall = { day: "#ebe1d2", dusk: "#e3c3a9", night: "#4a4763" }[phase];
  const coping = { day: "#d3c6b2", dusk: "#c9a58b", night: "#3a3852" }[phase];
  const floor = { day: "#d2c9bb", dusk: "#c4a792", night: "#36354d" }[phase];
  const metal = { day: "#6b7386", dusk: "#6a5f6e", night: "#8a90a8" }[phase];
  const cloudFill = { day: "#ffffff", dusk: "#ffe2cc", night: "#55608f" }[phase];
  const r = seeded(17);
  // Two rows of buildings across the horizon; windows lit at random, the same ones every draw.
  let city = "";
  for (const [row, base, colour, tall] of [
    [0, 520, far, 150],
    [1, 560, near, 110],
  ]) {
    let x = -20;
    while (x < 1220) {
      const w = 70 + Math.floor(r() * 90);
      const h = 50 + Math.floor(r() * tall);
      city += `<rect x="${x}" y="${base - h}" width="${w}" height="${h + 20}" fill="${colour}"/>`;
      for (let wy = base - h + 16; wy < base - 12; wy += 26)
        for (let wx = x + 12; wx < x + w - 16; wx += 22)
          if (r() < (phase === "night" ? 0.42 : 0.3))
            city += `<rect x="${wx}" y="${wy}" width="10" height="12" rx="1.5" fill="${lit}" opacity="${row === 0 ? 0.7 : 0.9}"/>`;
      x += w + 6;
    }
  }
  const orb =
    phase === "day"
      ? `<circle cx="930" cy="150" r="46" fill="${sky.orb}"/>`
      : phase === "dusk"
        ? `<circle cx="960" cy="360" r="58" fill="${sky.orb}"/>`
        : `<circle cx="930" cy="140" r="38" fill="${sky.orb}"/><circle cx="946" cy="128" r="34" fill="${sky.top}"/>`;
  // Fairy lights from the mast to the right edge, glowing after dark.
  let bulbs = "";
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const bx = 186 + t * 1040;
    const by = 196 + Math.sin(t * Math.PI) * 70 + 8;
    const colour = ["#ffd166", "#ff9b3d", "#8fd3f4", "#f29a8c"][i % 4];
    bulbs += `${phase === "day" ? "" : glow(bx.toFixed(0), by.toFixed(0), 34, colour)}<circle cx="${bx.toFixed(0)}" cy="${by.toFixed(0)}" r="9" fill="${colour}" stroke="${INK}" stroke-width="3"/>`;
  }
  const cup = (cx, cy) =>
    `<path d="M${cx - 12} ${cy} a12 12 0 0 0 24 0 Z" fill="${metal}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>`;
  return `
    <rect width="1200" height="800" fill="${sky.top}"/>
    <rect y="300" width="1200" height="300" fill="${sky.low}"/>
    ${sky.star ? stars(0, 30, 1200, 330, 70, 13) : ""}
    ${orb}
    ${cloud(150, 120, 1.3, cloudFill, phase === "night" ? 0.55 : 0.95)}
    ${cloud(640, 70, 0.9, cloudFill, phase === "night" ? 0.45 : 0.9)}
    ${cloud(1010, 250, 1.05, cloudFill, phase === "night" ? 0.4 : 0.85)}
    ${city}
    <path d="M186 204 Q706 ${204 + 140} 1226 204" fill="none" stroke="${INK}" stroke-width="3" opacity=".7"/>
    ${bulbs}
    <rect x="0" y="560" width="1200" height="84" fill="${wall}"/>
    <rect x="0" y="548" width="1200" height="20" rx="4" fill="${coping}" stroke="${INK}" stroke-width="4"/>
    <rect x="0" y="640" width="1200" height="160" fill="${floor}"/>
    <path d="M0 640 h1200" stroke="${INK}" stroke-width="4" opacity=".35"/>
    <path d="M174 640 V210" stroke="${INK}" stroke-width="12" stroke-linecap="round"/>
    <path d="M174 640 V210" stroke="${metal}" stroke-width="6" stroke-linecap="round"/>
    <g transform="translate(174 214)">
      <path d="M-70 0 H58 M58 0 l-20 -14 M58 0 l-20 14" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M-70 0 l-18 -20 h26 l10 20 l-10 20 h-26 Z" fill="#ff9b3d" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
      <circle r="9" fill="#ffd166" stroke="${INK}" stroke-width="4"/>
    </g>
    <g transform="translate(174 316)">
      <path d="M-46 0 H46 M0 -12 V12" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
      ${cup(-46, 0)}${cup(46, 0)}
      <circle r="7" fill="${metal}" stroke="${INK}" stroke-width="3"/>
    </g>
    <g transform="translate(300 486)"><rect x="0" y="0" width="38" height="64" rx="6" fill="#dfeaf2" stroke="${INK}" stroke-width="4"/><path d="M6 22 h26 M6 34 h18 M6 46 h26" stroke="${INK}" stroke-width="3" opacity=".5"/><rect x="-6" y="-8" width="50" height="12" rx="4" fill="${metal}" stroke="${INK}" stroke-width="4"/></g>
    <g transform="translate(380 494)"><path d="M0 56 L8 14 H52 L60 56 Z" fill="#d98e73" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/><path d="M30 14 C30 -10 10 -24 -6 -26 C2 -8 14 4 30 14 Z M30 14 C30 -14 48 -30 66 -30 C60 -10 46 4 30 14 Z" fill="#7fb069" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/></g>
    <g transform="translate(860 500)"><path d="M0 50 L6 12 H46 L52 50 Z" fill="#8fd3f4" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/><circle cx="16" cy="0" r="12" fill="#ffd166" stroke="${INK}" stroke-width="3"/><circle cx="36" cy="-6" r="12" fill="#f29a8c" stroke="${INK}" stroke-width="3"/><path d="M16 12 V2 M36 12 V6" stroke="${INK}" stroke-width="3"/></g>
    <g transform="translate(1010 590)">
      <path d="M40 30 L6 170 M40 30 L74 170 M40 30 V170" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>
      <g transform="rotate(-28 40 30)"><rect x="-30" y="12" width="120" height="34" rx="12" fill="#5b6b8c" stroke="${INK}" stroke-width="4"/><rect x="82" y="8" width="22" height="42" rx="6" fill="#ffd166" stroke="${INK}" stroke-width="4"/><rect x="-44" y="20" width="18" height="18" rx="4" fill="${metal}" stroke="${INK}" stroke-width="3"/></g>
    </g>`;
}

function plain(phase) {
  const wall = { day: "#eaf1f7", dusk: "#f4e3d3", night: "#2b3147" }[phase];
  const spot = { day: "#ffffff", dusk: "#fff4e6", night: "#3b4363" }[phase];
  const floor = { day: "#d5dfe9", dusk: "#e3cdb9", night: "#232839" }[phase];
  return `
    <rect width="1200" height="800" fill="${wall}"/>
    <circle cx="600" cy="400" r="330" fill="${spot}"/>
    <rect y="660" width="1200" height="140" fill="${floor}"/>`;
}

const DRAW = { postroom, library, teahouse, rooftop, plain };

/** The scene as SVG markup, filling its box and cropped to it. */
export function scene(name, phase) {
  const draw = DRAW[name] ?? plain;
  const light = ["day", "dusk", "night"].includes(phase) ? phase : "day";
  return `<svg class="scene" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" data-scene="${DRAW[name] ? name : "plain"}" data-phase="${light}" aria-hidden="true" focusable="false">${draw(light)}</svg>`;
}
