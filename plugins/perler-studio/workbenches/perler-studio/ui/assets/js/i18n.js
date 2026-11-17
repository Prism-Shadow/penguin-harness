/* Interface language: Chinese or English.
 * The choice made with the page's language switch is saved under `perler.studio.lang` and wins;
 * without one the device language decides: a language tag starting with `zh` gives Chinese,
 * anything else English. Every interface string lives in the two flat dictionaries below, which
 * carry the same keys; a value is a string or a function of the arguments t() passes on. Colour
 * names are palette data and stay in palettes.js. This script loads before the other app scripts
 * and needs no DOM beyond document.documentElement.
 */
(function () {
  const PS = (window.PS = window.PS || {});
  const KEY = "perler.studio.lang";
  const HTML_LANG = { zh: "zh-CN", en: "en" };

  const plural = (n, one, many) => (Number(n) === 1 ? one : many);
  const beads = (n) => `${n} ${plural(n, "bead", "beads")}`;
  const colours = (n) => `${n} ${plural(n, "colour", "colours")}`;
  const boards = (n) => `${n} ${plural(n, "board", "boards")}`;

  const zh = {
    "doc.title": "拼豆创作工作台 · Perler Studio",
    "doc.description":
      "把任意图片转换成清晰、可施工的拼豆图纸：网格、图例、用量统计、板数与成品尺寸，全部在本地完成。",
    skip: "跳到图纸",
    "brand.name": "拼豆创作工作台",
    "brand.sub": "Perler Studio",
    "top.local": "本地处理 · 图片不上传",
    "top.palette": "色卡",
    "top.help": "说明",
    "top.theme": "切换深浅色主题",
    "lang.switch": "EN",
    "lang.switchLabel": "Switch to English",

    "left.label": "素材与参数",
    "src.title": "素材",
    "src.drop": "拖入图片或点击选择文件",
    "src.dropTitle": "拖入图片，或点击选择",
    "src.dropSub": "PNG / JPG / WebP · 也可以 Ctrl+V 直接粘贴",
    "src.thumb": "已选图片预览",
    "src.change": "更换",
    "src.demo": "试试示例",
    "src.reset": "清空",
    "src.sampleMeta": "示例",
    "src.untitled": "图片",
    "sample.heart": "示例 · 爱心",
    "sample.star": "示例 · 星星",

    "set.title": "参数",
    "mode.label": "设计模式",
    "mode.quick": "快速生成",
    "mode.pro": "专业设计",
    "quick.idle": "上传图片后，我会先看画面内容，再推荐一套参数。",
    "quick.done": (detail, ratio) => `已按画面内容推荐：${detail}，比例 ${ratio}。`,
    "quick.detailHigh": "细节偏多",
    "quick.detailLow": "色块分明",
    "quick.detailMid": "细节适中",
    "quick.generate": "直接生成图纸",
    "quick.regenerate": "按推荐重新生成",
    "quick.hint": "不喜欢推荐？切到「专业设计」逐项调整。",
    "rec.colorsWhy": "颜色越少越好摆，越难还原过渡",
    "rec.sharpWhy": "缩小时保住轮廓与五官，避免糊成一团",
    "rec.finished": (w, h) => `成品约 ${w} × ${h} cm`,
    "rec.colorsAuto": (estimate) => `自动 · ${estimate}`,

    "reason.size.photo": "照片细节多，76 格够用又能控制豆量；要更细可在尺寸里选 104",
    "reason.size.29": "图形很简洁，29 格就认得出来，豆子最省",
    "reason.size.40": "主体简洁，40 格够用，比 52 格省一半豆子",
    "reason.size.52": "细节稍多，52 格能保住轮廓",
    "reason.palette.photo": "颜色层次多，需要更大的色板",
    "reason.palette.basic": "色块分明，基础 29 色刚好",
    "reason.sample.simple": "像插画/像素图，中心取样最不易串色",
    "reason.sample.photo": "照片用面积平均更接近真实观感",
    "reason.noise.photo": "照片会有零星杂点，中度合并扫干净",
    "reason.noise.simple": "本来就是纯色块，不需要合并",
    "reason.noise.other": "轻微合并，去掉孤立单颗",
    "reason.bg.auto": "四周边框颜色很一致，可以先去掉背景",
    "reason.bg.empty": "图片自带透明区域，直接留空",
    "reason.bg.keep": "背景是画面的一部分，保留",

    "size.label": "图纸尺寸",
    "size.value": (cols, rows) => `${cols} × ${rows} 格`,
    "size.custom": "自定义",
    "size.cols": "列",
    "size.rows": "行",
    "size.info": (n, w, h) => `${n} 颗 · 成品 ${w} × ${h} cm`,
    "size.hint": "格子越少越省豆：29 格约 841 颗，40 格约 1600 颗。照片建议 76，细节再多才用 104。",
    "colors.label": "颜色数量",
    "colors.auto": "自动",
    "colors.full": "用满色卡",
    "colors.upTo": (n) => `最多 ${n} 色`,
    "colors.estimate": (n) => `最多 ${n} 色`,
    "colors.opt.auto": "自动推荐",
    "colors.opt.12": "精简 · 最多 12 色",
    "colors.opt.18": "少 · 最多 18 色",
    "colors.opt.29": "适中 · 最多 29 色",
    "colors.opt.40": "较多 · 最多 40 色",
    "colors.opt.64": "多 · 最多 64 色",
    "colors.opt.96": "用满色卡 · 最多 96 色",
    "colors.hintShort": (n) => `当前色卡只有 ${n} 色，实际最多 ${n} 色。`,
    "colors.hintAuto": (cols, budget, n) => `自动：${cols} 格最多 ${budget} 色（色卡共 ${n} 色）。`,
    "palette.label": "色卡体系",
    "palette.hama.name": "基础 29 色（参照 Hama 色号）",
    "palette.hama.short": "基础 · 29 色",
    "palette.hama.note":
      "色号参照 Hama 的色号编号，仅为方便对照采购；本应用与 Hama 无关联，也未获其认可，Hama 是其所有者的商标。屏幕色值为近似值。",
    "palette.universal.name": "通用 96 色（自建）",
    "palette.universal.short": "通用 · 96 色",
    "palette.universal.note":
      "自建均衡色卡（96 色），肤色、灰阶与过渡齐备，适合照片类图像，可对照任意品牌近似采购。",
    "palette.pastel.name": "马卡龙 40 色（自建）",
    "palette.pastel.short": "马卡龙 · 40 色",
    "palette.pastel.note": "自建低饱和色卡，柔和插画、宠物、小清新题材更耐看。",
    "palette.custom": (n) => `自定义色卡 · ${n} 色`,
    "sample.label": "取色方式",
    "sample.area": "面积平均",
    "sample.center": "中心点取样",
    "sample.mode": "众数",
    "sample.median": "中位数",
    "noise.label": "杂色合并",
    "noise.0": "无",
    "noise.1": "轻",
    "noise.2": "中",
    "noise.3": "强",
    "sharp.label": "轮廓增强",
    "sharp.auto": "自动",
    "sharp.off": "关闭",
    "sharp.optAuto": "自动（推荐）",
    "sharp.hint": "缩小时边缘会被抹平，自动增强能把轮廓、五官重新拉开；追求原图柔和感时可以关掉。",
    "bead.label": "拼豆规格",
    "bg.label": "背景处理",
    "bg.auto": "自动去背",
    "bg.keep": "保留",
    "bg.solid": "纯色替换",
    "bg.empty": "透明留空",
    "bg.color": "替换色",
    "fit.label": "构图",
    "fit.cover": "裁切铺满（推荐）",
    "fit.contain": "完整留白",
    regen: "重新生成图纸",

    "stage.label": "图纸预览",
    "zoom.out": "缩小",
    "zoom.in": "放大",
    "zoom.fit": "适应",
    "view.grid": "网格",
    "view.bead": "豆形",
    "view.coords": "坐标",
    "view.compare": "原图对照",
    "canvas.label": "拼豆图纸网格",
    "empty.title": "一张图片，变成可施工的图纸",
    "empty.sub": "本地换算成配色网格，给出每色颗数、拼板数量与成品尺寸。",
    "empty.pick": "选择图片",
    "empty.demo": "用示例试试",
    "empty.hint": "支持 29 / 40 / 52 / 76 / 104 格与自定义 4–200 格",
    "busy.matching": "正在换算颜色…",
    "status.none": "还没有图纸",
    "status.summary": (cols, rows, bead, total, n, w, h) =>
      `${cols} × ${rows} 格 · ${bead}mm · ${total} 颗 · 拼板 ${n} 块 · ${w} × ${h} cm`,
    "status.empty": (c, r) => `(${c}, ${r}) 留空`,
    "status.isolated": (code, name) => `已隔离 ${code} ${name} · 点空白处取消`,
    "status.hint": "点击格子可隔离同色 · 开启「原图对照」检查还原度",
    "unit.beads": (n) => `${n} 颗`,
    "unit.colours": (n) => `${n} 色`,

    "right.label": "统计与图例",
    "stats.title": "用量统计",
    "stats.total": "总颗数",
    "stats.colors": "颜色种数",
    "stats.boards": "所需拼板",
    "stats.size": "成品尺寸",
    "stats.unitBeads": "颗",
    "stats.unitColors": "色",
    "stats.unitBoards": "块",
    "board.label": "按拼板",
    "board.aria": "拼板规格",
    "legend.title": "图例与用量",
    "legend.char": "字符",
    "legend.main": "色号 / 色名",
    "legend.count": "颗数",
    "legend.empty": "生成图纸后，这里按用量从多到少列出每一种颜色。",
    "legend.hint": "点击一行可在图上隔离该颜色；行尾「⋯」可把缺货色替换成最接近的颜色。",
    "legend.side": (n, total) => `${n} 色 · ${total} 颗`,
    "legend.rowTitle": (code, name) => `点击在图上隔离 ${code} ${name}`,
    "legend.replace": (code) => `替换 ${code}`,
    "export.title": "导出",
    "export.png": "PNG 图纸",
    "export.pngSub": "带网格与图例",
    "export.csv": "CSV 数据",
    "export.csvSub": "x,y,色号,hex",
    "export.jsonSub": "完整图纸数据",
    "export.print": "打印页",
    "export.printSub": "A4 分页排版",
    "export.note":
      "色号取自常用色卡编号，配色值为屏幕近似。若与手上实物有差异，可在顶部「色卡」里校准，校准结果会保存在本机。",

    "toast.notImage": "请选择图片文件（PNG / JPG / WebP）",
    "toast.tooBig": "图片超过 24 MB，先压缩一下再试",
    "toast.unreadable": "这张图片读不出来，换一张试试",
    "toast.readFailed": "读取文件失败",
    "toast.needPicture": "先上传一张图片，或点「试试示例」",
    "toast.genFailed": (msg) => `生成失败：${msg}`,
    "toast.generated": (cols, rows, total, n) => `已生成 ${cols} × ${rows} · ${total} 颗 · ${n} 色`,
    "toast.replaced": (toCode, toName, fromCode) => `已用 ${toCode} ${toName} 替换 ${fromCode}`,
    "toast.pngStarted": "PNG 图纸已开始下载",
    "toast.csvStarted": "CSV 已开始下载",
    "toast.jsonStarted": "JSON 已开始下载",
    "toast.printTab": "打印页已在新标签打开",
    "toast.printDownloaded": "新窗口被拦截，打印页已下载",
    "toast.exportFailed": (msg) => `导出失败：${msg}`,
    "toast.printFailed": (msg) => `打印页生成失败：${msg}`,
    "toast.paletteApplied": "色卡已更新，图纸已重算",
    "toast.customNoReset": "自定义色卡无法恢复内置值，请重新导入",
    "toast.paletteReset": "已恢复内置色值",
    "toast.importEmpty": "先粘贴几行色号",
    "toast.importTooFew": "至少需要 4 个有效颜色（色号,色名,hex）",
    "toast.imported": (n) => `已导入 ${n} 色`,
    "error.unknown": "未知错误",
    "error.canvasExport": "画布导出失败",

    "dlg.close": "关闭",
    "replace.title": "替换缺货色",
    "replace.titleOf": (code, name) => `替换 ${code} ${name}`,
    "replace.intro": (n) => `${n} 颗缺货时的替代方案，ΔE 越小越接近。`,
    "replace.none": "色卡里没有合适的近似色。",
    "palDlg.title": "色卡校准",
    "palDlg.pick": "选择色卡",
    "palDlg.onlyAvailable": "只用「有货」的颜色",
    "palDlg.colorValue": (code) => `${code} 颜色值`,
    "palDlg.inStock": "有货",
    "palDlg.inStockOf": (code) => `${code} 有货`,
    "palDlg.footer": (n) => `${n} 色 · 取消勾选即标记缺货，生成时跳过`,
    "palDlg.import": "导入自己的色卡",
    "palDlg.reset": "恢复内置色值",
    "palDlg.apply": "应用并重算",
    "import.hintA": "每行一条：",
    "import.format": "色号,色名,hex",
    "import.hintB": "，例如 ",
    "import.example": "H05,红,#E8262A",
    "import.hintC": "。导入后会作为「自定义色卡」出现在列表里。",
    "import.placeholder": "H05,红,#E8262A\nH01,白,#FFFFFF",
    "import.button": "导入为自定义色卡",

    "help.title": "怎么用",
    "help.s1.title": "上传图片。",
    "help.s1.body": "拖入、点选或 Ctrl+V 粘贴，图片只在浏览器内处理，不会上传到任何服务器。",
    "help.s2.title": "选模式。",
    "help.s2.body":
      "「快速生成」会先分析画面，再推荐尺寸、色数、取色方式与背景处理；「专业设计」逐项可调，改完自动重算。",
    "help.s3.title": "看图纸。",
    "help.s3.body":
      "按住 Ctrl 滚动滚轮缩放，「适应」回到全图，点图例里的一行可隔离该颜色，开启「原图对照」检查主体是否还原。",
    "help.s4.title": "核对统计。",
    "help.s4.a": "每色颗数之和等于总颗数；拼板数按 ",
    "help.s4.formula": "ceil(列/29) × ceil(行/29)",
    "help.s4.b": " 计算，成品尺寸 = 格数 × 拼豆规格。",
    "help.s5.title": "导出发货。",
    "help.s5.body":
      "PNG 带网格与图例可打印，CSV 适合称重备料，JSON 便于二次编辑，打印页按 A4 分页。",
    "help.codes.title": "关于色号",
    "help.codes.a":
      "内置色卡编号取自常用色卡资料，屏幕色值为近似值。要用于真实采购，建议先在「色卡」里对照手上的实物微调 hex，或用 ",
    "help.codes.b": " 导入你自己的色卡。",
    "help.hama":
      "「基础 29 色」的色号参照 Hama 的色号编号，仅为方便对照采购；本应用与 Hama 无关联，也未获其认可，Hama 是其所有者的商标。",
    "help.keys.title": "快捷键",
    "help.keys.zoom": "缩放",
    "help.keys.fit": "适应窗口",
    "help.keys.grid": "网格",
    "help.keys.coords": "坐标",
    "help.keys.esc": "取消隔离 / 关闭弹窗",

    "export.app": "拼豆创作工作台 · Perler Studio",
    "png.title": "拼豆图纸",
    "png.meta": (cols, rows, bead, total, n, w, h, boards29) =>
      `${cols} × ${rows} 格   ·   ${bead} mm   ·   ${total} 颗   ·   ${n} 色   ·   ${w} × ${h} cm   ·   拼板 ${boards29} 块（29×29）`,
    "png.legend": "图例与用量",
    "png.footer": (stamp) =>
      `拼豆创作工作台 · Perler Studio   ·   ${stamp}   ·   色号为常用色卡编号，屏幕色值为近似`,
    "print.title": (cols, rows) => `拼豆图纸 ${cols}×${rows}`,
    "print.button": "打印 / 存为 PDF",
    "print.heading": "拼豆图纸 · 图例、坐标与用量",
    "print.meta": (cols, rows, bead, total, n, w, h, boards29) =>
      `${cols} × ${rows} 格 · ${bead}mm · 共 ${total} 颗 · ${n} 色 · 成品 ${w} × ${h} cm · 拼板 ${boards29} 块（29×29）`,
    "print.grid": "网格（字符对应右侧图例，每 5 格加粗编号）",
    "print.legend": "图例与用量",
    "print.tips": "制作提示",
    "print.tip1": "从行号 0 开始逐行摆放，每 5 行核对一次位置。",
    "print.tip2": "先摆深色与轮廓，再填大面积浅色，最后补零散点缀。",
    "print.tip3": "熨烫前用书压平，避免豆子位移。",
    "print.footer": (stamp) =>
      `拼豆创作工作台 · Perler Studio · ${stamp} · 色号为常用色卡编号，屏幕色值为近似，采购前请对照实物色卡。`,
  };

  const en = {
    "doc.title": "Perler Studio",
    "doc.description":
      "Turn any picture into a clear perler bead pattern you can build from: the grid, the legend, the bead counts, the boards and the finished size, all worked out on your device.",
    skip: "Skip to the pattern",
    "brand.name": "Perler Studio",
    "brand.sub": "Bead patterns",
    "top.local": "Processed locally · picture not uploaded",
    "top.palette": "Palette",
    "top.help": "Help",
    "top.theme": "Switch between light and dark",
    "lang.switch": "中文",
    "lang.switchLabel": "切换为中文",

    "left.label": "Picture and settings",
    "src.title": "Picture",
    "src.drop": "Drop a picture or click to choose a file",
    "src.dropTitle": "Drop a picture, or click to choose",
    "src.dropSub": "PNG / JPG / WebP · or paste with Ctrl+V",
    "src.thumb": "Preview of the chosen picture",
    "src.change": "Change",
    "src.demo": "Try a sample",
    "src.reset": "Clear",
    "src.sampleMeta": "Sample",
    "src.untitled": "Picture",
    "sample.heart": "Sample · Heart",
    "sample.star": "Sample · Star",

    "set.title": "Settings",
    "mode.label": "Design mode",
    "mode.quick": "Quick",
    "mode.pro": "Pro",
    "quick.idle": "Add a picture and the app looks at it first, then suggests a set of settings.",
    "quick.done": (detail, ratio) =>
      `Suggested from the picture: ${detail}, aspect ratio ${ratio}.`,
    "quick.detailHigh": "lots of detail",
    "quick.detailLow": "clear colour blocks",
    "quick.detailMid": "moderate detail",
    "quick.generate": "Generate pattern",
    "quick.regenerate": "Regenerate as suggested",
    "quick.hint": "Not what you want? Switch to Pro and set each one yourself.",
    "rec.colorsWhy": "Fewer colours are easier to place but show gradients less well",
    "rec.sharpWhy": "Keeps outlines and faces from blurring when scaled down",
    "rec.finished": (w, h) => `Finished about ${w} × ${h} cm`,
    "rec.colorsAuto": (estimate) => `Auto · ${estimate}`,

    "reason.size.photo":
      "Photos carry a lot of detail; 76 is enough and keeps the bead count down. Pick 104 for finer detail",
    "reason.size.29": "A simple shape still reads at 29, with the fewest beads",
    "reason.size.40": "A simple subject fits in 40, with about half the beads of 52",
    "reason.size.52": "Some detail; 52 keeps the outline",
    "reason.palette.photo": "Many shades need a bigger palette",
    "reason.palette.basic": "Clear colour blocks; Basic 29 is just right",
    "reason.sample.simple":
      "Looks like an illustration or pixel art; centre sampling bleeds colours least",
    "reason.sample.photo": "Area averaging looks closest to a photo",
    "reason.noise.photo": "Photos have stray specks; medium merging clears them",
    "reason.noise.simple": "Already solid colour blocks; no merging needed",
    "reason.noise.other": "Light merging removes lone beads",
    "reason.bg.auto": "The border is one even colour, so the background can go",
    "reason.bg.empty": "The picture has transparent areas; they stay empty",
    "reason.bg.keep": "The background is part of the picture; keep it",

    "size.label": "Grid size",
    "size.value": (cols, rows) => `${cols} × ${rows}`,
    "size.custom": "Custom",
    "size.cols": "Columns",
    "size.rows": "Rows",
    "size.info": (n, w, h) => `${beads(n)} · finished ${w} × ${h} cm`,
    "size.hint":
      "Fewer cells take fewer beads: 29 is about 841 beads, 40 about 1,600. For photos start at 76; use 104 only for fine detail.",
    "colors.label": "Colours",
    "colors.auto": "Auto",
    "colors.full": "Full palette",
    "colors.upTo": (n) => `Up to ${colours(n)}`,
    "colors.estimate": (n) => `up to ${colours(n)}`,
    "colors.opt.auto": "Auto (suggested)",
    "colors.opt.12": "Minimal · up to 12 colours",
    "colors.opt.18": "Few · up to 18 colours",
    "colors.opt.29": "Moderate · up to 29 colours",
    "colors.opt.40": "More · up to 40 colours",
    "colors.opt.64": "Many · up to 64 colours",
    "colors.opt.96": "Full palette · up to 96 colours",
    "colors.hintShort": (n) => `This palette has only ${colours(n)}, so at most ${n} are used.`,
    "colors.hintAuto": (cols, budget, n) =>
      `Auto: up to ${colours(budget)} at ${cols} cells (the palette has ${n}).`,
    "palette.label": "Palette",
    "palette.hama.name": "Basic 29 (Hama colour numbers)",
    "palette.hama.short": "Basic · 29",
    "palette.hama.note":
      "The codes follow Hama's colour numbers only to make matching beads easy to buy. This app is neither affiliated with nor endorsed by Hama; Hama is a trademark of its owner. Screen colours are approximations.",
    "palette.universal.name": "General 96 (in-house)",
    "palette.universal.short": "General · 96",
    "palette.universal.note":
      "A balanced in-house palette of 96 colours with skin tones, greys and in-between shades. It suits photos and maps roughly onto any brand when you buy.",
    "palette.pastel.name": "Pastel 40 (in-house)",
    "palette.pastel.short": "Pastel · 40",
    "palette.pastel.note":
      "An in-house palette of soft, low-saturation colours for gentle illustrations, pets and light, airy subjects.",
    "palette.custom": (n) => `Custom palette · ${colours(n)}`,
    "sample.label": "Sampling",
    "sample.area": "Area average",
    "sample.center": "Centre point",
    "sample.mode": "Most common",
    "sample.median": "Median",
    "noise.label": "Noise merging",
    "noise.0": "None",
    "noise.1": "Light",
    "noise.2": "Medium",
    "noise.3": "Strong",
    "sharp.label": "Edge boost",
    "sharp.auto": "Auto",
    "sharp.off": "Off",
    "sharp.optAuto": "Auto (recommended)",
    "sharp.hint":
      "Shrinking a picture blurs its edges; Auto pulls outlines and faces apart again. Turn it off to keep the softness of the original.",
    "bead.label": "Bead size",
    "bg.label": "Background",
    "bg.auto": "Remove",
    "bg.keep": "Keep",
    "bg.solid": "Fill",
    "bg.empty": "Transparent",
    "bg.color": "Fill colour",
    "fit.label": "Framing",
    "fit.cover": "Crop to fill (recommended)",
    "fit.contain": "Fit with margins",
    regen: "Regenerate pattern",

    "stage.label": "Pattern preview",
    "zoom.out": "Zoom out",
    "zoom.in": "Zoom in",
    "zoom.fit": "Fit",
    "view.grid": "Grid",
    "view.bead": "Beads",
    "view.coords": "Coordinates",
    "view.compare": "Compare",
    "canvas.label": "Bead pattern grid",
    "empty.title": "Turn a picture into a pattern you can build",
    "empty.sub":
      "Worked out on your device as a colour grid, with the beads of each colour, the boards and the finished size.",
    "empty.pick": "Choose a picture",
    "empty.demo": "Try a sample",
    "empty.hint": "Grids of 29 / 40 / 52 / 76 / 104, or any size from 4 to 200",
    "busy.matching": "Matching colours…",
    "status.none": "No pattern yet",
    "status.summary": (cols, rows, bead, total, n, w, h) =>
      `${cols} × ${rows} · ${bead}mm · ${beads(total)} · ${boards(n)} · ${w} × ${h} cm`,
    "status.empty": (c, r) => `(${c}, ${r}) empty`,
    "status.isolated": (code, name) => `Isolated ${code} ${name} · Esc to clear`,
    "status.hint": "Click a cell to isolate its colour",
    "unit.beads": (n) => beads(n),
    "unit.colours": (n) => colours(n),

    "right.label": "Totals and legend",
    "stats.title": "Totals",
    "stats.total": "Beads",
    "stats.colors": "Colours",
    "stats.boards": "Boards",
    "stats.size": "Finished size",
    "stats.unitBeads": "",
    "stats.unitColors": "",
    "stats.unitBoards": "",
    "board.label": "Board size",
    "board.aria": "Board size",
    "legend.title": "Legend",
    "legend.char": "Symbol",
    "legend.main": "Code / name",
    "legend.count": "Beads",
    "legend.empty": "Once a pattern is made, every colour it uses is listed here, most used first.",
    "legend.hint":
      "Click a row to isolate that colour on the pattern; ⋯ at the end of a row swaps an out-of-stock colour for the closest one.",
    "legend.side": (n, total) => `${colours(n)} · ${beads(total)}`,
    "legend.rowTitle": (code, name) => `Click to isolate ${code} ${name} on the pattern`,
    "legend.replace": (code) => `Replace ${code}`,
    "export.title": "Export",
    "export.png": "PNG pattern",
    "export.pngSub": "With grid and legend",
    "export.csv": "CSV data",
    "export.csvSub": "x,y,code,hex",
    "export.jsonSub": "Full pattern data",
    "export.print": "Print page",
    "export.printSub": "Laid out for A4",
    "export.note":
      "The codes follow common bead charts and the colours are screen approximations. If they differ from your beads, calibrate them under Palette at the top; the calibration is saved.",

    "toast.notImage": "Choose an image file (PNG / JPG / WebP)",
    "toast.tooBig": "The picture is over 24 MB; make it smaller and try again",
    "toast.unreadable": "This picture can't be read; try another one",
    "toast.readFailed": "Could not read the file",
    "toast.needPicture": "Add a picture first, or click Try a sample",
    "toast.genFailed": (msg) => `Could not generate the pattern: ${msg}`,
    "toast.generated": (cols, rows, total, n) =>
      `Generated ${cols} × ${rows} · ${beads(total)} · ${colours(n)}`,
    "toast.replaced": (toCode, toName, fromCode) => `Replaced ${fromCode} with ${toCode} ${toName}`,
    "toast.pngStarted": "PNG pattern downloading",
    "toast.csvStarted": "CSV downloading",
    "toast.jsonStarted": "JSON downloading",
    "toast.printTab": "Print page opened in a new tab",
    "toast.printDownloaded": "The new tab was blocked, so the print page was downloaded",
    "toast.exportFailed": (msg) => `Export failed: ${msg}`,
    "toast.printFailed": (msg) => `Could not make the print page: ${msg}`,
    "toast.paletteApplied": "Palette updated and pattern regenerated",
    "toast.customNoReset": "A custom palette has no built-in colours to restore; import it again",
    "toast.paletteReset": "Built-in colours restored",
    "toast.importEmpty": "Paste a few colour lines first",
    "toast.importTooFew": "At least 4 valid colours are needed (code,name,hex)",
    "toast.imported": (n) => `Imported ${colours(n)}`,
    "error.unknown": "unknown error",
    "error.canvasExport": "The canvas could not be exported",

    "dlg.close": "Close",
    "replace.title": "Replace a missing colour",
    "replace.titleOf": (code, name) => `Replace ${code} ${name}`,
    "replace.intro": (n) =>
      `Substitutes for ${beads(n)} you are out of; the lower the ΔE, the closer.`,
    "replace.none": "The palette has no close colour.",
    "palDlg.title": "Calibrate palette",
    "palDlg.pick": "Choose a palette",
    "palDlg.onlyAvailable": "Use in-stock colours only",
    "palDlg.colorValue": (code) => `${code} colour value`,
    "palDlg.inStock": "In stock",
    "palDlg.inStockOf": (code) => `${code} in stock`,
    "palDlg.footer": (n) =>
      `${colours(n)} · untick a colour to mark it out of stock; generating skips it`,
    "palDlg.import": "Import your own palette",
    "palDlg.reset": "Restore built-in colours",
    "palDlg.apply": "Apply and regenerate",
    "import.hintA": "One colour per line: ",
    "import.format": "code,name,hex",
    "import.hintB": ", for example ",
    "import.example": "H05,Red,#E8262A",
    "import.hintC": ". The import appears in the palette list as a custom palette.",
    "import.placeholder": "H05,Red,#E8262A\nH01,White,#FFFFFF",
    "import.button": "Import as a custom palette",

    "help.title": "How to use it",
    "help.s1.title": "Add a picture. ",
    "help.s1.body":
      "Drag it in, click to choose it or paste it with Ctrl+V. The picture is processed only in your browser and never uploaded to any server.",
    "help.s2.title": "Pick a mode. ",
    "help.s2.body":
      "Quick looks at the picture first, then suggests the size, the number of colours, the sampling and the background; Pro lets you set each one and recomputes after every change.",
    "help.s3.title": "Read the pattern. ",
    "help.s3.body":
      "Hold Ctrl and scroll to zoom, and click Fit to see the whole pattern again; click a legend row to isolate that colour, and turn on Compare to check the subject against the original.",
    "help.s4.title": "Check the counts. ",
    "help.s4.a": "The counts per colour add up to the total. Boards are counted as ",
    "help.s4.formula": "ceil(columns / 29) × ceil(rows / 29)",
    "help.s4.b": ", and the finished size is cells × bead size.",
    "help.s5.title": "Export. ",
    "help.s5.body":
      "The PNG has the grid and legend and prints well, the CSV helps you weigh out beads, the JSON is for further editing, and the print page is laid out for A4.",
    "help.codes.title": "About the colour codes",
    "help.codes.a":
      "The built-in codes come from common bead charts, and the screen colours are approximations. Before you buy beads, compare them with the beads you have and adjust the hex values under Palette, or import your own palette as ",
    "help.codes.b": ".",
    "help.hama":
      "The Basic 29 palette numbers its colours after Hama's colour chart only to make matching beads easy to buy. This app is neither affiliated with nor endorsed by Hama; Hama is a trademark of its owner.",
    "help.keys.title": "Keyboard shortcuts",
    "help.keys.zoom": "Zoom",
    "help.keys.fit": "Fit to the window",
    "help.keys.grid": "Grid",
    "help.keys.coords": "Coordinates",
    "help.keys.esc": "Clear isolation / close a dialog",

    "export.app": "Perler Studio",
    "png.title": "Bead pattern",
    "png.meta": (cols, rows, bead, total, n, w, h, boards29) =>
      `${cols} × ${rows}   ·   ${bead} mm   ·   ${beads(total)}   ·   ${colours(n)}   ·   ${w} × ${h} cm   ·   ${boards(boards29)} (29×29)`,
    "png.legend": "Legend and counts",
    "png.footer": (stamp) =>
      `Perler Studio   ·   ${stamp}   ·   Codes follow common bead charts; screen colours are approximate`,
    "print.title": (cols, rows) => `Bead pattern ${cols}×${rows}`,
    "print.button": "Print / save as PDF",
    "print.heading": "Bead pattern · legend, coordinates and counts",
    "print.meta": (cols, rows, bead, total, n, w, h, boards29) =>
      `${cols} × ${rows} · ${bead}mm · ${beads(total)} · ${colours(n)} · finished ${w} × ${h} cm · ${boards(boards29)} (29×29)`,
    "print.grid": "Grid (symbols match the legend; every fifth column is numbered)",
    "print.legend": "Legend and counts",
    "print.tips": "Making tips",
    "print.tip1": "Place the beads row by row from row 0 and check your place every 5 rows.",
    "print.tip2":
      "Lay the dark colours and outlines first, then fill the large light areas, then add the scattered details.",
    "print.tip3": "Before ironing, press the beads flat under a book so they don't shift.",
    "print.footer": (stamp) =>
      `Perler Studio · ${stamp} · The codes follow common bead charts and the screen colours are approximate; compare with a real colour chart before you buy.`,
  };

  const strings = { zh, en };
  const own = Object.prototype.hasOwnProperty;

  function storage() {
    try {
      return typeof localStorage === "undefined" ? null : localStorage;
    } catch (e) {
      return null;
    }
  }

  function saved() {
    try {
      const store = storage();
      const value = store && store.getItem(KEY);
      return value === "zh" || value === "en" ? value : null;
    } catch (e) {
      return null;
    }
  }

  function device() {
    let tag = "";
    try {
      tag = (typeof navigator !== "undefined" && navigator && navigator.language) || "";
    } catch (e) {
      tag = "";
    }
    return /^zh/i.test(String(tag)) ? "zh" : "en";
  }

  let current = saved() || device();
  const listeners = [];

  function markDocument() {
    try {
      if (typeof document !== "undefined" && document && document.documentElement) {
        document.documentElement.lang = HTML_LANG[current];
      }
    } catch (e) {
      /* no document to mark */
    }
  }

  function lang() {
    return current;
  }

  function setLang(code) {
    if (code !== "zh" && code !== "en") return;
    current = code;
    try {
      const store = storage();
      if (store) store.setItem(KEY, code);
    } catch (e) {
      /* storage unavailable: the choice lasts for this page only */
    }
    markDocument();
    listeners.slice().forEach((fn) => {
      try {
        fn(code);
      } catch (e) {
        if (typeof console !== "undefined") console.error(e);
      }
    });
  }

  function t(key, ...args) {
    const other = current === "zh" ? "en" : "zh";
    let value;
    if (own.call(strings[current], key)) value = strings[current][key];
    else if (own.call(strings[other], key)) value = strings[other][key];
    else return String(key);
    if (typeof value !== "function") return String(value);
    try {
      return String(value(...args));
    } catch (e) {
      return String(key);
    }
  }

  function onChange(fn) {
    if (typeof fn === "function") listeners.push(fn);
  }

  markDocument();
  PS.i18n = { lang, setLang, t, onChange, strings };
})();
