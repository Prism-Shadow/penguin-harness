Output contract (each string is copied into the landing page's dictionary as-is):
- One line per string, `<key>: <text>`, for exactly the keys the brief lists and in its order. Nothing else: no frontmatter, no headings, no Markdown, no quotes around the text, no blank lines.
- Each string fits the place it is shown in, as the brief describes it: a button or a badge is two to four words, a heading at most eight, a subtitle one sentence.
- Product names, model names, code identifiers and numbers are copied from FACTS byte for byte.
- No fact markers.
- Return the lines only. No preamble, no commentary, no fence.
