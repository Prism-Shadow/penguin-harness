/**
 * What `penguin tools` prints beside the model's own output, per language: option help and the
 * notices a run adds. Errors stay in English, as the server's do.
 */
const en = {
  text: "The text or instructions (the words are joined with spaces)",
  prompt: "What to generate (the words are joined with spaces)",
  query: "What to search for (the words are joined with spaces)",
  speech: "The text to speak (the words are joined with spaces)",
  url: "The http(s) URL of the page",
  runId: "The run's id",
  json: "Print the run as JSON",
  detach: "Return the run's id at once and let it finish in the Session",
  image: "The local image to read (PNG, JPEG, WebP or GIF)",
  question: "What to ask about the image (default: describe it)",
  audio: "The local recording to transcribe",
  mimeType: "The file's MIME type, when its extension does not say",
  count: "At most this many results",
  aspectRatio: "Aspect ratio: 1:1, 2:3, 3:2, 3:4, 4:3, 9:16, 16:9 or 21:9",
  imageResolution: "Resolution: 1K or 2K",
  videoResolution: "Resolution: 360p, 720p, 1080p or 4K",
  duration: "Length in whole seconds",
  voice: "The provider's voice name",
  out: "The local directory the generated files are saved in (default: the current one)",
  statusOut: "Also save the finished run's files in this local directory",
  stillRunning: (id: string) =>
    `The run is still going in its Session: check it with \`penguin tools status ${id}\`.\n`,
  noModel: "not bound",
  followsDefault: "(the default chat model)",
};

const zh: typeof en = {
  text: "文本或指令（多个词以空格连接）",
  prompt: "要生成的内容（多个词以空格连接）",
  query: "搜索内容（多个词以空格连接）",
  speech: "要朗读的文本（多个词以空格连接）",
  url: "网页的 http(s) 地址",
  runId: "任务 ID",
  json: "以 JSON 输出任务",
  detach: "立即返回任务 ID，任务在会话中继续完成",
  image: "要读取的本地图片（PNG、JPEG、WebP 或 GIF）",
  question: "对图片的提问（缺省为描述图片）",
  audio: "要转写的本地录音",
  mimeType: "文件的 MIME 类型，扩展名不足以判断时使用",
  count: "结果数量上限",
  aspectRatio: "画面宽高比：1:1、2:3、3:2、3:4、4:3、9:16、16:9 或 21:9",
  imageResolution: "分辨率：1K 或 2K",
  videoResolution: "分辨率：360p、720p、1080p 或 4K",
  duration: "时长（整秒）",
  voice: "服务商的音色名称",
  out: "保存生成文件的本地目录（缺省为当前目录）",
  statusOut: "同时把已完成任务的文件保存到这个本地目录",
  stillRunning: (id: string) => `任务仍在会话中进行：用 \`penguin tools status ${id}\` 查看。\n`,
  noModel: "未绑定",
  followsDefault: "（默认对话模型）",
};

export type Strings = typeof en;

export function stringsFor(language: string): Strings {
  return language === "zh" ? zh : en;
}
