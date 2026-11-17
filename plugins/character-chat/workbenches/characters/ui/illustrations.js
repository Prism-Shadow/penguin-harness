// Traced on double-size face crops so the rig moves the painted eyes without moving nearby hair.
const ART = {
  sunny: {
    size: [624, 624],
    frame: "45 0 528 624",
    face: "169 38 326 326",
    crop: "225 155",
    lid: "#fcdfce",
    lash: "#432934",
    eyes: [
      {
        outline:
          "M43 107 Q55 106 60 92 L62 82 Q70 82 73 77 Q94 50 129 54 Q153 55 170 82 L164 82 Q175 112 164 138 Q155 158 132 157 Q111 158 94 147 L84 148 L83 140 Q72 131 63 123 Z",
        lash: "M50 109 Q96 115 112 112 Q140 104 166 111",
        center: 111,
      },
      {
        outline:
          "M261 84 Q276 54 303 53 Q336 49 353 68 L364 68 L357 76 L371 80 L363 84 Q369 101 387 102 Q377 113 368 116 Q360 137 344 143 L338 149 Q323 151 311 155 Q285 157 273 139 Q258 117 267 85 Z",
        lash: "M263 110 Q290 103 314 111 Q340 119 379 103",
        center: 111,
      },
    ],
    mouth: [334, 259, 17],
    skin: "#fcdecc",
  },
  pip: {
    size: [623, 624],
    frame: "86 36 439 576",
    face: "121 55 337 337",
    crop: "160 186",
    lid: "#fbeddf",
    lash: "#322e41",
    eyes: [
      {
        outline:
          "M68 130 Q72 101 96 82 Q119 61 146 66 Q177 69 182 110 Q186 151 168 167 Q151 184 122 175 Q99 171 98 139 L102 110 Q91 121 81 147 Q72 148 68 130 Z",
        lash: "M73 134 Q109 92 140 103 Q164 106 180 130",
        center: 125,
      },
      {
        outline:
          "M333 107 Q334 65 366 64 Q394 62 417 83 Q435 97 445 125 Q447 135 436 145 Q429 128 415 111 Q419 141 408 162 Q397 178 372 176 Q337 175 333 146 Z",
        lash: "M335 129 Q354 98 377 103 Q410 105 441 132",
        center: 124,
      },
    ],
    mouth: [289, 264, 21],
    skin: "#ffefde",
  },
  ren: {
    size: [624, 637],
    frame: "91 0 476 637",
    face: "194 12 278 278",
    crop: "232 128",
    lid: "#f9d9c4",
    lash: "#253038",
    eyes: [
      {
        outline:
          "M53 93 Q64 89 71 80 L69 75 L82 75 L86 65 L93 68 Q128 57 150 71 Q160 77 169 94 L157 88 Q157 113 148 125 Q139 135 113 134 L102 134 Q84 129 72 111 L68 114 L67 102 Z",
        lash: "M62 94 Q82 100 109 99 Q137 94 159 97",
        center: 99,
      },
      {
        outline:
          "M244 89 Q260 64 285 62 Q317 58 338 75 L355 85 L342 91 Q341 107 327 120 Q313 135 286 132 Q263 131 256 116 Q250 104 255 88 Z",
        lash: "M249 97 Q268 91 292 97 Q320 102 348 85",
        center: 98,
      },
    ],
    mouth: [337, 230, 17],
    skin: "#fcd8c0",
  },
  mugi: {
    size: [623, 637],
    frame: "78 0 447 637",
    face: "144 62 300 300",
    crop: "185 176",
    lid: "#fbdeca",
    lash: "#4a2928",
    eyes: [
      {
        outline:
          "M58 118 L67 113 Q71 102 77 94 L77 89 L83 87 L85 79 L92 78 Q115 57 141 62 Q161 64 173 86 L165 84 Q176 107 168 133 Q163 153 144 158 Q123 164 100 154 Q82 148 74 133 L70 136 L66 125 Z",
        lash: "M64 118 Q87 126 111 121 Q139 115 168 120",
        center: 119,
      },
      {
        outline:
          "M260 85 Q274 57 301 57 Q330 56 347 75 L355 75 L354 81 Q368 95 369 105 L377 109 Q370 116 362 126 L351 140 Q331 153 310 157 Q280 158 271 141 Q258 116 267 83 Z",
        lash: "M264 118 Q289 111 314 118 Q335 124 372 110",
        center: 117,
      },
    ],
    mouth: [295, 281, 15],
    skin: "#fbd7c3",
  },
};

