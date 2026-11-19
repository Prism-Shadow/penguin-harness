// The page's copy, in the two languages the app speaks. The page follows the app's language
// (the `lang` of the document that frames it) and falls back to the browser's.

const en = {
  fileMenu: "File",
  newDeck: "New",
  saveDeck: "Save presentation",
  saveFailed: (why) => `Could not save this presentation (${why}). Your edits are still open.`,
  notSaved: "Not saved",
  pptx: "Export as PowerPoint file (.pptx)",
  unsupportedPowerPoint:
    "This deck contains media or a graphic PowerPoint export cannot reproduce. Download HTML to keep the complete deck.",
  present: "Present",
  backToEdit: "Back to editor",
  deckName: "Deck title",
  layout: "Starting layout",
  projectBrief: "Project brief",
  newTitle: "New presentation",
  create: "Create",
  cancel: "Cancel",
  brief: [
    ["Objective", "What should change, and for whom?"],
    ["Next steps", "Name the next action, its owner and its deadline."],
  ],
  transferFailed: "The editor could not complete that action. Your deck is still open.",
  frameTitle: "Bento Slides editor",
  importDeck: "Import Bento HTML or JSON…",
  exportDeck: "Download Bento HTML file (.html)",
  history: "Version history",
  close: "Close",
  historyLoading: "Loading versions…",
  historyFailed: "Couldn’t load earlier versions. Reopen version history to try again.",
  restoreVersion: "Restore",
  askAi: "AI chat",
  railTitle: "Ask AI to change this deck",
  newChat: "New conversation",
  chooseModel: "Choose chat model",
  modelUnsupported: "Open this presentation in the updated PenguinHarness app to choose a model.",
  defaultModel: "Project default",
  modelFailed: (reason) => `Could not select a model. ${reason}`,
  modelUnchanged: "The model switch did not finish. The previous model is still selected.",
  send: "Send",
  stop: "Stop",
  promptPlaceholder: "Describe the change, for example: make this slide a bar chart of the numbers",
  startTitle: "AI Slides",
  startLead:
    "Edit a deck here while the Agent edits the same deck. Each of you sees the other's changes as they are saved.",
  startPlaceholder: "What is the deck about? For example: a five-slide introduction to our Q4 plan",
  startGo: "Create with AI",
  sampleDeck: "Open the sample deck",
  blankDeck: "Blank deck",
  unsupportedTitle: "This workbench needs a newer PenguinHarness",
  unsupportedBody:
    "Slides keeps each deck in a file the editor and the Agent both write, which this server does not offer yet. Update PenguinHarness, then reload.",
  untitled: "Untitled deck",
  slides: (n) => (n === 1 ? "1 slide" : `${n} slides`),
  opening: "Opening editor…",
  synced: "Saved",
  saving: "Saving…",
  theirs: "The Agent updated the deck",
  merged: "The Agent updated the deck; your edits were kept",
  offline: "Not saved: the server cannot be reached",
  hintEmpty:
    "Ask for a change in plain words. The Agent edits the deck file and the slides update here as it saves. You can keep editing meanwhile.",
  contextSlide: (n, total) => `Slide ${n} of ${total}`,
  contextSelection: (n) => (n === 1 ? "1 element selected" : `${n} elements selected`),
  clashes: (n) =>
    n === 1
      ? "You and the Agent changed the same property; yours was kept. The Agent's version is in the deck's history."
      : `You and the Agent changed the same ${n} properties; yours were kept. The Agent's version is in the deck's history.`,
  badFile: (why) =>
    `The deck file cannot be read right now (${why}). It loads again as soon as it is valid.`,
  gone: "This deck's file was removed.",
  keepCopy: "Keep what you see as a new deck",
  historyEmpty:
    "No earlier versions yet. When a save replaces the other side's version, that version is kept here.",
  versionBy: { agent: "The Agent's version", editor: "Your version" },
  restoreFailed: (why) => `That version could not be restored: ${why}.`,
  importFailed: (why) => `That file could not be imported: ${why}.`,
  askFailed: (why) => `The request could not be sent: ${why}`,
  aiFailed: "The Agent stopped without an answer.",
};

