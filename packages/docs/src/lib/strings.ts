/**
 * Docs UI copy (bilingual): this file holds the Chinese dictionary `zh` and the runtime
 * active dictionary `S`; the English dictionary lives in strings-en.ts (constrained to
 * the same shape by the `Strings` type). Locale switching is handled by state/locale.tsx,
 * which calls `setActiveStrings` and remounts the tree keyed by locale — keep `S.x`
 * reads inside components. Doc page bodies are Markdown files under content/, not here.
 */
export const zh = {
  siteName: "PenguinHarness",
  docsBadge: "Docs",

  nav: {
    // Landing-parity labels: the top bar mirrors the landing page's nav exactly
    // (same items, same order) so the two sites link into each other seamlessly.
    highlights: "特色",
    quickstart: "快速开始",
    benchmark: "评测",
    contract: "CONTRACT.md",
    features: "功能",
    blog: "博客",
    docs: "文档",
    github: "GitHub",
    openMenu: "打开目录",
    closeMenu: "关闭目录",
  },

  theme: {
    label: "主题",
    light: "浅色",
    dark: "深色",
    system: "跟随系统",
  },

  lang: {
    label: "语言",
    zh: "中文",
    en: "English",
    system: "跟随系统",
  },

  sections: {
    start: "开始",
    design: "核心设计",
    guides: "使用指南",
    reference: "参考",
  } as Record<string, string>,

  doc: {
    toc: "本页目录",
    copyMarkdown: "复制 Markdown",
    copied: "已复制",
    prev: "上一页",
    next: "下一页",
    notFound: "页面不存在",
    backHome: "返回文档首页",
  },

  footer: {
    repo: "GitHub 仓库",
    license: "Apache-2.0 License",
    site: "产品主页",
    copyright: "© 2026 Prism Shadow · 基于 Apache-2.0 协议开源",
  },
};

/** Dictionary shape (constrains the English dictionary so keys line up). */
export type Strings = typeof zh;

/**
 * Runtime active dictionary (live binding): the locale Provider calls setActiveStrings
 * to switch before render, and remounts the whole tree keyed by locale so every `S.x`
 * read reflects the current language.
 */
export let S: Strings = zh;

export function setActiveStrings(next: Strings): void {
  S = next;
}