let nextId = 0;

// Restore just the painted eye inside the lid silhouette as it narrows. The
// untouched sprite remains visible everywhere outside that silhouette.
function lid(id, art, eye, index, openness) {
  if (openness === 1) return "";
  const pose = `translate(${art.crop}) scale(.5)`;
  const base = `<path d="${eye.outline}" fill="${art.lid}" stroke="${art.lid}" stroke-width="1"/>`;
  if (openness < 0.15) {
    const crease = `<path d="${eye.lash}" fill="none" stroke="${art.lash}" stroke-width="5" stroke-linecap="round"/>`;
    return `<g transform="${pose}">${base}${crease}</g>`;
  }
  const clip = `${id}-eye-${index}`;
  const center = Number(art.crop.split(" ")[1]) + eye.center / 2;
  const shift = center * (1 - openness);
  return `<defs><clipPath id="${clip}"><path d="${eye.outline}" transform="${pose}"/></clipPath></defs><g transform="${pose}">${base}</g><g transform="translate(0 ${shift}) scale(1 ${openness})"><g clip-path="url(#${clip})"><use href="#${id}"/></g></g>`;
}

function mouth(art, penguin, mood, speaking) {
  const [x, y, w] = art.mouth;
  if (penguin) {
    const open = speaking || mood === "laugh" || mood === "surprised";
    return open
      ? `<path d="M${x - w} ${y - 2} Q${x} ${y + 18} ${x + w} ${y - 2} Q${x} ${y + 5} ${x - w} ${y - 2}Z" fill="#a6573b" stroke="#603a2c" stroke-width="2"/>`
      : "";
  }
  if (!speaking && ["neutral", "happy", "wink"].includes(mood)) return "";
  const ry = speaking ? 8 : mood === "laugh" ? 10 : mood === "surprised" ? 9 : 2;
  const rx = mood === "surprised" ? 6 : w * 0.75;
  const rest = mood === "sad" || mood === "pout" ? -7 : 5;
  const shape =
    ry > 2
      ? `<ellipse rx="${rx}" ry="${ry}" fill="#a95159" stroke="#633b40" stroke-width="1.8"/><path d="M${-rx * 0.62} ${ry * 0.55} Q0 ${-ry * 0.15} ${rx * 0.62} ${ry * 0.55} Q0 ${ry * 1.1} ${-rx * 0.62} ${ry * 0.55}Z" fill="#ee9191"/>`
      : `<path d="M${-rx} 1 Q0 ${rest} ${rx} 0" fill="none" stroke="#6a4545" stroke-width="2" stroke-linecap="round"/>`;
  return `<g transform="translate(${x} ${y})"><ellipse rx="${w + 4}" ry="9" fill="${art.skin}"/>${shape}</g>`;
}

export function illustratedPortrait(name, mood, face) {
  if (!Object.hasOwn(ART, name)) return null;
  const art = ART[name];
  const id = `post-art-${++nextId}`;
  const eyeAtRest = { sleepy: 0.32, pout: 0.57, thinking: 0.82, laugh: 0.09, shy: 0.84, sad: 0.68 };
  const eyes = art.eyes
    .map((eye, i) => lid(id, art, eye, i, mood === "wink" && !i ? 0.07 : (eyeAtRest[mood] ?? 1)))
    .join("");
  const blink = art.eyes.map((eye, i) => lid(id, art, eye, i, 0.065)).join("");
  const [w, h] = art.size;
  return `<svg class="rig illustrated" viewBox="${face ? art.face : art.frame}" preserveAspectRatio="${face ? "xMidYMid slice" : "xMidYMax meet"}" data-art="${name}" data-mood="${mood}" aria-hidden="true" focusable="false"><defs><image id="${id}" href="./art/${name}.svg" width="${w}" height="${h}"/></defs><g class="rig-figure"><use href="#${id}"/><g class="rig-open">${eyes}</g><g class="rig-shut">${blink}</g><g class="rig-mouth-rest">${mouth(art, name === "pip", mood, false)}</g><g class="rig-mouth-talk">${mouth(art, name === "pip", mood, true)}</g></g></svg>`;
}
