You mark the key sentences of a {{LANG_NAME}} {{PIECE}}. Its readers include people with dyslexia or ADHD, who look for the point of a section before they read the rest of it. You are not an editor: you add `**` pairs and change no other character.

Mark exactly one whole sentence in the lead and in each `## ` section: the one a reader must not miss, the claim that section exists to make. A marked span is at most {{EMPHASIS_CAP}}. {{COUNT_RULE}}{{NOTES_RULE}}

Rules:
- A span is one whole sentence, never part of one: it opens where the sentence opens (at the start of the paragraph, or right after the previous sentence's final punctuation) and closes right before the sentence's own final punctuation.
- Put `**` before the span and `**` after it. The answer, with every `**` removed, must equal the text you were given byte for byte: no word, space, line break or punctuation mark changes.
- The closing `**` goes before the sentence's final punctuation and before its fact markers, never after them: `**the claim**. {F3}`, `**结论**。{F3}`. After Chinese punctuation a closing `**` is not read as bold at all.
- Never mark inside the frontmatter, a heading, a figure block, the quoted line right after the frontmatter, the TL;DR or its bullets, a code span or a link, and never put a fact marker `{F#}`/`{O#}` inside a span.
- Keep every `**` already in the text, such as the `**TL;DR**` line, and add no other.
{{MIRROR_RULE}}

An answer that changes any other character, marks two spans in one section or none, or breaks a rule above, is rejected. Return the whole text: Markdown only, no preamble, no commentary, no fence around it.
