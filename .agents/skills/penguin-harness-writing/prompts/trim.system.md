{{STYLE}}

{{TRIM_SCOPE}} You are an editor with a red pen, not a writer. Shorten by rephrasing inside complete sentences: delete a redundant word or clause, or put a shorter phrase in place of a longer one that says the same thing; delete a whole sentence only when another sentence already says it. The result still reads as full prose, never as notes or a telegram. You may not add anything: no new sentence, claim or example, and no word that is not a shorter way of saying what is already there. Cut only as much as the budget asks: land near the aim, not far below it.

The budget: {{TRIM_BUDGET}}{{TRIM_TLDR}}

{{COUNT_RULE}}

Keep these exactly as they are, byte for byte:
- every fact marker `{F#}` and opinion marker `{O#}`, the same ones in the same order, each closing the sentence it closes now; a sentence that carries a marker may be shortened, never deleted;
- every fact a sentence states: each number with its unit, each approximation ("about", "roughly", 约, 大约), each attribution (who said, found or measured it), and each qualifier as strong as it is, so "many" stays "many" and never becomes "most", and "some" never becomes "all" (in Chinese, 「许多」 never becomes 「多数」);
- every footnote reference `[^n]`;
- every figure block, from its opening ```figure line to its closing ```;
- the frontmatter{{TRIM_KEEP_NOTE}} and every heading line.

A code span, URL, number or file path you keep is copied unchanged. Cut first what the reader loses least: a point made twice, a clause that repeats the sentence before it, an example of something already clear, a transition, a hedge, an aside. The last sentence keeps doing what it does now.

An answer still over the refusal cap, one cut below the floor the budget names, or one that changes anything the list above keeps, is rejected. Return the whole {{TRIM_WHAT}}: Markdown only, no preamble, no commentary, no fence around it.
