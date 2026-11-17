/* Piggy Sticker World: the scene backgrounds, twelve scenes and a blank canvas, drawn at load in
   the 900 x 900 stage. Their names are scene.<id> in i18n.js. A classic script with no DOM
   access, loaded after art.js. */
let _sid = 0;
function sceneSVG(w1, w2, f1, f2, extra, horizon) {
  horizon = horizon || 640;
  const id = "sc" + ++_sid;
  return `<svg viewBox="0 0 900 900" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="${id}w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${w1}"/><stop offset="1" stop-color="${w2}"/></linearGradient>
    <linearGradient id="${id}f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${f1}"/><stop offset="1" stop-color="${f2}"/></linearGradient>
  </defs>
  <rect width="900" height="900" fill="url(#${id}w)"/>
  <rect y="${horizon}" width="900" height="${900 - horizon}" fill="url(#${id}f)"/>
  <rect y="${horizon - 12}" width="900" height="16" fill="rgba(255,255,255,.6)"/>
  ${extra || ""}</svg>`;
}
const woodFloor = (y) =>
  Array.from(
    { length: 7 },
    (_, i) =>
      `<path d="M0 ${y + 34 + i * 38}h900" stroke="rgba(176,137,119,.18)" stroke-width="2"/>` +
      `<path d="M${(i % 2 ? 140 : 420) + i * 60} ${y + i * 38}v38" stroke="rgba(176,137,119,.14)" stroke-width="2"/>`,
  ).join("");
const windowFrame = (x, y, w, h, extra) => `
  <rect x="${x - 14}" y="${y - 14}" width="${w + 28}" height="${h + 28}" rx="16" fill="#FFFDF8" opacity=".92"/>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="rgba(199,223,240,.85)"/>
  <rect x="${x + w / 2 - 4}" y="${y}" width="8" height="${h}" fill="#FFFDF8" opacity=".9"/>
  <rect x="${x}" y="${y + h / 2 - 4}" width="${w}" height="8" fill="#FFFDF8" opacity=".9"/>
  ${extra || ""}`;