const zh = {
  fileMenu: "文件",
  newDeck: "新建",
  saveDeck: "保存演示文稿",
  saveFailed: (why) => `无法保存这份文稿（${why}），编辑内容仍保留在这里。`,
  notSaved: "未保存",
  pptx: "导出为 PowerPoint 文件（.pptx）",
  unsupportedPowerPoint: "文稿含有尚不能导出到 PowerPoint 的媒体或图形。下载 HTML 可保留整份文稿。",
  present: "放映",
  backToEdit: "返回编辑",
  deckName: "文稿标题",
  layout: "起始版式",
  projectBrief: "项目简报",
  newTitle: "新建演示文稿",
  create: "创建",
  cancel: "取消",
  brief: [
    ["项目目标", "为谁解决什么问题？"],
    ["下一步", "写下要做的事、负责人以及完成时间。"],
  ],
  transferFailed: "操作未完成，文稿仍在编辑器中。",
  frameTitle: "Bento 幻灯片编辑器",
  importDeck: "导入 Bento HTML 或 JSON…",
  exportDeck: "下载 Bento HTML 文件（.html）",
  history: "历史版本",
  close: "关闭",
  historyLoading: "正在读取历史版本…",
  historyFailed: "无法读取历史版本。重新打开历史版本即可重试。",
  restoreVersion: "恢复",
  askAi: "AI 对话",
  railTitle: "让 AI 修改这份文稿",
  newChat: "新对话",
  chooseModel: "选择对话模型",
  modelUnsupported: "在新版 PenguinHarness 应用中打开文稿即可选择模型。",
  defaultModel: "项目默认模型",
  modelFailed: (reason) => `未能选择对话模型。${reason}`,
  modelUnchanged: "模型切换未完成，当前对话仍使用原模型。",
  send: "发送",
  stop: "停止",
  promptPlaceholder: "描述要改什么，例如：把这一页的数字做成柱状图",
  startTitle: "AI PPT",
  startLead: "你在这里编辑文稿，Agent 同时修改同一份文稿；任何一方保存后，另一方立即看到。",
  startPlaceholder: "这份文稿讲什么？例如：用五页介绍我们的第四季度计划",
  startGo: "让 AI 生成",
  sampleDeck: "打开示例文稿",
  blankDeck: "空白文稿",
  unsupportedTitle: "这个工作台需要更新的 PenguinHarness",
  unsupportedBody:
    "幻灯片工作台把每份文稿存成一个编辑器与 Agent 都能写的文件，当前服务端还不提供这项能力。请更新 PenguinHarness 后重新载入。",
  untitled: "未命名文稿",
  slides: (n) => `${n} 页`,
  opening: "正在打开编辑器…",
  synced: "已保存",
  saving: "正在保存…",
  theirs: "Agent 更新了文稿",
  merged: "Agent 更新了文稿，你的修改已保留",
  offline: "未保存：连不上服务端",
  hintEmpty:
    "用一句话说出要改什么。Agent 修改文稿文件，保存后这里的幻灯片随即更新；其间你可以继续编辑。",
  contextSlide: (n, total) => `第 ${n} 页，共 ${total} 页`,
  contextSelection: (n) => `已选 ${n} 个元素`,
  clashes: (n) => `你和 Agent 改了同样的 ${n} 处属性，已保留你的修改；Agent 的版本在文稿历史里。`,
  badFile: (why) => `文稿文件暂时读不出来（${why}）；文件恢复合法后会自动载入。`,
  gone: "这份文稿的文件已被删除。",
  keepCopy: "把眼前这份另存为新文稿",
  historyEmpty: "还没有历史版本。一方保存时替换了另一方的版本，被替换的版本会留在这里。",
  versionBy: { agent: "Agent 的版本", editor: "你的版本" },
  restoreFailed: (why) => `无法恢复这个版本：${why}。`,
  importFailed: (why) => `无法导入这个文件：${why}。`,
  askFailed: (why) => `请求没有发出：${why}`,
  aiFailed: "Agent 没有给出回答就停止了。",
};

/** The language of the app framing this page, else the browser's. */
function language() {
  try {
    const lang = window.parent !== window ? window.parent.document.documentElement.lang : "";
    if (lang) return lang;
  } catch {
    // A cross-origin parent: fall through to the browser.
  }
  return navigator.language || "en";
}

export const locale = language().toLowerCase().startsWith("zh") ? "zh" : "en";
export const S = locale === "zh" ? zh : en;
