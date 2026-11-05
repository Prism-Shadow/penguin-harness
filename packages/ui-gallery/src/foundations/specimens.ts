/**
 * Specimen text for the Foundations boards and `/fonts`: the "Build a Claude Code docs expert"
 * session the product screenshots use, one set per language. Both languages render regardless
 * of the chrome language where a board sets them side by side — CJK legibility is judged in
 * every theme.
 */
export interface Specimen {
  /** A short display line (hero / h1). */
  display: string;
  /** A section heading. */
  heading: string;
  /** A body paragraph: prose with inline product names, numbers and a path. */
  paragraph: string;
  /** A dense UI line: labels, counts, a price, a duration. */
  ui: string;
  /** A caption / hint line. */
  caption: string;
  /** A code block exercising the mono face: identifiers, strings with CJK, numbers, operators. */
  code: string;
  /** Tabular numerals and units, to judge figure widths. */
  numerals: string;
  /** A dense UI line, named for where the old pages used it. */
  short: string;
}

const en: Omit<Specimen, "short"> = {
  display: "Agents that cite their sources",
  heading: "Prompt cache hit 81% across 2 turns",
  paragraph:
    "PenguinHarness ran the claude-code-expert Session for 1m12s on DeepSeek V4.1 Flash: 43.8k tokens, $0.0231 and 7 tool calls. The BM25 index covers 214 Markdown files, so even a question asked as “如何配置 hooks？” still cites corpus/claude-code-docs/hooks.md [1].",
  ui: "Running · 6 steps · 34s — read_file …/src/rag.ts (421ms) · edit_file +3 −1 · $0.0110",
  caption: "Last synced 2026-09-14 14:02 (UTC+8) · 48.2 KB · Trace #001",
  code: `// A citation must open a real file (引用必须指向真实文件)
const hits = rank(question).slice(0, 6).filter((c) => fs.existsSync(c.source));
console.log(\`\${hits.length} hits in \${(performance.now() - t0).toFixed(1)}ms\`); // 6 hits in 12.4ms`,
  numerals: "0123456789 · 1,048,576 tokens · $0.0231 · 71.8s · 99.95% · 3 × 4 = 12 · v0.2.13",
};

const zh: Omit<Specimen, "short"> = {
  display: "会引用来源的智能体",
  heading: "两轮对话，提示缓存命中率 81%",
  paragraph:
    "PenguinHarness 用 DeepSeek V4.1 Flash 运行 claude-code-expert 会话 1 分 12 秒：共 43.8k tokens、$0.0231、7 次工具调用。BM25 索引覆盖 214 个 Markdown 文件，所以即便问 “How do I configure hooks?”，回答也会引用 corpus/claude-code-docs/hooks.md [1]。",
  ui: "运行中 · 6 步 · 34s — read_file …/src/rag.ts（421ms）· edit_file +3 −1 · $0.0110",
  caption: "最近同步 2026-09-14 14:02（UTC+8）· 48.2 KB · Trace #001",
  code: `// 引用必须指向语料库中真实存在的文件
const hits = rank("如何配置 hooks？").slice(0, 6).filter((c) => fs.existsSync(c.source));
console.log(\`命中 \${hits.length} 条，用时 \${(performance.now() - t0).toFixed(1)}ms\`); // 命中 6 条，用时 12.4ms`,
  numerals: "0123456789 · 1,048,576 tokens · ¥0.1617 · 71.8 秒 · 99.95% · 第 2 轮 · v0.2.13",
};

export const SPECIMENS: Readonly<Record<"en" | "zh", Specimen>> = {
  en: { ...en, short: en.ui },
  zh: { ...zh, short: zh.ui },
};
