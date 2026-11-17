/* Canvas drawing: beads, grid, coordinates, the isolated colour and the hovered cell. */
(function () {
  const PS = (window.PS = window.PS || {});
  const TAU = Math.PI * 2;
  const holeCache = new Map();

  function holeColor(hex) {
    let v = holeCache.get(hex);
    if (!v) {
      v = PS.color.mix(hex, "#000000", 0.22);
      holeCache.set(hex, v);
    }
    return v;
  }

  function geometry(pattern, opts) {
    const pad = opts.showCoords ? 24 : opts.showGrid ? 12 : 6;
    return {
      cell: opts.cell,
      pad,
      w: pattern.cols * opts.cell + pad * 2,
      h: pattern.rows * opts.cell + pad * 2,
    };
  }

  function sizeCanvas(canvas, w, h) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  function drawBead(ctx, x, y, cell, hex) {
    if (cell >= 8) {
      const cx = x + cell / 2,
        cy = y + cell / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, cell * 0.46, 0, TAU);
      ctx.fillStyle = hex;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, cell * 0.145, 0, TAU);
      ctx.fillStyle = holeColor(hex);
      ctx.fill();
    } else {
      ctx.fillStyle = hex;
      ctx.fillRect(x, y, cell, cell);
    }
  }

  function drawBase(canvas, o) {
    const { pattern, cell } = o;
    const { cols, rows, cells, palette } = pattern;
    const geo = geometry(pattern, { cell, showCoords: o.showCoords, showGrid: o.showGrid });
    const pad = geo.pad;
    const ctx = sizeCanvas(canvas, geo.w, geo.h);

    ctx.fillStyle = o.colors.board;
    ctx.fillRect(0, 0, geo.w, geo.h);

    const withGap = cell >= 6;
    for (let r = 0; r < rows; r++) {
      const y = pad + r * cell;
      for (let c = 0; c < cols; c++) {
        const idx = cells[r * cols + c];
        if (idx < 0) continue;
        const x = pad + c * cell;
        const hex = palette[idx].hex;
        if (o.showBead && cell >= 5) drawBead(ctx, x, y, cell, hex);
        else if (withGap) {
          ctx.fillStyle = hex;
          ctx.fillRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
        } else {
          ctx.fillStyle = hex;
          ctx.fillRect(x, y, cell, cell);
        }
      }
    }

    /* Grid: a thin line per cell and a bold one every 5 cells, the rhythm of a pegboard */
    if (o.showGrid && cell >= 4) {
      const right = pad + cols * cell,
        bottom = pad + rows * cell;
      const thin = new Path2D(),
        bold = new Path2D();
      for (let c = 0; c <= cols; c++) {
        const x = Math.round(pad + c * cell) + 0.5;
        const p = c % 5 === 0 ? bold : thin;
        p.moveTo(x, pad);
        p.lineTo(x, bottom);
      }
      for (let r = 0; r <= rows; r++) {
        const y = Math.round(pad + r * cell) + 0.5;
        const p = r % 5 === 0 ? bold : thin;
        p.moveTo(pad, y);
        p.lineTo(right, y);
      }
      ctx.lineWidth = 1;
      ctx.strokeStyle = o.colors.gridLine;
      ctx.stroke(thin);
      ctx.strokeStyle = o.colors.gridStrong;
      ctx.stroke(bold);
    }

    /* Coordinates */
    if (o.showCoords) {
      ctx.fillStyle = o.colors.fgFaint;
      ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const step = cell < 7 ? 10 : 5;
      for (let c = 0; c < cols; c += step) {
        const x = pad + c * cell + cell / 2;
        ctx.fillText(String(c), x, pad / 2 + 2);
        ctx.fillText(String(c), x, pad + rows * cell + pad / 2 - 1);
      }
      ctx.textAlign = "right";
      for (let r = 0; r < rows; r += step) {
        const y = pad + r * cell + cell / 2;
        ctx.fillText(String(r), pad - 6, y);
        ctx.fillText(String(r), geo.w - 6, y);
      }
      ctx.textAlign = "left";
    }

    /* Compare: the original picture over the beads */
    if (o.compare && pattern.source) {
      ctx.globalAlpha = 0.96;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(pattern.source, pad, pad, cols * cell, rows * cell);
      ctx.globalAlpha = 1;
    }

    return geo;
  }

  function drawOverlay(canvas, o) {
    const { pattern, cell, hover, isolate } = o;
    const { cols, rows, cells, palette } = pattern;
    const geo = geometry(pattern, { cell, showCoords: o.showCoords, showGrid: o.showGrid });
    const pad = geo.pad;
    const ctx = sizeCanvas(canvas, geo.w, geo.h);
    ctx.clearRect(0, 0, geo.w, geo.h);

    if (isolate !== null && isolate !== undefined) {
      ctx.fillStyle = o.colors.dim;
      ctx.fillRect(pad, pad, cols * cell, rows * cell);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (cells[r * cols + c] !== isolate) continue;
          const x = pad + c * cell,
            y = pad + r * cell;
          if (o.showBead && cell >= 5) drawBead(ctx, x, y, cell, palette[isolate].hex);
          else {
            ctx.fillStyle = palette[isolate].hex;
            ctx.fillRect(x, y, cell, cell);
          }
        }
      }
    }

    if (hover) {
      const x = pad + hover.c * cell,
        y = pad + hover.r * cell;
      ctx.strokeStyle = o.colors.accent;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, cell - 2, cell - 2);
      ctx.strokeStyle = o.colors.accent;
      ctx.globalAlpha = 0.32;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad, y + cell / 2);
      ctx.lineTo(pad + cols * cell, y + cell / 2);
      ctx.moveTo(x + cell / 2, pad);
      ctx.lineTo(x + cell / 2, pad + rows * cell);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  PS.render = { drawBase, drawOverlay, geometry };
})();
