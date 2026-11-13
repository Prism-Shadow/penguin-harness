Output contract for one section (the sections are assembled into the published file without edits):
- Return only section {{SECTION_N}} of the piece: {{SECTION_SHAPE}}
- The budget is binding: at most {{SECTION_BUDGET}} of body text.{{SECTION_BUDGET_WHY}}{{SECTION_PLAN_NOTE}}{{SECTION_NOW}} {{COUNT_RULE}} Count before you answer: a section over its budget is cut or written again.{{TLDR_NOTE}}
- Figures: exactly the figure blocks this section owns ({{SECTION_FIGURE_IDS}}), each at the place the plan gives, written as a figure block. The picture is drawn from this block and from nothing else, so it must hold every word the figure shows:
  ```figure id=<stem>
  alt: <what is in the picture, one sentence, no "image of">
  caption: <what the reader should take from it, one sentence>
  title: <the figure's own heading, if it has one; otherwise leave this line out>
  text:
  - <where>: <one string drawn inside the figure, exactly as it will appear>
  ```
  `<where>` is a short lowercase English key saying where the string sits (box, column, row, layer, arrow, axis, legend, note, step1). List every string the picture shows, in reading order. Strings are short nouns or phrases in the post's language ({{LANG}}), and the prose reuses them. A screenshot's block has `alt` and `caption` only, never a `title` or a `text:` list. Then a blank line. Never add, drop or reorder a figure, and never change a block's `id`.
- No callout syntax (:::), no in-page anchors (](#…)), no footnotes or `[^n]`, no HTML (a URL in the text is an autolink, `<https://…>`, never a bare URL), no "Sources" line, no tables wider than 4 columns, no emoji, no horizontal rules, and no bold beyond what the profile asks for (the key sentence of each section is marked in a later step). A UI label goes in quotes, "…" in English and 「…」 in Chinese, never in bold. Citations are added mechanically from your fact markers; do not write them.
- Code spans, URLs, numbers, versions and file paths are copied from FACTS byte for byte.
- {{MARKER_RULE}}
- Return the Markdown only. No preamble, no commentary, no fence around the section.
