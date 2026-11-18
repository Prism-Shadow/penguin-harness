const en = {
  title: "Image Studio",
  history: "History",
  new: "New brief",
  brief: "Image brief",
  prompt: "Describe the image",
  placeholder: "Subject, setting, style and any details to keep.",
  try: "Starting points",
  ratio: "Aspect ratio",
  model: "Project image model",
  generate: "Generate image",
  preview: "Preview",
  stop: "Cancel generation",
  idle: "Your image will appear here.",
  running: "Generating the image…",
  stopping: "Cancellation requested…",
  cancelled: "Generation cancelled.",
  failed: "The Session finished without an image.",
  disabled: "Enable an image generation plugin for this project to start a new image.",
  unconfigured: "Choose an image model in the project’s model settings.",
  unavailable: "Cannot load the project’s image settings.",
  requestFailed: "The request failed. Try again.",
  download: "Download",
  retrieval: "Cannot load the images from this Session.",
  ideas: [
    [
      "Product photo",
      "A studio photograph of a blue ceramic mug on warm linen, soft side light, uncluttered background.",
    ],
    [
      "Nature illustration",
      "A field-guide illustration of a puffin carrying fish, fine ink outlines and muted watercolors.",
    ],
    [
      "Poster background",
      "An abstract screen-printed poster background with overlapping circles, navy ink and terracotta paper. Leave space for a title.",
    ],
  ],
};
const zh = {
  title: "图像工作室",
  history: "历史记录",
  new: "新建创作",
  brief: "创作要求",
  prompt: "描述想要的图像",
  placeholder: "可以写主体、环境、风格和需要保留的细节。",
  try: "试试这些主题",
  ratio: "画幅比例",
  model: "项目图像模型",
  generate: "生成图像",
  preview: "预览",
  stop: "取消生成",
  idle: "生成的图像会出现在这里。",
  running: "正在生成图像…",
  stopping: "已请求取消…",
  cancelled: "已取消生成。",
  failed: "会话已结束，没有生成图像。",
  disabled: "请先为当前项目启用提供图像生成的插件，再开始创作。",
  unconfigured: "请先在项目模型设置中选择图像模型。",
  unavailable: "无法读取项目的图像设置。",
  requestFailed: "请求失败，请重试。",
  download: "下载",
  retrieval: "无法读取此次会话的图像。",
  ideas: [
    ["产品摄影", "一只蓝釉陶瓷杯放在暖色亚麻布上，柔和侧光，背景简洁，产品摄影。"],
    ["自然插画", "一只嘴里叼着小鱼的海鹦，自然图鉴插画，细致墨线，柔和水彩。"],
    ["海报背景", "丝网印刷风格的海报背景，用海军蓝墨和陶土色纸张叠印圆形，为标题留白。"],
  ],
};
let parentRoot;
try {
  if (window.parent !== window) parentRoot = window.parent.document.documentElement;
} catch {}
export const lang = (parentRoot?.lang || navigator.language).toLowerCase().startsWith("zh")
  ? "zh"
  : "en";
export const S = lang === "zh" ? zh : en;
function theme() {
  const dark = parentRoot
    ? parentRoot.classList.contains("dark") || parentRoot.dataset.theme === "dark"
    : matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.toggleAttribute("data-dark", dark);
}
theme();
if (parentRoot)
  new MutationObserver(theme).observe(parentRoot, {
    attributes: true,
    attributeFilter: ["class", "data-theme"],
  });
