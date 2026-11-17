/* The workbench UI: a picture in, recommended or hand-set settings, the pattern, its legend and
 * totals, the exports. Every text comes from PS.i18n; a language switch re-renders the page in
 * place.
 */
(function () {
  const PS = window.PS;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const STORE = "perler.studio.v1";
  const t = (key, ...args) => PS.i18n.t(key, ...args);
  const nameOf = (c) => PS.palettes.nameOf(c);

  const state = {
    theme: "light",
    mode: "quick",
    settings: {
      cols: 52,
      rows: 52,
      sizeMode: "52",
      colorLimit: 0,
      palette: "hama",
      sample: "area",
      noise: 2,
      bead: 5,
      bg: "auto",
      bgColorHex: "#FFFFFF",
      fit: "cover",
      sharp: 1,
    },
    toggles: { grid: true, bead: true, coords: true, compare: false },
    board: 29,
    palettes: {}, // calibrated palettes, by id
    customPalettes: {}, // imported palettes
    onlyAvailable: true,
    img: null,
    imgName: "", // a picked file's name; empty for a sample
    imgBytes: 0,
    demo: null, // 'heart' or 'star' while a sample is loaded
    imgSize: { w: 0, h: 0 },
    metrics: null,
    rec: null,
    pattern: null,
    isolate: null,
    hover: null,
    view: { zoom: 1 },
    geo: null,
    busy: false,
    token: 0,
    fresh: false, // first open: nothing saved yet
  };

  /* ---------------- Helpers ---------------- */

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const esc = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );

  function toast(msg, ms = 2600) {
    const box = $("#toasts");
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => {
      el.classList.add("is-out");
      setTimeout(() => el.remove(), 240);
    }, ms);
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function themeColors() {
    const root = document.documentElement;
    const dark = root.dataset.theme === "dark" || root.dataset.scheme === "dark";
    return {
      board: cssVar("--board") || (dark ? "#0b0b0b" : "#ffffff"),
      gridLine: cssVar("--grid-line"),
      gridStrong: cssVar("--grid-strong"),
      fgFaint: cssVar("--fg-faint"),
      accent: cssVar("--brand-500"),
      dim: dark ? "rgba(0,0,0,.66)" : "rgba(255,255,255,.74)",
    };
  }

  /* ---------------- Language ---------------- */

  /* Fills every static label from the dictionary: texts, titles, aria labels, placeholders, alt
     texts, the document's title and description. */
  function applyStatic() {
    $$("[data-i18n]").forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    $$("[data-i18n-title]").forEach((el) => {
      el.title = t(el.dataset.i18nTitle);
    });
    $$("[data-i18n-aria-label]").forEach((el) => {
      el.setAttribute("aria-label", t(el.dataset.i18nAriaLabel));
    });
    $$("[data-i18n-placeholder]").forEach((el) => {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    $$("[data-i18n-alt]").forEach((el) => {
      el.alt = t(el.dataset.i18nAlt);
    });
    document.title = t("doc.title");
    const meta = $('meta[name="description"]');
    if (meta) meta.setAttribute("content", t("doc.description"));
    // The switch names the language it switches to, in that language.
    $("#btnLang").lang = PS.i18n.lang() === "zh" ? "en" : "zh-CN";
  }

  /* After a switch: every label, every rendered view and the open dialogs, in place. The
     pattern itself is not rebuilt: nothing drawn on it depends on the language. */
  function refreshLanguage() {
    applyStatic();
    refreshPaletteSelect();
    if (state.metrics) state.rec = PS.engine.recommend(state.metrics);
    showSource();
    syncControls();
    updateStats();
    updateLegend();
    updateStatus();
    refreshTip();
    if ($("#paletteDialog").open) {
      renderPaletteNote();
      renderPaletteList();
    }
    if ($("#replaceDialog").open) renderReplace();
  }

  /* ---------------- Persistence ---------------- */

  function save() {
    try {
      localStorage.setItem(
        STORE,
        JSON.stringify({
          theme: state.theme,
          mode: state.mode,
          settings: state.settings,
          toggles: state.toggles,
          board: state.board,
          palettes: state.palettes,
          customPalettes: state.customPalettes,
          onlyAvailable: state.onlyAvailable,
        }),
      );
    } catch (e) {
      /* storage unavailable (private mode): ignore */
    }
  }

  function load() {
    let raw = null;
    try {
      raw = JSON.parse(localStorage.getItem(STORE) || "null");
    } catch (e) {
      raw = null;
    }
    state.fresh = !raw;
    if (raw) {
      if (raw.settings) Object.assign(state.settings, raw.settings);
      if (state.settings.colorLimit === 58) state.settings.colorLimit = 64; // an old option, folded into 64 when the palette grew
      if (raw.toggles) Object.assign(state.toggles, raw.toggles);
      if (raw.mode) state.mode = raw.mode;
      if (raw.board) state.board = raw.board;
      if (raw.palettes) state.palettes = raw.palettes;
      if (raw.customPalettes) state.customPalettes = raw.customPalettes;
      if (typeof raw.onlyAvailable === "boolean") state.onlyAvailable = raw.onlyAvailable;
      if (raw.theme) state.theme = raw.theme;
    } else {
      state.theme =
        window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    }
    applyTheme(state.theme);
  }

  /* Inside a workbench tab the app's theme wins; opened on its own, the page's toggle decides. */
  function applyTheme(name) {
    state.theme = name;
    if (PS.host && PS.host.inWorkbench) return;
    document.documentElement.dataset.theme = name;
  }

  /* ---------------- Palettes ---------------- */

  /* An imported palette is labelled from its size at display time, so its label follows the
     interface language; the label saved with it at import is not shown. */
  function paletteMeta(id) {
    const custom = state.customPalettes[id];
    if (custom) {
      const name = t("palette.custom", custom.colors.length);
      return { id, name, short: name, note: "" };
    }
    return PS.palettes.base(id);
  }

  function activeColors(id) {
    const pid = id || state.settings.palette;
    if (state.customPalettes[pid]) return state.customPalettes[pid].colors.map((c) => ({ ...c }));
    const ov = state.palettes[pid];
    if (Array.isArray(ov) && ov.length) return ov.map((c) => ({ ...c }));
    return PS.palettes.base(pid).colors;
  }

  function buildPalette(pid) {
    const all = activeColors(pid);
    const avail = state.onlyAvailable ? all.filter((c) => !c.off) : all;
    return (avail.length >= 4 ? avail : all).map((c) => ({ ...c, count: 0, char: "", order: 0 }));
  }

  function refreshPaletteSelect() {
    const sel = $("#selPalette");
    const pick = $("#palettePick");
    const ids = PS.palettes.order.concat(Object.keys(state.customPalettes));
    const build = (el) => {
      el.innerHTML = ids
        .map((id) => `<option value="${esc(id)}">${esc(paletteMeta(id).name)}</option>`)
        .join("");
      el.value = state.settings.palette;
      if (!el.value) {
        state.settings.palette = "hama";
        el.value = "hama";
      }
    };
    build(sel);
    if (pick) {
      build(pick);
    }
    $("#palSize").textContent = t("unit.colours", activeColors().length);
  }

  /* ---------------- Picture ---------------- */

  function readFile(file) {
    if (!file || !/^image\//.test(file.type)) {
      toast(t("toast.notImage"));
      return;
    }
    if (file.size > 24 * 1024 * 1024) {
      toast(t("toast.tooBig"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => afterImage(img, file.name.replace(/\.[^.]+$/, ""), file.size);
      img.onerror = () => toast(t("toast.unreadable"));
      img.src = reader.result;
    };
    reader.onerror = () => toast(t("toast.readFailed"));
    reader.readAsDataURL(file);
  }

  /* The picture's name and size above the drop zone; a sample is named in the interface
     language. */
  function showSource() {
    if (!state.img) return;
    $("#fname").textContent = state.demo
      ? t(`sample.${state.demo}`)
      : state.imgName || t("src.untitled");
    $("#srcMeta").textContent = state.demo
      ? t("src.sampleMeta")
      : state.imgBytes
        ? `${Math.max(1, Math.round(state.imgBytes / 1024))} KB`
        : "";
  }

  function afterImage(img, name, bytes) {
    state.img = img;
    state.demo = null;
    state.imgName = name || "";
    state.imgBytes = bytes || 0;
    state.imgSize = { w: img.naturalWidth || img.width, h: img.naturalHeight || img.height };
    $("#thumb").src = img.src || img.toDataURL("image/png");
    $("#fmeta").textContent = `${state.imgSize.w} × ${state.imgSize.h}`;
    $("#dropIdle").hidden = true;
    $("#dropPreview").hidden = false;
    showSource();
    $("#btnReset").disabled = false;
    $("#btnGenerate").disabled = false;
    $("#emptyState").hidden = true;
    analyzeImage();
  }

  function analyzeImage() {
    if (!state.img) return;
    state.metrics = PS.engine.analyze(state.img);
    state.rec = PS.engine.recommend(state.metrics);
    if (state.mode === "quick") applyRec(state.rec);
    syncControls();
    renderRecommend();
    generate();
  }

  function applyRec(rec) {
    Object.assign(state.settings, {
      cols: rec.cols,
      rows: rec.rows,
      sizeMode: rec.sizeMode,
      colorLimit: rec.colorLimit,
      palette: rec.palette,
      sample: rec.sample,
      noise: rec.noise,
      bg: rec.bg,
      fit: rec.fit,
      sharp: rec.sharp === 0 ? 0 : 1,
    });
  }

  /* ---------------- Recommendation list ---------------- */

  const SAMPLES = ["area", "center", "mode", "median"];
  const BACKGROUNDS = ["auto", "keep", "solid", "empty"];
  const NOISE = [0, 1, 2, 3];
  /* A label for a setting the app knows; anything else is shown as written. */
  const optionLabel = (prefix, known, value) =>
    known.includes(value) ? t(`${prefix}.${value}`) : String(value);

  function renderRecommend() {
    const list = $("#recommendList");
    if (!state.img || !state.rec) {
      list.innerHTML = "";
      $("#quickNote").textContent = t("quick.idle");
      return;
    }
    const s = state.settings;
    const rec = state.rec;
    const rows = [
      [t("size.label"), t("size.value", s.cols, s.rows), rec.reasons.size],
      [
        t("colors.label"),
        s.colorLimit ? t("colors.upTo", s.colorLimit) : t("rec.colorsAuto", rec.colorCountEstimate),
        t("rec.colorsWhy"),
      ],
      [t("palette.label"), paletteMeta(s.palette).name, rec.reasons.palette],
      [t("sample.label"), optionLabel("sample", SAMPLES, s.sample), rec.reasons.sample],
      [t("noise.label"), optionLabel("noise", NOISE, s.noise), rec.reasons.noise],
      [t("sharp.label"), t(s.sharp === 0 ? "sharp.off" : "sharp.auto"), t("rec.sharpWhy")],
      [
        t("bead.label"),
        `${s.bead} mm`,
        t("rec.finished", ((s.cols * s.bead) / 10).toFixed(1), ((s.rows * s.bead) / 10).toFixed(1)),
      ],
      [t("bg.label"), optionLabel("bg", BACKGROUNDS, s.bg), rec.reasons.bg],
    ];
    list.innerHTML = rows
      .map(
        ([k, v, why]) =>
          `<li><span class="r-key">${esc(k)}</span><span class="r-val">${esc(v)}<span class="r-why">${esc(why)}</span></span></li>`,
      )
      .join("");
    const pct = Math.round((state.imgSize.w / state.imgSize.h) * 100) / 100;
    const detail =
      state.metrics.unique > 380
        ? "quick.detailHigh"
        : state.metrics.unique < 120
          ? "quick.detailLow"
          : "quick.detailMid";
    $("#quickNote").textContent = t("quick.done", t(detail), pct);
  }

  /* ---------------- Controls ---------------- */

  function syncControls() {
    const s = state.settings;
    $$("#modeSeg button").forEach((b) =>
      b.setAttribute("aria-selected", String(b.dataset.mode === state.mode)),
    );
    $("#quickPanel").hidden = state.mode !== "quick";
    $("#proPanel").hidden = state.mode !== "pro";

    $$("#sizeSeg button").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.size === s.sizeMode)),
    );
    $("#customSize").hidden = s.sizeMode !== "custom";
    $("#sizeOut").textContent = t("size.value", s.cols, s.rows);
    const beadMm = Number(s.bead) || 5;
    $("#sizeInfo").textContent = t(
      "size.info",
      s.cols * s.rows,
      ((s.cols * beadMm) / 10).toFixed(1),
      ((s.rows * beadMm) / 10).toFixed(1),
    );
    if (document.activeElement !== $("#colsInput")) $("#colsInput").value = s.cols;
    if (document.activeElement !== $("#rowsInput")) $("#rowsInput").value = s.rows;

    const palSize = activeColors().length;
    const budget = Math.min(PS.engine.colorBudget(s.cols, s.rows), palSize);
    $("#selColors").value = String(s.colorLimit);
    $("#colorsOut").textContent = s.colorLimit
      ? s.colorLimit >= palSize
        ? t("colors.full")
        : `≤ ${s.colorLimit}`
      : t("colors.auto");
    $("#colorsHint").textContent =
      s.colorLimit > palSize
        ? t("colors.hintShort", palSize)
        : t("colors.hintAuto", s.cols, budget, palSize);

    $("#selPalette").value = s.palette;
    $("#palSize").textContent = t("unit.colours", palSize);
    $("#selSample").value = s.sample;

    $$("#noiseSeg button").forEach((b) =>
      b.setAttribute("aria-pressed", String(+b.dataset.noise === s.noise)),
    );
    $("#noiseOut").textContent = optionLabel("noise", NOISE, s.noise);

    $$("#beadSeg button").forEach((b) =>
      b.setAttribute("aria-pressed", String(+b.dataset.bead === Number(s.bead))),
    );
    $("#beadOut").textContent = `${Number(s.bead)} mm`;

    $$("#bgSeg button").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.bg === s.bg)),
    );
    $("#bgColorRow").hidden = s.bg !== "solid";
    $("#bgColor").value = s.bgColorHex;
    $("#bgColorHex").textContent = s.bgColorHex.toUpperCase();
    $("#selFit").value = s.fit;
    $("#selSharp").value = s.sharp === 0 ? "0" : "1";
    $("#sharpOut").textContent = t(s.sharp === 0 ? "sharp.off" : "sharp.auto");

    $$("#boardSeg button").forEach((b) =>
      b.setAttribute("aria-pressed", String(+b.dataset.board === state.board)),
    );
    $$(".chip-toggle").forEach((b) =>
      b.setAttribute("aria-pressed", String(!!state.toggles[b.dataset.toggle])),
    );

    $("#btnGenerate").textContent = t(state.pattern ? "quick.regenerate" : "quick.generate");
    renderRecommend();
  }

  /* ---------------- Generate ---------------- */

  let genTimer = 0;
  function scheduleGenerate(delay = 220) {
    clearTimeout(genTimer);
    genTimer = setTimeout(generate, delay);
  }

  async function generate() {
    if (!state.img) {
      toast(t("toast.needPicture"));
      $("#drop").focus();
      return;
    }
    const token = ++state.token;
    state.busy = true;
    $("#busy").hidden = false;
    $("#busyText").textContent = t("busy.matching");

    // Yield once so the busy note can paint: a timeout, not rAF, which a background tab never runs.
    await new Promise((r) => setTimeout(r, 30));

    let pattern;
    try {
      const palette = buildPalette();
      pattern = PS.engine.build({
        img: state.img,
        settings: {
          ...state.settings,
          cols: clamp(state.settings.cols | 0, 4, 200),
          rows: clamp(state.settings.rows | 0, 4, 200),
        },
        palette,
      });
    } catch (err) {
      console.error(err);
      state.busy = false;
      $("#busy").hidden = true;
      toast(t("toast.genFailed", err && err.message ? err.message : t("error.unknown")));
      return;
    }

    if (token !== state.token) return; // a newer request superseded this one
    state.pattern = pattern;
    state.isolate = null;
    state.hover = null;
    state.view.zoom = 1;
    state.busy = false;
    $("#busy").hidden = true;
    $("#emptyState").hidden = true;

    render();
    updateStats();
    updateLegend();
    updateStatus();
    refreshExports();
    syncControls();
    save();
    if (window.innerWidth < 960) {
      const stageTop = $("#stage").getBoundingClientRect().top + window.scrollY - 64;
      window.scrollTo({ top: stageTop, behavior: "smooth" });
    }
    toast(t("toast.generated", pattern.cols, pattern.rows, pattern.total, pattern.colorCount));
  }

  /* ---------------- Rendering ---------------- */

  function computeFitCell() {
    const p = state.pattern;
    if (!p) return 12;
    const el = $("#canvasScroll");
    const pad = state.toggles.coords ? 24 : state.toggles.grid ? 12 : 6;
    const availW = Math.max(120, el.clientWidth - 46);
    const availH = Math.max(120, el.clientHeight - 46);
    const cw = (availW - pad * 2) / p.cols;
    const ch = (availH - pad * 2) / p.rows;
    return Math.max(2.2, Math.min(cw, ch, 44));
  }

  function render() {
    const p = state.pattern;
    if (!p) return;
    const fit = computeFitCell();
    const cell = Math.max(2.4, Math.min(48, Math.round(fit * state.view.zoom * 2) / 2));
    const colors = themeColors();

    // Size the container first so that its scrollbars come out right.
    const geo = PS.render.geometry(p, {
      cell,
      showCoords: state.toggles.coords,
      showGrid: state.toggles.grid,
    });
    $("#canvasInner").hidden = false;
    $("#canvasInner").style.width = geo.w + "px";
    $("#canvasInner").style.height = geo.h + "px";

    const t = state.toggles;
    PS.render.drawBase($("#baseCanvas"), {
      pattern: p,
      cell,
      colors,
      showGrid: t.grid,
      showBead: t.bead,
      showCoords: t.coords,
      compare: t.compare,
    });
    $("#overlayCanvas").hidden = false;
    PS.render.drawOverlay($("#overlayCanvas"), {
      pattern: p,
      cell,
      hover: state.hover,
      isolate: state.isolate,
      colors,
      showGrid: t.grid,
      showBead: t.bead,
      showCoords: t.coords,
    });

    state.geo = { cell, pad: geo.pad, fit };
    $("#zoomLabel").textContent = Math.round((cell / fit) * 100) + "%";
  }

  function renderOverlayOnly() {
    const p = state.pattern;
    if (!p || !state.geo) return;
    PS.render.drawOverlay($("#overlayCanvas"), {
      pattern: p,
      cell: state.geo.cell,
      showBead: state.toggles.bead,
      showCoords: state.toggles.coords,
      showGrid: state.toggles.grid,
      hover: state.hover,
      isolate: state.isolate,
      colors: themeColors(),
    });
  }

  /* ---------------- Totals and legend ---------------- */

  /* A stat tile's value with its unit in small type; an empty unit (English) shows none. */
  function setStat(sel, value, unit) {
    const el = $(sel);
    el.textContent = value;
    if (!unit) return;
    const small = document.createElement("small");
    small.textContent = unit;
    el.appendChild(small);
  }

  function updateStats() {
    const p = state.pattern;
    if (!p) {
      $("#stTotal").textContent = "—";
      $("#stColors").textContent = "—";
      $("#stBoards").textContent = "—";
      $("#stSize").textContent = "—";
      $("#statSide").textContent = "";
      return;
    }
    setStat("#stTotal", p.total, t("stats.unitBeads"));
    setStat("#stColors", p.colorCount, t("stats.unitColors"));
    const boards = state.board === 50 ? p.boards50 : p.boards29;
    setStat("#stBoards", boards, t("stats.unitBoards"));
    setStat("#stSize", `${p.widthCm.toFixed(1)} × ${p.heightCm.toFixed(1)}`, "cm");
    $("#statSide").textContent = `${p.bead}mm · ${p.cols}×${p.rows}`;
  }

  function updateLegend() {
    const p = state.pattern;
    const list = $("#legendList");
    if (!p) {
      list.innerHTML = "";
      $("#legendEmpty").hidden = false;
      $("#legendSide").textContent = "";
      return;
    }
    $("#legendEmpty").hidden = true;
    $("#legendSide").textContent = t("legend.side", p.colorCount, p.total);
    // Most used first; the symbols match the grid because assemble() handed them out in this
    // order. The second line is the English name under a Chinese one, and the hex value under
    // an English one, so a row keeps its height across a language switch.
    const zh = PS.i18n.lang() === "zh";
    const max = p.used.length ? p.used[0].count : 1;
    const scroll = list.scrollTop;
    list.innerHTML = p.used
      .map((c) => {
        const idx = p.palette.indexOf(c);
        const w = Math.max(2, Math.round((c.count / max) * 100));
        const name = nameOf(c);
        return `<li class="legend-row" role="button" tabindex="0" data-idx="${idx}"
          aria-pressed="${state.isolate === idx ? "true" : "false"}"
          title="${esc(t("legend.rowTitle", c.code, name))}">
        <span class="lg-fill" style="width:${w}%;background:${esc(c.hex)}"></span>
        <span class="lg-char">${esc(c.char)}</span>
        <span class="lg-swatch" style="background:${esc(c.hex)}"></span>
        <span class="lg-main"><b>${esc(c.code)} ${esc(name)}</b><em>${esc(zh ? c.en || "" : c.hex)}</em></span>
        <button class="lg-more" type="button" data-replace="${idx}" aria-label="${esc(t("legend.replace", c.code))}">⋯</button>
        <span class="lg-count">${c.count}</span>
      </li>`;
      })
      .join("");
    list.scrollTop = scroll;
  }

  function updateStatus() {
    const p = state.pattern;
    if (!p) {
      $("#statusLeft").textContent = t("status.none");
      $("#statusRight").textContent = "";
      return;
    }
    const boards = state.board === 50 ? p.boards50 : p.boards29;
    $("#statusLeft").textContent = t(
      "status.summary",
      p.cols,
      p.rows,
      p.bead,
      p.total,
      boards,
      p.widthCm.toFixed(1),
      p.heightCm.toFixed(1),
    );
    if (state.hover && p) {
      const idx = p.cells[state.hover.r * p.cols + state.hover.c];
      if (idx >= 0) {
        const c = p.palette[idx];
        $("#statusRight").innerHTML =
          `<span><span class="swatch" style="background:${esc(c.hex)}"></span>(${state.hover.c}, ${state.hover.r}) ${esc(c.char)} · ${esc(c.code)} ${esc(nameOf(c))} · ${esc(t("unit.beads", c.count))}</span>`;
      } else {
        $("#statusRight").textContent = t("status.empty", state.hover.c, state.hover.r);
      }
    } else {
      $("#statusRight").textContent =
        state.isolate !== null
          ? t("status.isolated", p.palette[state.isolate].code, nameOf(p.palette[state.isolate]))
          : t("status.hint");
    }
  }

  function refreshExports() {
    const on = !!state.pattern;
    ["#btnPng", "#btnCsv", "#btnJson", "#btnPrint"].forEach((s) => {
      $(s).disabled = !on;
    });
  }

  /* ---------------- Isolation and hover ---------------- */

  function setIsolate(idx) {
    state.isolate = state.isolate === idx ? null : idx;
    $$("#legendList .legend-row").forEach((row) => {
      row.setAttribute(
        "aria-pressed",
        String(state.isolate !== null && +row.dataset.idx === state.isolate),
      );
    });
    renderOverlayOnly();
    updateStatus();
  }

  function cellFromEvent(e) {
    const p = state.pattern;
    if (!p || !state.geo) return null;
    const rect = $("#baseCanvas").getBoundingClientRect();
    const x = e.clientX - rect.left - state.geo.pad;
    const y = e.clientY - rect.top - state.geo.pad;
    const c = Math.floor(x / state.geo.cell);
    const r = Math.floor(y / state.geo.cell);
    if (c < 0 || r < 0 || c >= p.cols || r >= p.rows) return null;
    return { r, c };
  }

  function onCanvasMove(e) {
    const cell = cellFromEvent(e);
    const tip = $("#tip");
    const prev = state.hover;
    if (!cell) {
      if (prev) {
        state.hover = null;
        renderOverlayOnly();
        updateStatus();
      }
      tip.hidden = true;
      return;
    }
    if (prev && prev.r === cell.r && prev.c === cell.c) {
      positionTip(e);
      return;
    }
    state.hover = cell;
    renderOverlayOnly();
    updateStatus();

    const p = state.pattern;
    const idx = p.cells[cell.r * p.cols + cell.c];
    if (idx < 0) {
      tip.hidden = true;
      return;
    }
    tip.innerHTML = tipHtml(p.palette[idx]);
    tip.hidden = false;
    positionTip(e);
  }

  function tipHtml(c) {
    return `<span class="tip-dot" style="background:${esc(c.hex)}"></span><b>${esc(c.char)}</b> · ${esc(c.code)} ${esc(nameOf(c))} · ${esc(t("unit.beads", c.count))}`;
  }

  /* The tip of the hovered cell again, in the current language. */
  function refreshTip() {
    const tip = $("#tip");
    const p = state.pattern;
    if (tip.hidden || !p || !state.hover) return;
    const idx = p.cells[state.hover.r * p.cols + state.hover.c];
    if (idx >= 0) tip.innerHTML = tipHtml(p.palette[idx]);
  }

  function positionTip(e) {
    const tip = $("#tip");
    if (tip.hidden) return;
    const inner = $("#canvasInner").getBoundingClientRect();
    const p = state.pattern;
    const cx = inner.left + state.geo.pad + (state.hover.c + 0.5) * state.geo.cell;
    const cy = inner.top + state.geo.pad + state.hover.r * state.geo.cell - 6;
    tip.style.left = cx - inner.left + "px";
    tip.style.top = cy - inner.top + "px";
    void p;
  }

  /* ---------------- Substitutes ---------------- */

  let replaceTarget = null;

  function openReplace(idx) {
    if (!state.pattern) return;
    replaceTarget = idx;
    renderReplace();
    $("#replaceDialog").showModal();
  }

  function renderReplace() {
    const p = state.pattern;
    if (!p || replaceTarget === null) return;
    const idx = replaceTarget;
    const from = p.palette[idx];
    const labFrom = PS.color.hexToLab(from.hex);
    const cands = p.palette
      .map((c, i) => ({ c, i, d: PS.color.deltaE2000(labFrom, PS.color.hexToLab(c.hex)) }))
      .filter((o) => o.i !== idx && (o.d < 42 || o.c.count > 0))
      .sort((a, b) => a.d - b.d)
      .slice(0, 8);
    $("#replaceTitle").textContent = t("replace.titleOf", from.code, nameOf(from));
    $("#replaceIntro").textContent = t("replace.intro", from.count);
    $("#replaceList").innerHTML =
      cands
        .map(
          (o) => `
      <li><button type="button" data-to="${o.i}">
        <span class="lg-swatch" style="background:${esc(o.c.hex)}"></span>
        <span class="rp-name">${esc(o.c.code)} ${esc(nameOf(o.c))}</span>
        <span class="rp-de">ΔE ${o.d.toFixed(1)}</span>
      </button></li>`,
        )
        .join("") || `<li><span class="micro-note">${esc(t("replace.none"))}</span></li>`;
  }

  function recountPattern() {
    const p = state.pattern;
    const counts = new Int32Array(p.palette.length);
    let total = 0,
      empty = 0;
    for (let i = 0; i < p.cells.length; i++) {
      const v = p.cells[i];
      if (v < 0) empty++;
      else {
        counts[v]++;
        total++;
      }
    }
    p.palette.forEach((c, i) => {
      c.count = counts[i];
      c.char = "";
    });
    const used = [];
    for (let i = 0; i < counts.length; i++) if (counts[i] > 0) used.push(i);
    used.sort((a, b) => counts[b] - counts[a]);
    used.forEach((i, order) => {
      p.palette[i].char = PS.engine.CHARS[order % PS.engine.CHARS.length];
      p.palette[i].order = order;
    });
    p.used = used.map((i) => p.palette[i]);
    p.total = total;
    p.empty = empty;
    p.colorCount = used.length;
  }

  function applyReplace(to) {
    const p = state.pattern;
    if (!p || replaceTarget === null) return;
    const from = replaceTarget;
    if (from === to) return;
    for (let i = 0; i < p.cells.length; i++) if (p.cells[i] === from) p.cells[i] = to;
    recountPattern();
    state.isolate = null;
    render();
    updateStats();
    updateLegend();
    updateStatus();
    $("#replaceDialog").close();
    toast(t("toast.replaced", p.palette[to].code, nameOf(p.palette[to]), p.palette[from].code));
    replaceTarget = null;
  }

  /* ---------------- Palette dialog ---------------- */

  let draft = null;

  function openPaletteDialog() {
    const id = state.settings.palette;
    draft = activeColors(id).map((c) => ({ ...c }));
    $("#palettePick").value = id;
    $("#onlyAvailable").checked = state.onlyAvailable;
    renderPaletteNote();
    renderPaletteList();
    $("#paletteDialog").showModal();
  }

  /* What the chosen palette is; an imported one has no note. */
  function renderPaletteNote() {
    const note = paletteMeta($("#palettePick").value || state.settings.palette).note || "";
    $("#paletteNote").textContent = note;
    $("#paletteNote").hidden = !note;
  }

  function renderPaletteList() {
    if (!draft) return;
    // Built from the draft, which every edit updates, so a language switch keeps unsaved edits.
    const scroll = $("#paletteList").scrollTop;
    $("#paletteList").innerHTML =
      draft
        .map(
          (c, i) => `
      <li class="${c.off ? "pal-off" : ""}">
        <input type="color" value="${esc(c.hex)}" data-i="${i}" aria-label="${esc(t("palDlg.colorValue", c.code))}">
        <span class="pal-code">${esc(c.code)}</span>
        <span class="pal-name">${esc(nameOf(c))}</span>
        <span class="pal-hex">${esc(c.hex)}</span>
        <label class="switch" title="${esc(t("palDlg.inStock"))}">
          <input type="checkbox" data-avail="${i}" ${c.off ? "" : "checked"} aria-label="${esc(t("palDlg.inStockOf", c.code))}">
        </label>
      </li>`,
        )
        .join("") +
      `
      <li class="pal-hex" style="grid-column: 1 / -1; padding: 7px 10px; color: var(--fg-faint)">
        ${esc(t("palDlg.footer", draft.length))}
      </li>`;
    $("#paletteList").scrollTop = scroll;
  }

  function applyPaletteDraft() {
    const id = state.settings.palette;
    if (state.customPalettes[id]) state.customPalettes[id].colors = draft.map((c) => ({ ...c }));
    else state.palettes[id] = draft.map((c) => ({ ...c }));
    save();
    refreshPaletteSelect();
    syncControls();
    generate();
  }

  /* ---------------- Samples ---------------- */

  function demoCanvas(kind) {
    const S = 384;
    const cv = document.createElement("canvas");
    cv.width = S;
    cv.height = S;
    const g = cv.getContext("2d");

    if (kind === "star") {
      const bg = g.createLinearGradient(0, 0, S, S);
      bg.addColorStop(0, "#0c1b46");
      bg.addColorStop(1, "#20357d");
      g.fillStyle = bg;
      g.fillRect(0, 0, S, S);
      // a few small stars
      const dots = [
        [44, 56],
        [330, 86],
        [66, 318],
      ];
      dots.forEach(([x, y], i) => {
        g.fillStyle = i % 2 ? "#fff3b0" : "#ffffff";
        g.beginPath();
        g.arc(x, y, 7, 0, Math.PI * 2);
        g.fill();
      });
      g.save();
      g.translate(S / 2, S / 2 + 10);
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 140 : 58;
        const a = (Math.PI / 5) * i - Math.PI / 2;
        const x = Math.cos(a) * r,
          y = Math.sin(a) * r;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.closePath();
      g.fillStyle = "#f6c453";
      g.fill();
      g.lineWidth = 7;
      g.strokeStyle = "#e0a100";
      g.stroke();
      g.restore();
      return cv;
    }

    // heart
    const bg = g.createLinearGradient(0, 0, S, S);
    bg.addColorStop(0, "#dff1ff");
    bg.addColorStop(0.55, "#f7e6ff");
    bg.addColorStop(1, "#ffe4ec");
    g.fillStyle = bg;
    g.fillRect(0, 0, S, S);
    g.save();
    g.translate(S / 2, S / 2 - 6);
    g.scale(9.4, 9.4);
    g.beginPath();
    for (let t = 0; t <= Math.PI * 2 + 0.02; t += 0.02) {
      const x = 16 * Math.pow(Math.sin(t), 3);
      const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      t ? g.lineTo(x, -y) : g.moveTo(x, -y);
    }
    g.closePath();
    g.fillStyle = "#e2231a";
    g.fill();
    g.lineWidth = 0.85;
    g.strokeStyle = "#8e2b34";
    g.stroke();
    g.restore();
    return cv;
  }

  function loadDemo(kind) {
    const demo = kind === "star" ? "star" : "heart";
    const cv = demoCanvas(demo);
    state.img = cv;
    state.demo = demo;
    state.imgName = "";
    state.imgBytes = 0;
    state.imgSize = { w: cv.width, h: cv.height };
    $("#thumb").src = cv.toDataURL("image/png");
    $("#fmeta").textContent = `${cv.width} × ${cv.height}`;
    showSource();
    $("#dropIdle").hidden = true;
    $("#dropPreview").hidden = false;
    $("#btnReset").disabled = false;
    $("#btnGenerate").disabled = false;
    $("#emptyState").hidden = true;
    analyzeImage();
  }

  function clearAll() {
    state.img = null;
    state.demo = null;
    state.imgName = "";
    state.imgBytes = 0;
    state.pattern = null;
    state.isolate = null;
    state.hover = null;
    state.metrics = null;
    state.rec = null;
    $("#file").value = "";
    $("#dropIdle").hidden = false;
    $("#dropPreview").hidden = true;
    $("#thumb").removeAttribute("src");
    $("#srcMeta").textContent = "";
    $("#btnReset").disabled = true;
    $("#btnGenerate").disabled = true;
    $("#emptyState").hidden = false;
    $("#canvasInner").hidden = true;
    $("#baseCanvas")
      .getContext("2d")
      .clearRect(0, 0, $("#baseCanvas").width, $("#baseCanvas").height);
    $("#overlayCanvas").hidden = true;
    updateStats();
    updateLegend();
    updateStatus();
    refreshExports();
    syncControls();
  }

  /* ---------------- Zoom ---------------- */

  function setZoom(z) {
    state.view.zoom = clamp(z, 0.4, 8);
    render();
  }

  /* ---------------- Events ---------------- */

  function bind() {
    /* Language */
    $("#btnLang").addEventListener("click", () => {
      PS.i18n.setLang(PS.i18n.lang() === "zh" ? "en" : "zh");
    });

    /* Theme */
    $("#btnTheme").addEventListener("click", () => {
      if (PS.host && PS.host.inWorkbench) return;
      const root = document.documentElement;
      applyTheme(root.dataset.theme === "dark" ? "light" : "dark");
      save();
      if (state.pattern) render();
    });

    /* Files */
    const drop = $("#drop");
    const fileInput = $("#file");
    drop.addEventListener("click", () => fileInput.click());
    drop.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        fileInput.click();
      }
    });
    fileInput.addEventListener("change", () => {
      if (fileInput.files[0]) readFile(fileInput.files[0]);
    });

    ["dragenter", "dragover"].forEach((ev) =>
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        e.stopPropagation();
        drop.classList.add("is-over");
      }),
    );
    ["dragleave", "drop"].forEach((ev) =>
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        e.stopPropagation();
        drop.classList.remove("is-over");
      }),
    );
    drop.addEventListener("drop", (e) => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) readFile(f);
    });
    window.addEventListener("dragover", (e) => e.preventDefault());
    window.addEventListener("drop", (e) => e.preventDefault());
    window.addEventListener("paste", (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const it of items) {
        if (it.type.indexOf("image") === 0) {
          const f = it.getAsFile();
          if (f) {
            readFile(f);
            e.preventDefault();
            return;
          }
        }
      }
    });

    $("#btnDemo").addEventListener("click", () => loadDemo("heart"));
    $("#btnDemoEmpty").addEventListener("click", () => loadDemo("heart"));
    $("#btnPickEmpty").addEventListener("click", () => fileInput.click());
    $("#btnReset").addEventListener("click", clearAll);

    /* Mode */
    $("#modeSeg").addEventListener("click", (e) => {
      const b = e.target.closest("[data-mode]");
      if (!b) return;
      state.mode = b.dataset.mode;
      if (state.mode === "quick" && state.rec) applyRec(state.rec);
      syncControls();
      save();
      if (state.img && state.mode === "quick") generate();
    });

    /* Size */
    $("#sizeSeg").addEventListener("click", (e) => {
      const b = e.target.closest("[data-size]");
      if (!b) return;
      const v = b.dataset.size;
      state.settings.sizeMode = v;
      if (v === "custom") {
        state.settings.cols = clamp(+$("#colsInput").value || 64, 4, 200);
        state.settings.rows = clamp(+$("#rowsInput").value || 64, 4, 200);
      } else {
        const n = +v;
        state.settings.cols = n;
        state.settings.rows = n;
      }
      syncControls();
      scheduleGenerate(60);
    });

    const customChange = () => {
      state.settings.cols = clamp(+$("#colsInput").value || 52, 4, 200);
      state.settings.rows = clamp(+$("#rowsInput").value || 52, 4, 200);
      state.settings.sizeMode = "custom";
      syncControls();
      scheduleGenerate(380);
    };
    $("#colsInput").addEventListener("change", customChange);
    $("#rowsInput").addEventListener("change", customChange);

    $("#selColors").addEventListener("change", (e) => {
      state.settings.colorLimit = +e.target.value;
      syncControls();
      scheduleGenerate(60);
    });
    $("#selPalette").addEventListener("change", (e) => {
      state.settings.palette = e.target.value;
      refreshPaletteSelect();
      syncControls();
      scheduleGenerate(60);
    });
    $("#selSample").addEventListener("change", (e) => {
      state.settings.sample = e.target.value;
      scheduleGenerate(60);
    });
    $("#selSharp").addEventListener("change", (e) => {
      state.settings.sharp = +e.target.value ? 1 : 0;
      syncControls();
      scheduleGenerate(60);
    });
    $("#selFit").addEventListener("change", (e) => {
      state.settings.fit = e.target.value;
      scheduleGenerate(60);
    });

    $("#noiseSeg").addEventListener("click", (e) => {
      const b = e.target.closest("[data-noise]");
      if (!b) return;
      state.settings.noise = +b.dataset.noise;
      syncControls();
      scheduleGenerate(60);
    });
    $("#beadSeg").addEventListener("click", (e) => {
      const b = e.target.closest("[data-bead]");
      if (!b) return;
      state.settings.bead = +b.dataset.bead;
      syncControls();
      if (state.pattern) {
        state.pattern.bead = state.settings.bead;
        state.pattern.widthCm = (state.pattern.cols * state.settings.bead) / 10;
        state.pattern.heightCm = (state.pattern.rows * state.settings.bead) / 10;
        updateStats();
        updateStatus();
      }
      save();
    });
    $("#bgSeg").addEventListener("click", (e) => {
      const b = e.target.closest("[data-bg]");
      if (!b) return;
      state.settings.bg = b.dataset.bg;
      syncControls();
      scheduleGenerate(60);
    });
    $("#bgColor").addEventListener("input", (e) => {
      state.settings.bgColorHex = e.target.value.toUpperCase();
      $("#bgColorHex").textContent = state.settings.bgColorHex;
      scheduleGenerate(260);
    });

    $("#boardSeg").addEventListener("click", (e) => {
      const b = e.target.closest("[data-board]");
      if (!b) return;
      state.board = +b.dataset.board;
      $$("#boardSeg button").forEach((x) =>
        x.setAttribute("aria-pressed", String(+x.dataset.board === state.board)),
      );
      updateStats();
      updateStatus();
      save();
    });

    $("#btnGenerate").addEventListener("click", generate);
    $("#btnRegen").addEventListener("click", generate);

    /* View tools */
    $("#btnZoomIn").addEventListener("click", () => setZoom(state.view.zoom * 1.25));
    $("#btnZoomOut").addEventListener("click", () => setZoom(state.view.zoom / 1.25));
    $("#btnFit").addEventListener("click", () => {
      state.view.zoom = 1;
      render();
    });
    $$(".chip-toggle").forEach((btn) => {
      btn.addEventListener("click", () => {
        const k = btn.dataset.toggle;
        state.toggles[k] = !state.toggles[k];
        btn.setAttribute("aria-pressed", String(state.toggles[k]));
        save();
        if (state.pattern) render();
      });
    });
    $("#canvasScroll").addEventListener(
      "wheel",
      (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        setZoom(state.view.zoom * (e.deltaY < 0 ? 1.12 : 0.89));
      },
      { passive: false },
    );

    /* Canvas */
    const base = $("#baseCanvas");
    base.addEventListener("mousemove", onCanvasMove);
    base.addEventListener("mouseleave", () => {
      state.hover = null;
      $("#tip").hidden = true;
      renderOverlayOnly();
      updateStatus();
    });
    base.addEventListener("click", (e) => {
      const cell = cellFromEvent(e);
      if (!cell || !state.pattern) return;
      const idx = state.pattern.cells[cell.r * state.pattern.cols + cell.c];
      if (idx < 0) {
        if (state.isolate !== null) setIsolate(state.isolate);
        return;
      }
      setIsolate(idx);
    });

    /* Legend */
    $("#legendList").addEventListener("click", (e) => {
      const more = e.target.closest("[data-replace]");
      if (more) {
        e.stopPropagation();
        openReplace(+more.dataset.replace);
        return;
      }
      const row = e.target.closest(".legend-row");
      if (row) setIsolate(+row.dataset.idx);
    });
    $("#legendList").addEventListener("keydown", (e) => {
      const row = e.target.closest(".legend-row");
      if (!row) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setIsolate(+row.dataset.idx);
      }
    });

    /* Exports */
    const reason = (err) => (err && err.message ? err.message : t("error.unknown"));
    const runExport = async (fn, okKey) => {
      if (!state.pattern) return;
      try {
        await fn(state.pattern);
        toast(t(okKey));
      } catch (err) {
        toast(t("toast.exportFailed", reason(err)));
      }
    };
    $("#btnPng").addEventListener("click", () =>
      runExport(PS.exporters.exportPng, "toast.pngStarted"),
    );
    $("#btnCsv").addEventListener("click", () =>
      runExport(PS.exporters.exportCsv, "toast.csvStarted"),
    );
    $("#btnJson").addEventListener("click", () =>
      runExport(PS.exporters.exportJson, "toast.jsonStarted"),
    );
    $("#btnPrint").addEventListener("click", async () => {
      if (!state.pattern) return;
      try {
        const r = await PS.exporters.exportPrint(state.pattern);
        toast(t(r === "new-tab" ? "toast.printTab" : "toast.printDownloaded"));
      } catch (err) {
        toast(t("toast.printFailed", reason(err)));
      }
    });

    /* Dialogs */
    $("#btnHelp").addEventListener("click", () => $("#helpDialog").showModal());
    $("#btnPalette").addEventListener("click", openPaletteDialog);

    $("#palettePick").addEventListener("change", (e) => {
      state.settings.palette = e.target.value;
      draft = activeColors(e.target.value).map((c) => ({ ...c }));
      renderPaletteNote();
      renderPaletteList();
    });
    $("#onlyAvailable").addEventListener("change", (e) => {
      state.onlyAvailable = e.target.checked;
      save();
    });
    $("#paletteList").addEventListener("input", (e) => {
      const t = e.target;
      if (t.type === "color" && t.dataset.i !== undefined) {
        const item = draft[+t.dataset.i];
        if (item) {
          item.hex = t.value.toUpperCase();
          const row = t.closest("li");
          if (row) row.classList.toggle("pal-off", !!item.off);
        }
      }
    });
    $("#paletteList").addEventListener("change", (e) => {
      const t = e.target;
      if (t.dataset.avail !== undefined) {
        const item = draft[+t.dataset.avail];
        if (item) {
          item.off = !t.checked;
          const row = t.closest("li");
          if (row) row.classList.toggle("pal-off", !!item.off);
        }
      }
    });
    $("#btnPaletteApply").addEventListener("click", () => {
      applyPaletteDraft();
      $("#paletteDialog").close();
      toast(t("toast.paletteApplied"));
    });
    $("#btnPaletteReset").addEventListener("click", () => {
      const id = state.settings.palette;
      if (state.customPalettes[id]) {
        toast(t("toast.customNoReset"));
        return;
      }
      delete state.palettes[id];
      draft = PS.palettes.base(id).colors.map((c) => ({ ...c }));
      renderPaletteList();
      save();
      toast(t("toast.paletteReset"));
    });

    $("#btnImport").addEventListener("click", () => {
      const text = $("#importText").value.trim();
      if (!text) {
        toast(t("toast.importEmpty"));
        return;
      }
      const colors = [];
      text.split(/\r?\n/).forEach((line) => {
        // A comma (ASCII or full-width) or a tab separates the fields.
        const parts = line
          .split(/[,，\t]/)
          .map((s) => s.trim())
          .filter(Boolean);
        if (parts.length < 3) return;
        const hex = parts[2].startsWith("#") ? parts[2] : "#" + parts[2];
        if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) return;
        colors.push({ code: parts[0], name: parts[1], en: "", hex: hex.toUpperCase() });
      });
      if (colors.length < 4) {
        toast(t("toast.importTooFew"));
        return;
      }
      const id = "custom-" + Date.now();
      state.customPalettes[id] = { name: t("palette.custom", colors.length), colors };
      state.settings.palette = id;
      save();
      refreshPaletteSelect();
      draft = activeColors(id).map((c) => ({ ...c }));
      $("#palettePick").value = id;
      renderPaletteNote();
      renderPaletteList();
      toast(t("toast.imported", colors.length));
    });

    $("#replaceList").addEventListener("click", (e) => {
      const b = e.target.closest("[data-to]");
      if (b) applyReplace(+b.dataset.to);
    });

    /* Keyboard */
    window.addEventListener("keydown", (e) => {
      const t = e.target;
      const typing =
        t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");
      if (typing || e.metaKey || e.ctrlKey) return;
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        setZoom(state.view.zoom * 1.25);
      } else if (e.key === "-") {
        e.preventDefault();
        setZoom(state.view.zoom / 1.25);
      } else if (e.key === "0") {
        e.preventDefault();
        state.view.zoom = 1;
        render();
      } else if (e.key === "g" || e.key === "G") {
        $('.chip-toggle[data-toggle="grid"]').click();
      } else if (e.key === "c" || e.key === "C") {
        $('.chip-toggle[data-toggle="coords"]').click();
      } else if (e.key === "Escape") {
        if ($("#replaceDialog").open || $("#paletteDialog").open || $("#helpDialog").open) return;
        if (state.isolate !== null) setIsolate(state.isolate);
      }
    });

    let resizeTimer = 0;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (state.pattern) render();
      }, 120);
    });
    $("#canvasScroll").addEventListener(
      "scroll",
      () => {
        $("#tip").hidden = true;
      },
      { passive: true },
    );
  }

  /* ---------------- Start-up ---------------- */

  function init() {
    applyStatic();
    PS.i18n.onChange(refreshLanguage);
    load();
    if (PS.host && PS.host.inWorkbench) {
      document.documentElement.dataset.wb = "1";
      PS.host.onScheme(() => {
        if (state.pattern) render();
      });
      PS.host.sync();
    }
    refreshPaletteSelect();
    bind();
    syncControls();
    updateStats();
    updateLegend();
    updateStatus();
    refreshExports();
    $("#overlayCanvas").hidden = true;

    const params = new URLSearchParams(location.search);
    if (params.get("theme") === "dark" || params.get("theme") === "light") {
      applyTheme(params.get("theme"));
    }
    if (
      params.get("palette") &&
      (PS.palettes.base(params.get("palette")) || state.customPalettes[params.get("palette")])
    ) {
      state.settings.palette = params.get("palette");
      refreshPaletteSelect();
      syncControls();
    }
    if (params.get("size")) {
      const n = clamp(+params.get("size") || 52, 4, 200);
      state.settings.cols = n;
      state.settings.rows = n;
      state.settings.sizeMode = [29, 40, 52, 76, 104].includes(n) ? String(n) : "custom";
      state.mode = "pro"; // a given size means pro mode, so the recommendation does not override it
      syncControls();
    }
    if (params.get("mode") === "pro") {
      state.mode = "pro";
      syncControls();
    }
    const open = params.get("open");
    if (open === "palette") setTimeout(openPaletteDialog, 50);
    if (open === "help") setTimeout(() => $("#helpDialog").showModal(), 50);
    if (open === "replace")
      setTimeout(() => {
        if (state.pattern) openReplace(state.pattern.palette.indexOf(state.pattern.used[0]));
      }, 400);

    if (params.get("sample")) {
      state.settings.sample = params.get("sample");
      state.mode = "pro";
    }
    if (params.get("noise")) {
      state.settings.noise = clamp(+params.get("noise"), 0, 3);
      state.mode = "pro";
    }
    if (params.get("bg")) {
      state.settings.bg = params.get("bg");
      state.mode = "pro";
    }
    if (params.get("sharp") === "0") {
      state.settings.sharp = 0;
      state.mode = "pro";
    }
    if (params.get("bead")) {
      state.settings.bead = +params.get("bead") || 5;
    }
    if (params.get("compare") === "1") {
      state.toggles.compare = true;
    }
    syncControls();

    const iso = params.get("isolate");
    if (iso)
      setTimeout(() => {
        if (!state.pattern) return;
        const c = state.pattern.used.find((x) => x.code.toLowerCase() === iso.toLowerCase());
        if (c) setIsolate(state.pattern.palette.indexOf(c));
      }, 300);

    const demo = params.get("demo");
    if (demo) {
      // A sample goes through the whole flow, recommendation and pattern included.
      setTimeout(() => loadDemo(demo), 30);
    } else if (state.fresh && !state.pattern) {
      // First open: a finished sample instead of an empty canvas.
      setTimeout(() => {
        if (!state.img && !state.pattern) loadDemo("heart");
      }, 60);
    }

    // Refit the pattern when the stage changes size.
    if (window.ResizeObserver) {
      let pending = false;
      const ro = new ResizeObserver(() => {
        if (!state.pattern || state.view.zoom !== 1 || pending) return;
        pending = true;
        requestAnimationFrame(() => {
          pending = false;
          render();
        });
      });
      ro.observe($("#canvasScroll"));
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
