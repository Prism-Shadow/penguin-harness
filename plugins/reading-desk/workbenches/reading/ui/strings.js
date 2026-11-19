let language = navigator.language;
try {
  if (window.parent !== window) language = window.parent.document.documentElement.lang || language;
} catch {}
export const zh = language.toLowerCase().startsWith("zh");
const en = {
  desk: "Reading Desk",
  shelf: "Bookshelf",
  allBooks: "All books",
  search: "Search titles or authors",
  searchEmpty: "No books match your search.",
  openSample: "Read the sample",
  startReading: "Start reading",
  unread: "Unread",
  chapters: (n) => (n === 1 ? "1 chapter" : `${n} chapters`),
  add: "Import book",
  pick: "Select a file",
  formats:
    "EPUB, Word (.docx), Markdown or plain text, up to 32 MB. Books and notes stay in this browser.",
  contents: "Contents",
  notes: "Notebook",
  mark: "Highlight",
  prev: "Previous",
  next: "Next",
  font: "Text size",
  back: "Back to reading",
  close: "Close",
  empty: "Highlight a passage to start a note.",
  comment: "Add a note",
  save: "Save note",
  remove: "Remove",
  export: "Download notes",
  jump: "Go to passage",
  sample: "Reading Desk",
  busy: "Importing…",
  saved: "Saved",
  localError: "This browser could not save your library. Check its storage settings.",
  invalidFile: "This file could not be read.",
  format: "Choose an EPUB, DOCX, TXT or Markdown file.",
  tooLarge: "This book exceeds the 32 MB import limit.",
  noText: "No readable text was found in this book.",
  selected: "Select text within a paragraph to highlight it.",
  larger: "Larger",
  smaller: "Smaller",
  chapter: (i, n) => `Chapter ${i} of ${n}`,
  nNotes: (n) => `${n} ${n === 1 ? "note" : "notes"}`,
  resume: "Continue reading",
};
const cn = {
  desk: "阅读工作台",
  shelf: "书架",
  allBooks: "全部书籍",
  search: "搜索书名或作者",
  searchEmpty: "没有找到匹配的书籍。",
  openSample: "试读样书",
  startReading: "开始阅读",
  unread: "未读",
  chapters: (n) => `${n} 章`,
  add: "导入书籍",
  pick: "选择文件",
  formats:
    "支持 EPUB、Word (.docx)、Markdown 和纯文本，每本最多 32 MB。书籍和笔记保存在当前浏览器。",
  contents: "目录",
  notes: "笔记本",
  mark: "划线",
  prev: "上一章",
  next: "下一章",
  font: "字号",
  back: "返回阅读",
  close: "关闭",
  empty: "选中一段文字，划下第一条笔记。",
  comment: "写下想法",
  save: "保存笔记",
  remove: "移除",
  export: "下载笔记",
  jump: "回到原文",
  sample: "阅读工作台",
  busy: "正在导入…",
  saved: "已保存",
  localError: "浏览器无法保存书架，请检查浏览器的存储设置。",
  invalidFile: "无法读取这个文件。",
  format: "请选择 EPUB、DOCX、TXT 或 Markdown 文件。",
  tooLarge: "书籍超出 32 MB 的导入上限。",
  noText: "没有找到可阅读的文字。",
  selected: "请在同一段中选取文字后再划线。",
  larger: "放大",
  smaller: "缩小",
  chapter: (i, n) => `第 ${i} 章，共 ${n} 章`,
  nNotes: (n) => `${n} 条笔记`,
  resume: "继续阅读",
};
export const S = zh ? cn : en;
export const sample = zh
  ? {
      id: "sample-zh",
      title: "潮汐时刻表",
      author: "阅读工作台",
      chapters: [
        {
          title: "借来的窗台",
          paragraphs: [
            "去渡口的末班车要等四十分钟。我在旧车站找了一扇能望见海的窗，把折了三次的地图摊开。玻璃上有一道铅笔线，正好贴着远处的水面。",
            "卖票的人递过一把木尺，说那是昨晚的潮位。每天最后一班船开走，他就把尺子贴到窗上，给那一天留一道记号。整块玻璃像一本摊开的小日历。",
            "我原本想问，雾这么大，船会不会来。他先指了指窗下的一行小字。那里写着：看不见灯塔的时候，听绳索碰上桅杆的声音。",
            "两点十七分，一声很轻的金属响从海上传来。等车的人把手里的报纸折好，站了起来。",
          ],
        },
        {
          title: "地图背面",
          paragraphs: [
            "船票的背面印着一排空格。我问该填什么，船工说，从前那是留给鱼货重量的，现在你喜欢填什么都行。",
            "我写下今天经过的三个地方，又在地图背面画了一扇窗。第二天，纸上已经沾了一点海水，铅笔画的潮线却还在。",
          ],
        },
      ],
    }
  : {
      id: "sample-en",
      title: "The Tide Table",
      author: "Reading Desk",
      chapters: [
        {
          title: "The borrowed window",
          paragraphs: [
            "The last bus to the ferry was forty minutes away. I found a window that faced the water and spread my map along its sill. A faint pencil line on the glass lay level with the far shore.",
            "The ticket seller passed me a wooden ruler. Last night's tide, he said. When the last boat leaves, I hold the ruler against the window and mark the day. The glass had become a little calendar of the sea.",
            "I wanted to ask if the boat would come in such a fog. Instead he pointed to a note below the sill. When you cannot see the lighthouse, it read, listen for the rope against the mast.",
            "At seventeen minutes past two a small metallic sound came across the water. The woman beside me folded her newspaper and stood up.",
          ],
        },
        {
          title: "On the back of the map",
          paragraphs: [
            "On the back of my ticket was a row of empty squares. What goes here, I asked the deckhand. The weight of the fish, once, he said. You can write anything you like now.",
            "I wrote the names of three places I had passed. On the back of my map I drew a window. By morning the paper was flecked with seawater, but the pencilled tide line was still there.",
          ],
        },
      ],
    };
