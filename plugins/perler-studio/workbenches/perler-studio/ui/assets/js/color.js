/* Colour maths: sRGB to CIELab (D65), the CIEDE2000 colour difference, nearest-colour lookup. */
(function () {
  const PS = (window.PS = window.PS || {});

  function srgbToLinear(v) {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }

  function rgbToLab(r, g, b) {
    const R = srgbToLinear(r),
      G = srgbToLinear(g),
      B = srgbToLinear(b);
    let X = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
    let Y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
    let Z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883;
    const f = (t) => (t > 0.008856451679 ? Math.cbrt(t) : 7.787037 * t + 16 / 116);
    X = f(X);
    Y = f(Y);
    Z = f(Z);
    return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
  }

  function deltaE76(a, b) {
    const dL = a[0] - b[0],
      da = a[1] - b[1],
      db = a[2] - b[2];
    return Math.sqrt(dL * dL + da * da + db * db);
  }

  const RAD = Math.PI / 180;

  /* CIEDE2000 with kL = kC = kH = 1 */
  function deltaE2000(lab1, lab2) {
    const L1 = lab1[0],
      a1 = lab1[1],
      b1 = lab1[2];
    const L2 = lab2[0],
      a2 = lab2[1],
      b2 = lab2[2];

    const C1 = Math.hypot(a1, b1);
    const C2 = Math.hypot(a2, b2);
    const Cbar = (C1 + C2) / 2;
    const Cbar7 = Math.pow(Cbar, 7);
    const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + Math.pow(25, 7))));

    const a1p = (1 + G) * a1;
    const a2p = (1 + G) * a2;
    const C1p = Math.hypot(a1p, b1);
    const C2p = Math.hypot(a2p, b2);

    let h1p = a1p === 0 && b1 === 0 ? 0 : Math.atan2(b1, a1p) / RAD;
    let h2p = a2p === 0 && b2 === 0 ? 0 : Math.atan2(b2, a2p) / RAD;
    if (h1p < 0) h1p += 360;
    if (h2p < 0) h2p += 360;

    const dLp = L2 - L1;
    const dCp = C2p - C1p;
    let dhp = 0;
    if (C1p * C2p !== 0) {
      dhp = h2p - h1p;
      if (dhp > 180) dhp -= 360;
      else if (dhp < -180) dhp += 360;
    }
    const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * RAD) / 2);

    const Lbarp = (L1 + L2) / 2;
    const Cbarp = (C1p + C2p) / 2;
    let hbarp;
    if (C1p * C2p === 0) hbarp = h1p + h2p;
    else if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2;
    else if (h1p + h2p < 360) hbarp = (h1p + h2p + 360) / 2;
    else hbarp = (h1p + h2p - 360) / 2;

    const T =
      1 -
      0.17 * Math.cos((hbarp - 30) * RAD) +
      0.24 * Math.cos(2 * hbarp * RAD) +
      0.32 * Math.cos((3 * hbarp + 6) * RAD) -
      0.2 * Math.cos((4 * hbarp - 63) * RAD);

    const dTheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
    const RC = 2 * Math.sqrt(Math.pow(Cbarp, 7) / (Math.pow(Cbarp, 7) + Math.pow(25, 7)));
    const SL = 1 + (0.015 * Math.pow(Lbarp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbarp - 50, 2));
    const SC = 1 + 0.045 * Cbarp;
    const SH = 1 + 0.015 * Cbarp * T;
    const RT = -Math.sin(2 * dTheta * RAD) * RC;

    const tL = dLp / SL,
      tC = dCp / SC,
      tH = dHp / SH;
    return Math.sqrt(tL * tL + tC * tC + tH * tH + RT * tC * tH);
  }

  /* A nearest-colour finder for one palette: ΔE76 picks the three closest candidates, then
     CIEDE2000 ranks them. */
  function makeMatcher(labs) {
    const n = labs.length;
    return function nearest(lab, k = 3) {
      if (n === 0) return -1;
      if (n === 1) return 0;
      let b1 = -1,
        b2 = -1,
        b3 = -1;
      let d1 = Infinity,
        d2 = Infinity,
        d3 = Infinity;
      for (let i = 0; i < n; i++) {
        const L = labs[i];
        const dL = lab[0] - L[0],
          da = lab[1] - L[1],
          db = lab[2] - L[2];
        const d = dL * dL + da * da + db * db;
        if (d < d1) {
          d3 = d2;
          b3 = b2;
          d2 = d1;
          b2 = b1;
          d1 = d;
          b1 = i;
        } else if (d < d2) {
          d3 = d2;
          b3 = b2;
          d2 = d;
          b2 = i;
        } else if (d < d3) {
          d3 = d;
          b3 = i;
        }
      }
      const cands = k >= 3 ? [b1, b2, b3] : [b1, b2].slice(0, k);
      let best = cands[0],
        bestD = Infinity;
      for (const i of cands) {
        if (i < 0) continue;
        const de = deltaE2000(lab, labs[i]);
        if (de < bestD) {
          bestD = de;
          best = i;
        }
      }
      return best;
    };
  }

  function hexToRgb(hex) {
    return PS.palettes.hexToRgb(hex);
  }

  function hexToLab(hex) {
    const { r, g, b } = hexToRgb(hex);
    return rgbToLab(r, g, b);
  }

  function relativeLuminance(r, g, b) {
    const R = srgbToLinear(r),
      G = srgbToLinear(g),
      B = srgbToLinear(b);
    return 0.2126 * R + 0.7152 * G + 0.0722 * B;
  }

  function contrastText(hex) {
    const { r, g, b } = PS.palettes.hexToRgb(hex);
    return relativeLuminance(r, g, b) > 0.5 ? "#111827" : "#ffffff";
  }

  function mix(hex, target, t) {
    const a = PS.palettes.hexToRgb(hex);
    const b = PS.palettes.hexToRgb(target);
    const ch = (x, y) => Math.round(x + (y - x) * t);
    return `#${[ch(a.r, b.r), ch(a.g, b.g), ch(a.b, b.b)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  }

  PS.color = {
    srgbToLinear,
    rgbToLab,
    deltaE76,
    deltaE2000,
    makeMatcher,
    relativeLuminance,
    contrastText,
    mix,
    hexToRgb,
    hexToLab,
  };
})();