const SCENES = [
  {
    id: "blank",
    svg: sceneSVG(
      "#FFFDF8",
      "#FFF6EC",
      "#FFF6EC",
      "#FFF0E2",
      `<g opacity=".5">${Array.from({ length: 13 }, (_, i) =>
        Array.from(
          { length: 13 },
          (_, j) => `<circle cx="${80 + i * 64}" cy="${80 + j * 64}" r="1.8" fill="#E8D9CD"/>`,
        ).join(""),
      ).join("")}</g>`,
      900,
    ),
  },
  {
    id: "pinkroom",
    svg: sceneSVG(
      "#FCE7EC",
      "#F8D6DE",
      "#F2DCCF",
      "#EBD1C0",
      windowFrame(
        600,
        90,
        230,
        250,
        `<path d="M600 340q40-60 80 0t80 0" fill="rgba(199,223,240,.7)"/>`,
      ) +
        `<ellipse cx="330" cy="800" rx="230" ry="90" fill="rgba(255,244,238,.75)"/>
       <ellipse cx="330" cy="800" rx="160" ry="58" fill="none" stroke="rgba(245,184,197,.55)" stroke-width="4" stroke-dasharray="14 12"/>
       <rect x="60" y="60" width="120" height="8" rx="4" fill="rgba(245,184,197,.5)"/>` +
        woodFloor(640),
    ),
  },
  {
    id: "creamroom",
    svg: sceneSVG(
      "#FFF6EA",
      "#FBE8D6",
      "#EFDCC6",
      "#E4CBB1",
      windowFrame(
        90,
        110,
        300,
        260,
        `<circle cx="250" cy="200" r="60" fill="rgba(246,229,172,.6)"/>`,
      ) +
        `<rect x="560" y="90" width="200" height="150" rx="10" fill="rgba(255,253,248,.6)"/>
       <circle cx="620" cy="150" r="26" fill="rgba(245,184,197,.35)"/>
       <ellipse cx="480" cy="790" rx="260" ry="95" fill="rgba(255,246,232,.8)"/>` +
        woodFloor(640),
    ),
  },
  {
    id: "garden",
    svg: sceneSVG(
      "#DCF0FB",
      "#EAF8EE",
      "#C7E4C0",
      "#A8CE9E",
      `<circle cx="740" cy="130" r="70" fill="rgba(246,229,172,.9)"/>
       ${[0, 1, 2]
         .map(
           (i) => `<g transform="translate(${90 + i * 210},${520 + (i % 2) * 30})">
          <path d="M0 90q-40-30-20-60 30-30 60 0 20 30-20 60Z" fill="rgba(201,224,192,.9)"/>
          <circle cx="10" cy="60" r="9" fill="rgba(238,142,156,.7)"/><circle cx="32" cy="66" r="8" fill="rgba(238,142,156,.7)"/>
        </g>`,
         )
         .join("")}
       <path d="M0 560q120-40 240 0t240 0 240 0 180 0v80H0Z" fill="rgba(196,221,203,.7)"/>
       <circle cx="200" cy="200" r="46" fill="rgba(255,255,255,.85)"/><circle cx="246" cy="190" r="34" fill="rgba(255,255,255,.85)"/>`,
      600,
    ),
  },
  {
    id: "beach",
    svg: sceneSVG(
      "#D6EDFB",
      "#EEF8FD",
      "#F7E4C4",
      "#F0D7AE",
      `<circle cx="180" cy="140" r="64" fill="rgba(248,217,143,.85)"/>
       <path d="M0 520h900v60H0Z" fill="rgba(190,220,238,.9)"/>
       <path d="M0 520q60-18 120 0t120 0 120 0 120 0 120 0 120 0 180 0" fill="none" stroke="rgba(255,255,255,.9)" stroke-width="8"/>
       <circle cx="640" cy="220" r="40" fill="rgba(255,255,255,.7)"/><circle cx="690" cy="212" r="30" fill="rgba(255,255,255,.7)"/>
       <path d="M700 470q10-60 40-70 4 40-20 70Z" fill="rgba(196,221,203,.8)"/>
       <ellipse cx="300" cy="760" rx="240" ry="60" fill="rgba(255,247,232,.6)"/>`,
      560,
    ),
  },
  {
    id: "forest",
    svg: sceneSVG(
      "#DCEBDE",
      "#EDF5E6",
      "#CBE0BE",
      "#A9C99A",
      `${[0, 1, 2, 3, 4]
        .map(
          (i) => `<g transform="translate(${-40 + i * 210},${300 + (i % 2) * 40})">
        <rect x="86" y="120" width="16" height="80" fill="rgba(176,137,119,.85)"/>
        <path d="M94 0L176 140H12Z" fill="rgba(140,180,128,.85)"/>
        <path d="M94 40L160 150H28Z" fill="rgba(160,196,146,.9)"/></g>`,
        )
        .join("")}
       <path d="M300 800q80-90 220-90t200 90Z" fill="rgba(243,198,168,.75)"/>
       <path d="M420 800l60-70 60 70Z" fill="rgba(255,246,236,.8)"/>`,
      600,
    ),
  },
  {
    id: "cafe",
    svg: sceneSVG(
      "#FBEDE6",
      "#F8DED2",
      "#EAD7C7",
      "#DCC2AC",
      `${[0, 1, 2]
        .map(
          (i) => `<g transform="translate(${220 + i * 240},90)">
        <path d="M0 0v40" stroke="rgba(176,137,119,.6)" stroke-width="4"/>
        <path d="M-34 40h68l-14 30h-40Z" fill="rgba(246,229,172,.9)"/>
        <circle cx="0" cy="86" r="10" fill="rgba(255,250,230,.95)"/></g>`,
        )
        .join("")}
       <rect x="120" y="470" width="660" height="26" rx="10" fill="rgba(255,253,248,.75)"/>
       <rect x="150" y="496" width="16" height="150" fill="rgba(231,205,180,.8)"/>
       <rect x="734" y="496" width="16" height="150" fill="rgba(231,205,180,.8)"/>
       <path d="M0 300h900v10H0Z" fill="rgba(245,184,197,.35)"/>` + woodFloor(660),
    ),
  },
  {
    id: "flowershop",
    svg: sceneSVG(
      "#E8F4EC",
      "#D8EDE0",
      "#E9DCC9",
      "#DBC9B2",
      `<rect x="90" y="120" width="720" height="14" rx="6" fill="rgba(200,163,121,.55)"/>
       <rect x="90" y="300" width="720" height="14" rx="6" fill="rgba(200,163,121,.55)"/>
       ${[0, 1, 2, 3, 4, 5, 6, 7]
         .map(
           (i) => `<g transform="translate(${140 + i * 90},${250})">
          <path d="M-18 50h36l-6 44H-12Z" fill="rgba(239,175,160,.7)"/>
          <circle cx="0" cy="20" r="16" fill="rgba(${i % 2 ? "245,184,197" : "252,237,228"},.9)"/>
          <circle cx="0" cy="20" r="6" fill="rgba(246,229,172,.95)"/></g>`,
         )
         .join("")}
       <ellipse cx="450" cy="800" rx="280" ry="80" fill="rgba(255,250,242,.5)"/>` + woodFloor(680),
    ),
  },
  {
    id: "bath",
    svg: sceneSVG(
      "#E4F1F7",
      "#D3E8F1",
      "#EAF1F3",
      "#DCE7EA",
      `${Array.from({ length: 8 }, (_, i) => `<path d="M${i * 120} 0v420M0 ${i * 60}h900" stroke="rgba(255,255,255,.55)" stroke-width="3"/>`).join("")}
       <rect x="0" y="420" width="900" height="16" fill="rgba(255,255,255,.6)"/>
       <circle cx="760" cy="180" r="50" fill="rgba(255,255,255,.5)"/>
       <path d="M120 640h240v90q0 40-40 40H160q-40 0-40-40Z" fill="rgba(255,255,255,.55)"/>
       <circle cx="300" cy="740" r="6" fill="rgba(159,200,219,.8)"/>`,
      620,
    ),
  },
  {
    id: "balcony",
    svg: sceneSVG(
      "#D8EDFB",
      "#F0F8FD",
      "#E7DAC8",
      "#D7C4AC",
      `<path d="M0 380h900v34H0Z" fill="rgba(255,255,255,.55)"/>
       ${Array.from({ length: 22 }, (_, i) => `<path d="M${i * 42} 414v210" stroke="rgba(255,253,248,.85)" stroke-width="8"/>`).join("")}
       <path d="M0 414h900v14H0Z" fill="rgba(255,253,248,.95)"/>
       <path d="M0 624h900v14H0Z" fill="rgba(255,253,248,.95)"/>
       <circle cx="740" cy="120" r="64" fill="rgba(248,217,143,.8)"/>
       <circle cx="180" cy="180" r="44" fill="rgba(255,255,255,.8)"/>`,
      700,
    ),
  },
  {
    id: "kitchen",
    svg: sceneSVG(
      "#FFF6E8",
      "#FBE9D2",
      "#EADBC8",
      "#DAC5AE",
      `${Array.from({ length: 9 }, (_, i) => `<path d="M0 ${i * 52}h520M${i * 65} 0v470" stroke="rgba(255,255,255,.6)" stroke-width="3"/>`).join("")}
       <rect x="0" y="470" width="900" height="26" rx="8" fill="rgba(255,253,248,.85)"/>
       <rect x="60" y="496" width="780" height="180" rx="8" fill="rgba(247,226,204,.85)"/>
       ${[0, 1, 2, 3].map((i) => `<rect x="${110 + i * 190}" y="540" width="150" height="8" rx="4" fill="rgba(255,253,248,.7)"/>`).join("")}
       <rect x="620" y="200" width="200" height="14" rx="6" fill="rgba(200,163,121,.5)"/>` +
        woodFloor(676),
    ),
  },
  {
    id: "xmas",
    svg: sceneSVG(
      "#F3DCDC",
      "#E9C9C9",
      "#E3D3C0",
      "#D2BEA6",
      `<rect x="120" y="120" width="300" height="200" rx="14" fill="rgba(255,253,248,.7)"/>
       <path d="M120 220h300M270 120v200" stroke="rgba(255,253,248,.9)" stroke-width="8"/>
       <path d="M0 60q150 40 300 0t300 0 300 0" fill="none" stroke="rgba(196,221,203,.9)" stroke-width="6"/>
       ${[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => `<circle cx="${60 + i * 100}" cy="${70 + (i % 2) * 26}" r="9" fill="rgba(${i % 3 === 0 ? "245,184,197" : i % 3 === 1 ? "246,229,172" : "196,221,203"},.95)"/>`).join("")}
       <path d="M560 700q0-120 170-120t170 120Z" fill="rgba(150,190,150,.75)"/>
       <rect x="700" y="700" width="60" height="90" fill="rgba(176,137,119,.7)"/>` + woodFloor(700),
    ),
  },
  {
    id: "starry",
    svg: sceneSVG(
      "#33415C",
      "#4A5B7C",
      "#5C6B63",
      "#44514B",
      `${Array.from({ length: 40 }, (_, i) => `<circle cx="${(i * 137) % 900}" cy="${(i * 89) % 520}" r="${1.5 + (i % 3)}" fill="rgba(255,250,225,${0.4 + (i % 4) * 0.15})"/>`).join("")}
       <circle cx="720" cy="140" r="56" fill="rgba(255,246,222,.92)"/>
       <circle cx="700" cy="130" r="50" fill="rgba(51,65,92,.9)"/>
       <path d="M120 640q60-90 130 0Z" fill="rgba(255,250,235,.18)"/>
       <path d="M0 640q150-60 300 0t300 0 300 0v260H0Z" fill="rgba(96,120,108,.55)"/>`,
      640,
    ),
  },
];
