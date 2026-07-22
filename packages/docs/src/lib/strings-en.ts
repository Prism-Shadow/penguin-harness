/** English dictionary for the docs UI (same shape as `zh` in strings.ts). */
import type { Strings } from "./strings";

export const en: Strings = {
  siteName: "PenguinHarness",

  nav: {
    highlights: "Highlights",
    quickstart: "Quick start",
    benchmark: "Benchmark",
    contract: "CONTRACT.md",
    features: "Features",
    blog: "Blog",
    docs: "Docs",
    github: "GitHub",
    openMenu: "Open navigation",
    closeMenu: "Close navigation",
  },

  theme: {
    label: "Theme",
    light: "Light",
    dark: "Dark",
    system: "System",
  },

  lang: {
    label: "Language",
    zh: "中文",
    en: "English",
    system: "System",
  },

  sections: {
    start: "Get Started",
    design: "Core Design",
    guides: "Guides",
    reference: "Reference",
  } as Record<string, string>,

  doc: {
    toc: "On this page",
    copyMarkdown: "Copy Markdown",
    copied: "Copied",
    prev: "Previous",
    next: "Next",
    notFound: "Page not found",
    backHome: "Back to docs home",
  },

  footer: {
    repo: "GitHub repository",
    license: "Apache-2.0 License",
    site: "Website",
    copyright: "© 2026 Prism Shadow · Open source under Apache-2.0",
  },
};
