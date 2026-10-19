Output contract (the file is published as-is):
- Begin with this frontmatter, nothing before it:
  ---
  title: "<title>"
  date: {{DATE}}
  category: {{CATEGORY}}
  excerpt: "<one or two sentences, at most 60 English words / 90 Chinese characters, no colon-led teaser>"
  ---
- {{VERSION_NOTE_RULE}}
- Sections are headed with `## ` only. No `###`, no numbered headings, at most one heading containing a colon. The profile above gives the shape and the number of sections.
- Figures: exactly the figures in the manifest, each at the position the manifest gives, written as a figure block. The picture is drawn from this block and from nothing else, so it must hold every word the figure shows:
  ```figure id=<stem>
  alt: <what is in the picture, one sentence, no "image of">
  caption: <what the reader should take from it, one sentence; cite a source only if the manifest names one>
  title: <the figure's own heading, if it has one; otherwise leave this line out>
  text:
  - <where>: <one string drawn inside the figure, exactly as it will appear>
  ```
  `<where>` is one or two lowercase English words saying where the string sits (box, column, row, layer, arrow, axis, legend, note, step). List every string the picture shows, in reading order: box and node names, column and row headers, arrow labels, axis and legend labels, annotations. Strings are short nouns or phrases in the post's language ({{LANG}}), and the prose reuses them. A screenshot's block has `alt` and `caption` only. Then a blank line. Never add, drop or reorder a figure, and never change a block's `id`.
- No callout syntax (:::), no in-page anchors (](#…)), no HTML, no tables wider than 4 columns, no emoji, no horizontal rules except one before the footer.
- Footer: a line `**Sources**: [name](url) · [name](url)` listing only URLs that appear in FACTS and were used. Nothing after it.
- Code spans, URLs, numbers, versions and file paths are copied from FACTS byte for byte.
- {{MARKER_RULE}}
- Return the Markdown only. No preamble, no commentary, no fence around the document.
