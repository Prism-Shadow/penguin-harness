/* Pattern engine: scale to the grid, sample each cell, match it to the palette, cap the number
 * of colours, merge stray beads, count. build() does the canvas part and hands the sampled
 * cells to buildFromCells(), which needs no DOM. Nothing here makes a network request.
 */
(function () {
  const PS = (window.PS = window.PS || {});
  const { rgbToLab, hexToLab, deltaE2000, makeMatcher } = PS.color;
  const t = (key, ...args) => (PS.i18n ? PS.i18n.t(key, ...args) : key);

  const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz1234567890";
  const SUB = 8; // each cell is sampled from 8 × 8 pixels

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /* ---------- Image preparation ---------- */

  function drawSmooth(ctx, img, dx, dy, dw, dh) {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    let sw = iw,
      sh = ih;
    let src = img;
    while (sw > dw * 2 && sh > dh * 2 && sw > 2 && sh > 2) {
      sw = Math.max(1, Math.round(sw / 2));
      sh = Math.max(1, Math.round(sh / 2));
      const c = document.createElement("canvas");
      c.width = sw;
      c.height = sh;
      const cx = c.getContext("2d");
      cx.imageSmoothingEnabled = true;
      cx.imageSmoothingQuality = "high";
      cx.drawImage(src, 0, 0, sw, sh);
      src = c;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, 0, 0, sw, sh, dx, dy, dw, dh);
  }

  /* Lays the picture onto a cols*8 × rows*8 working canvas, cropped to fill or fitted with
     margins. */
  function workingCanvas(img, cols, rows, fit, matteHex) {
    const tw = cols * SUB,
      th = rows * SUB;
    const cv = document.createElement("canvas");
    cv.width = tw;
    cv.height = th;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    if (matteHex) {
      ctx.fillStyle = matteHex;
      ctx.fillRect(0, 0, tw, th);
    }

    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const scale = fit === "contain" ? Math.min(tw / iw, th / ih) : Math.max(tw / iw, th / ih);
    const dw = Math.max(1, Math.round(iw * scale));
    const dh = Math.max(1, Math.round(ih * scale));
    drawSmooth(ctx, img, Math.round((tw - dw) / 2), Math.round((th - dh) / 2), dw, dh);
    return cv;
  }

  /* ---------- Sampling ---------- */

  function sampleCells(cv, cols, rows, mode) {
    const data = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
    const W = cv.width;
    const cells = new Array(cols * rows);
    const n = SUB * SUB;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x0 = c * SUB,
          y0 = r * SUB;

        if (mode === "center") {
          const px = x0 + (SUB >> 1),
            py = y0 + (SUB >> 1);
          const o = (py * W + px) * 4;
          cells[r * cols + c] =
            data[o + 3] < 128 ? null : { r: data[o], g: data[o + 1], b: data[o + 2] };
          continue;
        }

        if (mode === "mode" || mode === "median") {
          const rs = [],
            gs = [],
            bs = [];
          for (let y = y0; y < y0 + SUB; y++) {
            for (let x = x0; x < x0 + SUB; x++) {
              const o = (y * W + x) * 4;
              if (data[o + 3] < 128) continue;
              rs.push(data[o]);
              gs.push(data[o + 1]);
              bs.push(data[o + 2]);
            }
          }
          if (!rs.length) {
            cells[r * cols + c] = null;
            continue;
          }
          if (mode === "median") {
            const mid = (arr) => {
              arr.sort((a, b) => a - b);
              return arr[arr.length >> 1];
            };
            cells[r * cols + c] = { r: mid(rs), g: mid(gs), b: mid(bs) };
          } else {
            const map = new Map();
            for (let i = 0; i < rs.length; i++) {
              const key = ((rs[i] >> 3) << 10) | ((gs[i] >> 3) << 5) | (bs[i] >> 3);
              let e = map.get(key);
              if (!e) {
                e = { c: 0, r: 0, g: 0, b: 0 };
                map.set(key, e);
              }
              e.c++;
              e.r += rs[i];
              e.g += gs[i];
              e.b += bs[i];
            }
            let best = null;
            for (const e of map.values()) if (!best || e.c > best.c) best = e;
            cells[r * cols + c] = {
              r: Math.round(best.r / best.c),
              g: Math.round(best.g / best.c),
              b: Math.round(best.b / best.c),
            };
          }
          continue;
        }

        // area: the alpha-weighted average of the cell
        let ar = 0,
          ag = 0,
          ab = 0,
          aa = 0;
        for (let y = y0; y < y0 + SUB; y++) {
          for (let x = x0; x < x0 + SUB; x++) {
            const o = (y * W + x) * 4;
            const a = data[o + 3] / 255;
            ar += data[o] * a;
            ag += data[o + 1] * a;
            ab += data[o + 2] * a;
            aa += a;
          }
        }
        cells[r * cols + c] =
          aa < n * 0.5
            ? null
            : {
                r: Math.round(ar / aa),
                g: Math.round(ag / aa),
                b: Math.round(ab / aa),
              };
      }
    }
    return cells;
  }

  /* ---------- Background ---------- */

  function detectBackgroundLab(cells, cols, rows) {
    // The most common colour on the border (each channel bucketed without its low 3 bits),
    // taken as the average of its bucket.
    const map = new Map();
    const push = (cell) => {
      if (!cell) return;
      const key = ((cell.r >> 3) << 10) | ((cell.g >> 3) << 5) | (cell.b >> 3);
      let e = map.get(key);
      if (!e) {
        e = { c: 0, r: 0, g: 0, b: 0 };
        map.set(key, e);
      }
      e.c++;
      e.r += cell.r;
      e.g += cell.g;
      e.b += cell.b;
    };
    for (let c = 0; c < cols; c++) {
      push(cells[c]);
      push(cells[(rows - 1) * cols + c]);
    }
    for (let r = 0; r < rows; r++) {
      push(cells[r * cols]);
      push(cells[r * cols + cols - 1]);
    }
    if (!map.size) return null;
    let best = null;
    for (const e of map.values()) if (!best || e.c > best.c) best = e;
    return {
      rgb: {
        r: Math.round(best.r / best.c),
        g: Math.round(best.g / best.c),
        b: Math.round(best.b / best.c),
      },
      share: best.c / (2 * cols + 2 * rows),
    };
  }

  function floodBackground(cells, cols, rows, bgLab, tol) {
    const mask = new Uint8Array(cols * rows);
    const queue = [];
    const test = (i) => {
      if (mask[i]) return;
      const cell = cells[i];
      if (!cell) {
        mask[i] = 1;
        queue.push(i);
        return;
      }
      if (deltaE2000(rgbToLab(cell.r, cell.g, cell.b), bgLab) <= tol) {
        mask[i] = 1;
        queue.push(i);
      }
    };
    for (let c = 0; c < cols; c++) {
      test(c);
      test((rows - 1) * cols + c);
    }
    for (let r = 0; r < rows; r++) {
      test(r * cols);
      test(r * cols + cols - 1);
    }
    while (queue.length) {
      const i = queue.pop();
      const c = i % cols,
        r = (i / cols) | 0;
      if (c > 0) test(i - 1);
      if (c < cols - 1) test(i + 1);
      if (r > 0) test(i - cols);
      if (r < rows - 1) test(i + cols);
    }
    let count = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i]) count++;
    return { mask, count };
  }

  /* ---------- Colour limit ---------- */

  function reduceToLimit(cells, counts, labs, limit) {
    const active = new Set();
    for (let i = 0; i < counts.length; i++) if (counts[i] > 0) active.add(i);
    if (active.size <= limit) return cells;

    const remap = new Int32Array(counts.length).fill(-1);
    while (active.size > limit) {
      let worst = -1,
        worstCount = Infinity;
      for (const i of active)
        if (counts[i] < worstCount) {
          worstCount = counts[i];
          worst = i;
        }
      let best = -1,
        bestD = Infinity;
      for (const i of active) {
        if (i === worst) continue;
        const d = deltaE2000(labs[worst], labs[i]);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      if (best < 0) break;
      remap[worst] = best;
      counts[best] += counts[worst];
      counts[worst] = 0;
      active.delete(worst);
    }
    const resolve = (i) => {
      while (remap[i] >= 0) i = remap[i];
      return i;
    };
    const out = new Int16Array(cells.length);
    for (let i = 0; i < cells.length; i++) out[i] = cells[i] < 0 ? -1 : resolve(cells[i]);
    return out;
  }

  /* ---------- Noise merging ---------- */

  function smoothPass(cells, cols, rows, ownMax, majorityMin) {
    const prev = cells.slice();
    let changed = false;
    const tally = new Map();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const self = prev[i];
        tally.clear();
        let same = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const x = c + dx,
              y = r + dy;
            if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
            const v = prev[y * cols + x];
            if (v < 0) continue;
            if (v === self) same++;
            tally.set(v, (tally.get(v) || 0) + 1);
          }
        }
        if (same > ownMax) continue;
        let topColor = -1,
          topCount = 0;
        for (const [k, v] of tally)
          if (v > topCount) {
            topCount = v;
            topColor = k;
          }
        if (topColor >= 0 && topCount >= majorityMin) {
          cells[i] = topColor;
          changed = true;
        }
      }
    }
    return changed;
  }

  function removeSmallClusters(cells, cols, rows, minSize) {
    if (minSize <= 1) return false;
    const seen = new Uint8Array(cols * rows);
    let changed = false;
    const stack = [];
    for (let i = 0; i < cells.length; i++) {
      if (seen[i] || cells[i] < 0) continue;
      const color = cells[i];
      stack.length = 0;
      stack.push(i);
      seen[i] = 1;
      const region = [];
      const ring = new Map();
      while (stack.length) {
        const j = stack.pop();
        region.push(j);
        const c = j % cols,
          r = (j / cols) | 0;
        const nb = [
          c > 0 ? j - 1 : -1,
          c < cols - 1 ? j + 1 : -1,
          r > 0 ? j - cols : -1,
          r < rows - 1 ? j + cols : -1,
        ];
        for (const k of nb) {
          if (k < 0) continue;
          const v = cells[k];
          if (v === color) {
            if (!seen[k]) {
              seen[k] = 1;
              stack.push(k);
            }
          } else if (v >= 0) ring.set(v, (ring.get(v) || 0) + 1);
        }
      }
      if (region.length < minSize && ring.size) {
        let top = -1,
          topCount = 0;
        for (const [k, v] of ring)
          if (v > topCount) {
            topCount = v;
            top = k;
          }
        if (top >= 0) {
          for (const j of region) cells[j] = top;
          changed = true;
        }
      }
    }
    return changed;
  }

  function denoise(cells, cols, rows, level) {
    if (!level) return cells;
    const cfg = [
      null,
      { minCluster: 2, ownMax: 1, majorityMin: 5, rounds: 1 },
      { minCluster: 3, ownMax: 1, majorityMin: 5, rounds: 2 },
      { minCluster: 5, ownMax: 1, majorityMin: 4, rounds: 3 },
    ][level];
    let out = cells;
    for (let round = 0; round < cfg.rounds; round++) {
      let changed = removeSmallClusters(out, cols, rows, cfg.minCluster);
      if (smoothPass(out, cols, rows, cfg.ownMax, cfg.majorityMin)) changed = true;
      if (!changed) break;
    }
    return out;
  }

  /* ---------- Edge boost ---------- */

  /* Downsampling evens out the difference between neighbouring cells, so a small pattern looks
     blurred. One unsharp-mask pass at cell level pushes each cell a little away from the mean of
     its neighbours, which pulls the edges apart again. */
  function sharpenCells(cells, cols, rows, amount) {
    if (!(amount > 0)) return cells;
    const out = new Array(cells.length);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const self = cells[i];
        if (!self) {
          out[i] = null;
          continue;
        }
        if (self._fill !== undefined) {
          out[i] = self;
          continue;
        }
        let sr = 0,
          sg = 0,
          sb = 0,
          n = 0;
        const nb = (j) => (cells[j] && cells[j]._fill === undefined ? cells[j] : null);
        const l = nb(i - 1),
          rt = nb(i + 1),
          up = nb(i - cols),
          dn = nb(i + cols);
        if (c > 0 && l) {
          sr += l.r;
          sg += l.g;
          sb += l.b;
          n++;
        }
        if (c < cols - 1 && rt) {
          sr += rt.r;
          sg += rt.g;
          sb += rt.b;
          n++;
        }
        if (r > 0 && up) {
          sr += up.r;
          sg += up.g;
          sb += up.b;
          n++;
        }
        if (r < rows - 1 && dn) {
          sr += dn.r;
          sg += dn.g;
          sb += dn.b;
          n++;
        }
        if (!n) {
          out[i] = { r: self.r, g: self.g, b: self.b };
          continue;
        }
        const mr = sr / n,
          mg = sg / n,
          mb = sb / n;
        out[i] = {
          r: clamp(Math.round(self.r + amount * (self.r - mr)), 0, 255),
          g: clamp(Math.round(self.g + amount * (self.g - mg)), 0, 255),
          b: clamp(Math.round(self.b + amount * (self.b - mb)), 0, 255),
        };
      }
    }
    return out;
  }

  /* The fewer the cells, the fewer colours they should carry: with too many, the pattern turns
     into isolated single beads and gets harder to read. */
  function colorBudget(cols, rows) {
    const n = Math.max(cols, rows);
    if (n <= 20) return 14;
    if (n <= 29) return 22;
    if (n <= 40) return 28;
    if (n <= 52) return 36;
    if (n <= 76) return 48;
    return 60;
  }

  /* ---------- Pipeline ---------- */
  function build(opts) {
    const { img, settings, palette } = opts;
    const cols = clamp(settings.cols | 0, 4, 200);
    const rows = clamp(settings.rows | 0, 4, 200);
    const fit = settings.fit === "contain" ? "contain" : "cover";
    // Fitted with margins, the margins stay transparent: only the picture takes beads.
    const work = workingCanvas(img, cols, rows, fit, null);
    const cells = sampleCells(work, cols, rows, settings.sample || "area");
    return buildFromCells({ cells, cols, rows, settings, palette, source: work });
  }

  /* The canvas-free half of build(): sampled cells in (cols * rows of { r, g, b }, or null for
     an empty cell; the array is modified), the finished pattern out. It touches no DOM, so it
     runs outside a browser too; it writes count/char/order onto the palette entries it uses. */
  function buildFromCells(opts) {
    const { cols, rows, settings, palette, source } = opts;
    let cells = opts.cells;

    const labs = palette.map((c) => hexToLab(c.hex));
    const matcher = makeMatcher(labs);

    /* Background */
    const bgMode = settings.bg || "keep";
    if (bgMode !== "keep") {
      const bg = detectBackgroundLab(cells, cols, rows);
      if (bg) {
        const bgLab = rgbToLab(bg.rgb.r, bg.rgb.g, bg.rgb.b);
        const { mask, count } = floodBackground(
          cells,
          cols,
          rows,
          bgLab,
          bgMode === "solid" ? 12 : 10,
        );
        if (count > 0) {
          if (bgMode === "solid") {
            const target = hexToLab(settings.bgColorHex || "#FFFFFF");
            const ti = matcher(target);
            for (let i = 0; i < cells.length; i++) if (mask[i]) cells[i] = { _fill: ti };
          } else {
            for (let i = 0; i < cells.length; i++) if (mask[i]) cells[i] = null;
          }
        }
      }
    }

    /* Edge boost: photos and big reductions need it most; centre sampling keeps edges already,
       so it gets less. */
    if (settings.sharp !== 0) {
      const base = (settings.sample || "area") === "area" ? 0.35 : 0.2;
      cells = sharpenCells(cells, cols, rows, base);
    }

    /* Match every cell to the palette */
    const n = cells.length;
    let idx = new Int16Array(n).fill(-1);
    const cache = new Map();
    const toLab = (cell) => {
      const key = (cell.r << 16) | (cell.g << 8) | cell.b;
      let v = cache.get(key);
      if (v === undefined) {
        v = matcher(rgbToLab(cell.r, cell.g, cell.b));
        cache.set(key, v);
      }
      return v;
    };
    for (let i = 0; i < n; i++) {
      const cell = cells[i];
      if (!cell) continue;
      idx[i] = cell._fill !== undefined ? cell._fill : toLab(cell);
    }

    /* Colour limit */
    let counts = new Int32Array(palette.length);
    for (let i = 0; i < n; i++) if (idx[i] >= 0) counts[idx[i]]++;
    const autoLimit = Math.min(colorBudget(cols, rows), palette.length);
    const limit = settings.colorLimit | 0 || autoLimit; // Auto falls back to the budget for the size
    if (limit > 0) {
      idx = reduceToLimit(idx, counts, labs, Math.min(limit, palette.length));
      counts = new Int32Array(palette.length);
      for (let i = 0; i < n; i++) if (idx[i] >= 0) counts[idx[i]]++;
    }

    /* Noise merging */
    idx = denoise(idx, cols, rows, settings.noise | 0);

    return assemble(idx, cols, rows, palette, settings, source);
  }

  function assemble(idx, cols, rows, palette, settings, work) {
    const counts = new Int32Array(palette.length);
    let total = 0,
      empty = 0;
    for (let i = 0; i < idx.length; i++) {
      if (idx[i] < 0) empty++;
      else {
        counts[idx[i]]++;
        total++;
      }
    }

    const used = [];
    for (let i = 0; i < palette.length; i++) if (counts[i] > 0) used.push(i);
    used.sort((a, b) => counts[b] - counts[a]);
    used.forEach((palIdx, order) => {
      palette[palIdx].count = counts[palIdx];
      palette[palIdx].char = CHARS[order % CHARS.length];
      palette[palIdx].order = order;
    });

    const bead = Number(settings.bead) || 5;
    return {
      cols,
      rows,
      cells: idx,
      palette,
      used: used.map((i) => palette[i]),
      total,
      empty,
      colorCount: used.length,
      settings: { ...settings, cols, rows },
      bead,
      boards29: Math.ceil(cols / 29) * Math.ceil(rows / 29),
      boards50: Math.ceil(cols / 50) * Math.ceil(rows / 50),
      widthCm: (cols * bead) / 10,
      heightCm: (rows * bead) / 10,
      source: work,
    };
  }

  /* ---------- Picture analysis and recommended settings ---------- */

  function analyze(img) {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const w = 120,
      h = Math.max(1, Math.round((ih / iw) * 120));
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;

    const bins = new Set();
    let alphaPixels = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 250) alphaPixels++;
      bins.add(((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4));
    }

    let edge = 0,
      samples = 0;
    for (let y = 1; y < h - 1; y += 2) {
      for (let x = 1; x < w - 1; x += 2) {
        const o = (y * w + x) * 4;
        const r = data[o],
          g = data[o + 1],
          b = data[o + 2];
        const r2 = data[o + 4],
          g2 = data[o + 5],
          b2 = data[o + 6];
        const r3 = data[o + w * 4],
          g3 = data[o + w * 4 + 1],
          b3 = data[o + w * 4 + 2];
        edge +=
          (Math.abs(r - r2) +
            Math.abs(g - g2) +
            Math.abs(b - b2) +
            Math.abs(r - r3) +
            Math.abs(g - g3) +
            Math.abs(b - b3)) /
          3;
        samples++;
      }
    }

    // How uniform the border is
    let borderSame = 0,
      borderN = 0;
    const bkey = (x, y) => {
      const o = (y * w + x) * 4;
      return ((data[o] >> 4) << 8) | ((data[o + 1] >> 4) << 4) | (data[o + 2] >> 4);
    };
    const bk = bkey(0, 0);
    for (let x = 0; x < w; x++) {
      borderN += 2;
      if (bkey(x, 0) === bk) borderSame++;
      if (bkey(x, h - 1) === bk) borderSame++;
    }
    for (let y = 0; y < h; y++) {
      borderN += 2;
      if (bkey(0, y) === bk) borderSame++;
      if (bkey(w - 1, y) === bk) borderSame++;
    }

    return {
      w: iw,
      h: ih,
      unique: bins.size,
      edge: samples ? edge / samples : 0,
      alpha: alphaPixels / (w * h),
      borderSame: borderN ? borderSame / borderN : 0,
    };
  }

  /* The reasons are written in the interface language of the moment; the page asks again when
     the language changes. */
  function recommend(metrics) {
    const photo = metrics.unique > 380 || metrics.edge > 18;
    const simple = metrics.unique < 120;
    const size = photo ? 76 : metrics.unique < 70 && metrics.edge < 10 ? 29 : simple ? 40 : 52;
    const palette = photo ? "universal" : "hama";
    const sample = simple || metrics.alpha > 0.02 ? "center" : "area";
    const noise = photo ? 2 : simple ? 1 : 1;
    const bg = metrics.alpha > 0.02 ? "empty" : metrics.borderSame > 0.55 ? "auto" : "keep";
    return {
      cols: size,
      rows: size,
      sizeMode: String(size),
      sharp: 1,
      colorLimit: 0,
      palette,
      sample,
      noise,
      bead: 5,
      bg,
      bgColorHex: "#FFFFFF",
      fit: "cover",
      reasons: {
        size: t(photo ? "reason.size.photo" : `reason.size.${size}`),
        palette: t(photo ? "reason.palette.photo" : "reason.palette.basic"),
        sample: t(simple ? "reason.sample.simple" : "reason.sample.photo"),
        noise: t(
          photo ? "reason.noise.photo" : simple ? "reason.noise.simple" : "reason.noise.other",
        ),
        bg: t(`reason.bg.${bg}`),
      },
      colorCountEstimate: t("colors.estimate", colorBudget(size, size)), // the budget Auto uses
    };
  }

  function full(settings) {
    return {
      cols: settings.cols,
      rows: settings.rows,
      colorLimit: settings.colorLimit | 0,
      palette: settings.palette,
      sample: settings.sample,
      noise: settings.noise | 0,
      bead: Number(settings.bead),
      bg: settings.bg,
      bgColorHex: settings.bgColorHex,
      fit: settings.fit,
      sharp: settings.sharp === 0 ? 0 : 1,
    };
  }

  PS.engine = { build, buildFromCells, analyze, recommend, full, colorBudget, CHARS };
})();
