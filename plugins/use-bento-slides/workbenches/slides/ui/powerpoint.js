// Bento uses pixels on a fixed canvas. PowerPoint uses inches and point sizes.
const unit = (px) => px / 96;
const color = (value, fallback) => (/^#[\da-f]{6}$/i.test(value) ? value.slice(1) : fallback);
const font = (family) =>
  family
    ?.split(",")[0]
    .replace(/["']/g, "")
    .replace(/system-ui|sans-serif/i, "Aptos") || "Aptos";
const content = (html) => {
  const t = document.createElement("template");
  t.innerHTML = String(html ?? "");
  return t.content;
};
function textRuns(html) {
  const out = [];
  function visit(node, style) {
    if (node.nodeType === Node.TEXT_NODE) {
      out.push({ text: node.nodeValue, options: style });
      return;
    }
    if (node.localName === "br") {
      out.push({ text: "\n", options: style });
      return;
    }
    if (["script", "style"].includes(node.localName)) return;
    const next = { ...style };
    if (["b", "strong"].includes(node.localName)) next.bold = true;
    if (["em", "i"].includes(node.localName)) next.italic = true;
    if (node.localName === "u") next.underline = true;
    for (const child of node.childNodes) visit(child, next);
    if (["p", "div"].includes(node.localName)) out.push({ text: "\n", options: style });
  }
  visit(content(html), {});
  return out;
}
const asset = (value, doc) =>
  String(value ?? "").startsWith("asset:") ? doc.assets?.[value.slice(6)] : value;
let vendor;
async function library() {
  if (!vendor)
    vendor = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "./vendor/pptxgen-4.0.1.bundle.js";
      script.onload = () => resolve(window.PptxGenJS);
      script.onerror = () => {
        vendor = null;
        script.remove();
        reject(new Error("PptxGenJS"));
      };
      document.head.append(script);
    });
  return vendor;
}
function addElement(ppt, slide, e, doc) {
  const box = {
    x: unit(e.x || 0),
    y: unit(e.y || 0),
    w: unit(e.w),
    h: unit(e.h),
    rotate: (e.rotation || 0) % 360,
  };
  const transparency = Math.round((1 - (e.opacity ?? 1)) * 100);
  const theme = doc.theme || {};
  if (e.type === "text") {
    slide.addText(textRuns(e.html), {
      ...box,
      margin: 0,
      breakLine: false,
      align: e.align,
      valign: e.valign === "middle" ? "mid" : e.valign || "top",
      fontFace: font(e.fontFamily || theme.fontFamily),
      fontSize: (e.fontSize || 24) * 0.75,
      bold: Number(e.fontWeight) >= 600,
      color: color(e.color, color(theme.color, "222222")),
      transparency,
    });
  } else if (e.type === "shape" && e.shape !== "path") {
    const shape = {
      rect: e.radius ? "roundRect" : "rect",
      ellipse: "ellipse",
      triangle: "triangle",
      arrow: "rightArrow",
      line: "line",
    }[e.shape || "rect"];
    if (!shape) return false;
    const fill = color(e.fillGradient?.stops?.[0]?.color || e.fill);
    const stroke = color(e.stroke, e.shape === "line" ? fill : undefined);
    slide.addShape(ppt.ShapeType[shape], {
      ...box,
      fill: fill ? { color: fill, transparency } : { transparency: 100 },
      line: stroke
        ? { color: stroke, width: (e.strokeWidth || 1) * 0.75, transparency }
        : { transparency: 100 },
    });
  } else if (e.type === "table") {
    const style = e.style || {};
    const rows = e.rows.map((r, index) =>
      r.cells.map((c) => ({
        text: textRuns(c.html),
        options: {
          align: c.align,
          bold: c.bold || (e.header && index === 0),
          color: color(
            c.color,
            index === 0 && e.header ? color(style.headerColor) : color(style.color),
          ),
          fill: {
            color: color(
              c.bg,
              index === 0 && e.header ? color(style.headerBg, "EAEAEA") : "FFFFFF",
            ),
          },
        },
      })),
    );
    slide.addTable(rows, {
      ...box,
      margin: 0.05,
      fontSize: (style.fontSize || 20) * 0.75,
      border: { type: "solid", color: color(style.borderColor, "CCCCCC"), pt: 1 },
      autoPage: false,
    });
  } else if (e.type === "chart") {
    const opt = e.option || {},
      series = opt.series || [];
    const groups = series.map((s) => {
      const data = s.data || [];
      const values = data.map((v) =>
        Number((typeof v === "object" && v !== null ? v.value : v) ?? 0),
      );
      const axis =
        (Array.isArray(opt.xAxis) ? opt.xAxis[0] : opt.xAxis)?.data ||
        (Array.isArray(opt.yAxis) ? opt.yAxis[0] : opt.yAxis)?.data;
      const labels = axis || data.map((v, i) => v?.name || String(i + 1));
      const type = { line: "line", bar: "bar", pie: "pie", scatter: "scatter", radar: "radar" }[
        s.type || e.preset
      ];
      if (!type || values.some((v) => !Number.isFinite(v))) return null;
      return {
        type,
        data: [{ name: s.name || "", labels, values }],
        options: { chartColors: [color(s.itemStyle?.color, color(theme.accent, "356B69"))] },
      };
    });
    if (!groups.length || groups.includes(null)) return false;
    slide.addChart(groups, {
      ...box,
      barDir: opt.yAxis?.type === "category" ? "bar" : "col",
      showLegend: !!opt.legend,
      showTitle: false,
      showCatName: false,
      catAxisLabelColor: color(opt.xAxis?.axisLabel?.color, "444444"),
      valAxisLabelColor: color(opt.yAxis?.axisLabel?.color, "444444"),
    });
  } else if (e.type === "image" || e.type === "svg" || e.type === "shape") {
    let data = asset(e.src || e.asset, doc);
    if (e.type === "svg" && doc.assets?.[e.asset]) data = doc.assets[e.asset];
    let markup = e.type === "svg" ? e.markup : null;
    if (e.type === "shape") {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", (e.pathBox || [0, 0, e.w, e.h]).join(" "));
      svg.setAttribute("xmlns", svg.namespaceURI);
      const path = document.createElementNS(svg.namespaceURI, "path");
      path.setAttribute("d", e.d || "");
      path.setAttribute("fill", e.fill || "none");
      path.setAttribute("stroke", e.stroke || "none");
      path.setAttribute("stroke-width", e.strokeWidth || 1);
      svg.append(path);
      markup = svg.outerHTML;
    }
    if (markup)
      data =
        "data:image/svg+xml;base64," +
        btoa(Array.from(new TextEncoder().encode(markup), (v) => String.fromCharCode(v)).join(""));
    if (!/^data:image\/(?:png|jpe?g|gif|svg\+xml);base64,/i.test(data)) return false;
    slide.addImage({ ...box, data, transparency });
  } else return false;
  return true;
}
export async function exportPowerPoint(doc) {
  const Constructor = await library();
  const ppt = new Constructor(),
    size = doc.size || { width: 1280, height: 720 };
  ppt.defineLayout({ name: "Bento", width: unit(size.width), height: unit(size.height) });
  ppt.layout = "Bento";
  ppt.title = doc.title;
  for (const s of doc.slides) {
    const slide = ppt.addSlide();
    slide.hidden = Boolean(s.hidden);
    slide.background = { color: color(s.background, color(doc.theme?.background, "FFFFFF")) };
    if (s.notes) slide.addNotes(s.notes);
    for (const e of s.elements || [])
      if (!addElement(ppt, slide, e, doc)) throw new Error("unsupportedPowerPoint");
  }
  return ppt.write({ outputType: "blob", compression: true });
}
