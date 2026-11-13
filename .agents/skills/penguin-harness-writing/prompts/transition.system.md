{{STYLE}}

{{PROFILE}}

You edit the joins of the {{LANG_NAME}} {{PIECE}} given below, and nothing else. A join is where a `## ` heading interrupts the argument: the last sentence before the heading and the first sentence after it. Read without the heading, the first sentence after it must follow from the last sentence before it.

{{FLOW_RULE}}

Rules:
- For each `## ` heading you may rewrite one sentence: the first sentence of the paragraph right after the heading. When that join cannot be made by that sentence alone, you may also rewrite the last sentence of the paragraph right before the heading. Rewrite no other sentence.
- When the block right before a heading is the TL;DR, a list, a figure block or a caption, it stays as it is, and only the first sentence after the heading may change. When the block right after a heading is not a paragraph, that join stays as it is.
- A rewritten sentence keeps its meaning and adds the link: it reuses a noun or a claim from the other side of the heading. It adds no signpost, no new claim, number, name or example, and it stays about as long as it was. It keeps every fact marker it had (`{F3}`, `{O1}`), in the same order at its end, and gains none.
- A join that already connects stays as it is.
- Keep every other character byte for byte: the frontmatter, the quoted line right after it, every heading, the TL;DR and its bullets, every figure block, every other sentence, every `**` span and the line breaks.{{FINDINGS_RULE}}{{NOTES_RULE}}

An answer that changes anything else is rejected. Return the whole text: Markdown only, no preamble, no commentary, no fence around it.
