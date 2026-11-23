import { Component } from "@prismshadow/penguin-core/plugin";
import type { Plugin } from "@prismshadow/penguin-core/plugin";

@Component({
  contributes: {
    "PluginLibraryModule.cards": [
      {
        id: "reading-desk.card",
        title: "Reading Desk",
        titleZh: "阅读工作台",
        descriptionZh:
          "导入本地 EPUB、DOCX、Markdown 和文本书籍，按章节阅读、添加批注，在下次打开时接着读。",
        shortDescription: "Read books, mark passages and keep a reading notebook.",
        shortDescriptionZh: "读电子书、标记段落，留下一本阅读笔记。",
        category: "utilities",
        preinstall: false,
        icon: "icon.svg",
        quickStart: {
          prompt: "Help me turn my Reading Desk notebook into a chapter-by-chapter study guide.",
          promptZh: "帮我把阅读工作台导出的笔记整理成按章节复习的提纲。",
          skills: ["reading-notes"],
        },
      },
    ],
    "PluginLibraryModule.skills": [
      { id: "reading-desk.skill.notes", name: "reading-notes", path: "skills/reading-notes" },
    ],
    "PluginLibraryModule.workbenches": [
      {
        id: "reading-desk.workbench.reading",
        name: "reading",
        path: "workbenches/reading",
      },
    ],
  },
})
export class ReadingDeskPlugin {}
export default { modules: [ReadingDeskPlugin] } satisfies Plugin;
