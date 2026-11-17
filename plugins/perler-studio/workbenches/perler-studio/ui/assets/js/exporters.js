/* Exports: the PNG pattern, CSV, JSON and the printable HTML page.
 * Colour codes and names can come from a palette the user pasted in, so every value written
 * into the print page's HTML goes through esc(). The texts of each export, and the colour names
 * in it, are in the interface language at the time of the export.
 */
(function () {
  const PS = (window.PS = window.PS || {});
  const t = (key, ...args) => (PS.i18n ? PS.i18n.t(key, ...args) : key);
  const nameOf = (c) => (PS.palettes && PS.palettes.nameOf ? PS.palettes.nameOf(c) : c.name);

  const esc = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  const pad2 = (n) => String(n).padStart(2, "0");
  const stamp = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  };
  const slug = (p) => `perler-${p.cols}x${p.rows}-${p.total}beads`;

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function clickLink(href, name) {
    const a = document.createElement("a");
    a.href = href;
    a.download = name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /* In a workbench frame a click on a blob link does not always download, so the file is
     stashed with the handler first and a same-origin link is clicked. Outside a workbench, or
     when stashing fails, it falls back to a local blob download. */
  async function deliver(blob, name, type) {
    if (PS.host && PS.host.inWorkbench) {
      try {
        const r = await PS.host.save(blob, name, type);
        clickLink(r.href, r.name || name);
        return { mode: "workbench", href: r.href, name: r.name || name };
      } catch (e) {
        console.warn("workbench save failed, falling back to blob", e);
      }
    }
    download(blob, name);
    return { mode: "download", name };
  }

  /* ---------------- PNG ---------------- */

  function renderPng(pattern) {
    const { cols, rows, cells, palette, used } = pattern;
    const cell = cols <= 60 ? 22 : cols <= 110 ? 14 : 10;
    const M = 34;
    const tick = 26;
    const gridW = cols * cell + tick;
    const gridH = rows * cell + tick;

    const legendCols = Math.min(3, Math.max(1, Math.floor(gridW / 240)));
    const rowsPerCol = Math.ceil(used.length / legendCols);
    const legendH = 28 + rowsPerCol * 24;

    const W = Math.max(gridW, 560) + M * 2;
    const H = M + 62 + gridH + 30 + legendH + 54;

    const S = 2;
    const cv = document.createElement("canvas");
    cv.width = W * S;
    cv.height = H * S;
    const ctx = cv.getContext("2d");
    ctx.scale(S, S);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);

    /* Heading */
    ctx.fillStyle = "#111827";
    ctx.font = '600 22px ui-sans-serif, system-ui, "Microsoft YaHei", sans-serif';
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillText(t("png.title"), M, M);
    ctx.font = "12px ui-monospace, Menlo, Consolas, monospace";
    ctx.fillStyle = "#6b7280";
    const meta = t(
      "png.meta",
      cols,
      rows,
      pattern.bead,
      pattern.total,
      pattern.colorCount,
      pattern.widthCm.toFixed(1),
      pattern.heightCm.toFixed(1),
      pattern.boards29,
    );
    ctx.fillText(meta, M, M + 32);

    const top = M + 62;
    const gx = M + tick,
      gy = top + tick;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(gx, gy, cols * cell, rows * cell);

    /* Beads */
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = cells[r * cols + c];
        if (idx < 0) continue;
        ctx.fillStyle = palette[idx].hex;
        ctx.fillRect(gx + c * cell, gy + r * cell, cell, cell);
      }
    }

    /* Grid and coordinates */
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(17,24,39,.14)";
    ctx.beginPath();
    for (let c = 0; c <= cols; c++) {
      const x = Math.round(gx + c * cell) + 0.5;
      ctx.moveTo(x, gy);
      ctx.lineTo(x, gy + rows * cell);
    }
    for (let r = 0; r <= rows; r++) {
      const y = Math.round(gy + r * cell) + 0.5;
      ctx.moveTo(gx, y);
      ctx.lineTo(gx + cols * cell, y);
    }
    ctx.stroke();

    ctx.strokeStyle = "rgba(17,24,39,.42)";
    ctx.beginPath();
    for (let c = 0; c <= cols; c += 5) {
      const x = Math.round(gx + c * cell) + 0.5;
      ctx.moveTo(x, gy);
      ctx.lineTo(x, gy + rows * cell);
    }
    for (let r = 0; r <= rows; r += 5) {
      const y = Math.round(gy + r * cell) + 0.5;
      ctx.moveTo(gx, y);
      ctx.lineTo(gx + cols * cell, y);
    }
    ctx.stroke();

    ctx.strokeStyle = "#9ca3af";
    ctx.strokeRect(gx + 0.5, gy + 0.5, cols * cell, rows * cell);

    ctx.fillStyle = "#6b7280";
    ctx.font = "9px ui-monospace, Menlo, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const step = cell < 10 ? 10 : 5;
    for (let c = 0; c < cols; c += step) ctx.fillText(String(c), gx + c * cell + cell / 2, gy - 9);
    for (let r = 0; r < rows; r += step) ctx.fillText(String(r), gx - 12, gy + r * cell + cell / 2);
    ctx.textAlign = "left";

    /* Legend, in as many columns as the grid width allows */
    const lx = M;
    const ly = top + gridH + 30;
    ctx.textBaseline = "top";
    ctx.fillStyle = "#111827";
    ctx.font = '600 13px ui-sans-serif, system-ui, "Microsoft YaHei", sans-serif';
    ctx.fillText(t("png.legend"), lx, ly);

    const colW = (W - M * 2) / legendCols;
    used.forEach((color, i) => {
      const col = Math.floor(i / rowsPerCol);
      const row = i % rowsPerCol;
      const x = lx + col * colW;
      const y = ly + 26 + row * 24;
      ctx.fillStyle = color.hex;
      ctx.fillRect(x, y + 2, 16, 16);
      ctx.strokeStyle = "rgba(17,24,39,.15)";
      ctx.strokeRect(x + 0.5, y + 2.5, 16, 16);
      ctx.fillStyle = "#111827";
      ctx.font = "11px ui-monospace, Menlo, Consolas, monospace";
      ctx.fillText(color.char, x + 24, y + 4);
      ctx.font = '12px ui-sans-serif, system-ui, "Microsoft YaHei", sans-serif';
      ctx.fillText(`${color.code}  ${nameOf(color)}`, x + 42, y + 3);
      ctx.textAlign = "right";
      ctx.font = "12px ui-monospace, Menlo, Consolas, monospace";
      ctx.fillStyle = "#4b5563";
      ctx.fillText(String(color.count), x + colW - 16, y + 3);
      ctx.textAlign = "left";
    });

    /* Footer */
    ctx.fillStyle = "#9ca3af";
    ctx.font = "10px ui-monospace, Menlo, Consolas, monospace";
    ctx.textBaseline = "top";
    ctx.fillText(t("png.footer", stamp()), M, H - 26);

    return cv;
  }

  function canvasToBlob(cv) {
    return new Promise((resolve, reject) => {
      cv.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error(t("error.canvasExport")))),
        "image/png",
      );
    });
  }

  async function exportPng(pattern) {
    const blob = await canvasToBlob(renderPng(pattern));
    return deliver(blob, `${slug(pattern)}.png`, "image/png");
  }

  /* ---------------- CSV ---------------- */

  /* The column names are the same in both languages, so a sheet or script that reads the file
     keeps working; the colour names follow the interface language. */
  function exportCsv(pattern) {
    const { cols, cells, palette } = pattern;
    const lines = ["x,y,char,color_code,color_name,hex"];
    for (let r = 0; r < pattern.rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = cells[r * cols + c];
        if (idx < 0) continue;
        const p = palette[idx];
        lines.push([c, r, p.char, p.code, nameOf(p), p.hex].join(","));
      }
    }
    const blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    return deliver(blob, `${slug(pattern)}.csv`, "text/csv");
  }

  /* ---------------- JSON ---------------- */

  function exportJson(pattern) {
    const { cols, rows, cells, palette } = pattern;
    const grid = [];
    for (let r = 0; r < rows; r++) {
      let line = "";
      for (let c = 0; c < cols; c++) {
        const idx = cells[r * cols + c];
        line += idx < 0 ? "." : palette[idx].char;
      }
      grid.push(line);
    }
    const data = {
      app: t("export.app"),
      generatedAt: new Date().toISOString(),
      size: { cols, rows },
      bead: `${pattern.bead}mm`,
      finished: { widthCm: +pattern.widthCm.toFixed(1), heightCm: +pattern.heightCm.toFixed(1) },
      boards: { "29x29": pattern.boards29, "50x50": pattern.boards50 },
      totals: { beads: pattern.total, colors: pattern.colorCount, emptyCells: pattern.empty },
      params: pattern.settings,
      palette: pattern.used.map((p) => ({
        char: p.char,
        code: p.code,
        name: p.name,
        en: p.en,
        hex: p.hex,
        count: p.count,
      })),
      grid,
    };
    return deliver(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      `${slug(pattern)}.json`,
      "application/json",
    );
  }

  /* ---------------- Print page ---------------- */

  function buildPrintHtml(pattern) {
    const { cols, rows, cells, palette, used } = pattern;
    const lang = PS.i18n && PS.i18n.lang() === "en" ? "en" : "zh-CN";
    // The whole pattern fits one landscape A4 page, whose usable area is 244 mm × 178 mm.
    const cellMm = Math.max(1.5, Math.min(7, 244 / cols, 178 / rows));
    const rowsHtml = [];
    for (let r = 0; r < rows; r++) {
      const tds = [];
      for (let c = 0; c < cols; c++) {
        const idx = cells[r * cols + c];
        if (idx < 0) {
          tds.push('<td class="e"></td>');
          continue;
        }
        const p = palette[idx];
        tds.push(
          `<td style="background:${esc(p.hex)}">${cellMm >= 4.4 ? `<i>${esc(p.char)}</i>` : ""}</td>`,
        );
      }
      rowsHtml.push(`<tr><th>${r}</th>${tds.join("")}</tr>`);
    }
    const legend = used
      .map(
        (p) => `
      <tr><td class="c">${esc(p.char)}</td>
      <td class="s"><span style="background:${esc(p.hex)}"></span></td>
      <td class="k">${esc(p.code)}</td><td class="n">${esc(nameOf(p))}</td>
      <td class="q">${esc(p.count)}</td></tr>`,
      )
      .join("");
    const headCols = Array.from(
      { length: cols },
      (_, c) => `<th class="${c % 5 === 0 ? "m" : ""}">${c % 5 === 0 ? c : ""}</th>`,
    ).join("");

    const meta = t(
      "print.meta",
      cols,
      rows,
      pattern.bead,
      pattern.total,
      pattern.colorCount,
      pattern.widthCm.toFixed(1),
      pattern.heightCm.toFixed(1),
      pattern.boards29,
    );

    return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8">
<title>${esc(t("print.title", cols, rows))}</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: ui-sans-serif, system-ui, "Microsoft YaHei", sans-serif; color: #111827; }
  h1 { font-size: 20px; margin: 0 0 4px; letter-spacing: -.02em; }
  .meta { font: 11px ui-monospace, Menlo, Consolas, monospace; color: #6b7280; margin-bottom: 14px; }
  h2 { font-size: 13px; margin: 18px 0 8px; }
  table { border-collapse: collapse; }
  .grid td, .grid th { width: ${cellMm}mm; height: ${cellMm}mm; padding: 0; border: 1px solid rgba(17,24,39,.18); }
  .grid th { font: 8px ui-monospace, Menlo, Consolas, monospace; color: #6b7280; border-color: transparent; font-weight: 400; }
  .grid th.m { color: #111827; }
  .grid td.e { background: repeating-linear-gradient(45deg, #fff, #fff 1px, #f1f2f4 1px, #f1f2f4 3px); }
  .grid td i { display: block; font: 7px ui-monospace, Menlo, Consolas, monospace; color: rgba(0,0,0,.42);
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .grid td { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .legend { font-size: 11px; }
  .legend td { padding: 3px 8px 3px 0; border-bottom: 1px solid #eef0f2; }
  .legend .c { font-family: ui-monospace, Menlo, Consolas, monospace; width: 18px; }
  .legend .s span { display: block; width: 12px; height: 12px; border: 1px solid rgba(0,0,0,.15); }
  .legend .k { font-family: ui-monospace, Menlo, Consolas, monospace; color: #4b5563; }
  .legend .q { text-align: right; font-family: ui-monospace, Menlo, Consolas, monospace; }
  .cols { display: flex; gap: 28px; align-items: flex-start; }
  .foot { margin-top: 16px; font: 10px ui-monospace, Menlo, Consolas, monospace; color: #9ca3af; }
  .btn { position: fixed; right: 16px; top: 16px; padding: 8px 14px; border: 1px solid #d1d5db;
    background: #fff; border-radius: 6px; font-size: 13px; cursor: pointer; }
  @media print { .btn { display: none; } }
</style></head>
<body>
<button class="btn" onclick="window.print()">${esc(t("print.button"))}</button>
<h1>${esc(t("print.heading"))}</h1>
<div class="meta">${esc(meta)}</div>
<div class="cols">
  <div>
    <h2>${esc(t("print.grid"))}</h2>
    <table class="grid">
      <thead><tr><th></th>${headCols}</tr></thead>
      <tbody>${rowsHtml.join("")}</tbody>
    </table>
  </div>
  <div>
    <h2>${esc(t("print.legend"))}</h2>
    <table class="legend"><tbody>${legend}</tbody></table>
    <h2>${esc(t("print.tips"))}</h2>
    <div style="font-size:11px;line-height:1.7;color:#4b5563;max-width:62mm">
      ${esc(t("print.tip1"))}<br>
      ${esc(t("print.tip2"))}<br>
      ${esc(t("print.tip3"))}
    </div>
  </div>
</div>
<p class="foot">${esc(t("print.footer", stamp()))}</p>
</body></html>`;
  }

  async function exportPrint(pattern) {
    const html = buildPrintHtml(pattern);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const name = `${slug(pattern)}-print.html`;

    if (PS.host && PS.host.inWorkbench) {
      try {
        const r = await PS.host.save(blob, name, "text/html");
        const win = window.open(r.page, "_blank");
        if (win) return "new-tab";
        clickLink(r.href, name);
        return "download";
      } catch (e) {
        console.warn("workbench print failed, falling back", e);
      }
    }

    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank");
    if (win) {
      setTimeout(() => URL.revokeObjectURL(url), 20000);
      return "new-tab";
    }
    download(blob, name);
    return "download";
  }

  PS.exporters = {
    exportPng,
    exportCsv,
    exportJson,
    exportPrint,
    renderPng,
    buildPrintHtml,
    download,
    deliver,
  };
})();
