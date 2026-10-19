<!--
Slot values that are prompt text, one copy each. `scripts/blog-prose.mjs` reads every block
below its `fragment:` marker (up to the next marker) and substitutes it where a template names
the matching slot. Nothing above the first marker is sent to the model.
-->

<!-- fragment: version-note-rule -->
Directly after the frontmatter, reproduce this line verbatim and then a blank line: > {{VERSION_NOTE}}

<!-- fragment: no-version-note -->
No version note.

<!-- fragment: meme-brief -->
## Meme brief
{{MEME_BRIEF}}

Use the meme in at most two places: the title (already given) and one light touch in the body. Never explain the meme. If the brief is unsure what the meme means, use the title only.

<!-- fragment: outline-feedback -->
## Feedback on the previous outline
{{FEEDBACK_NOTES}}

````markdown
{{PREVIOUS_OUTLINE}}
````

<!-- fragment: title-rule-translate-zh -->
Translate the title; plain, under 30 characters, no colon-teaser.

<!-- fragment: title-rule-translate-en -->
Translate the title; plain, under 70 characters, no colon-teaser.

<!-- fragment: review-facts-rule -->
 FACTS is given for context: a finding may say a sentence overstates or blurs the fact it cites, and must never ask for a claim FACTS does not hold.

<!-- fragment: review-facts-section -->
{{FACTS}}

<!-- fragment: tells-zh -->
{{ZH_TRANSLATIONESE}}
- 长句一律拆短；被动改主动；「它」能省则省；每段最多一个「这」字开头的句子；量词与标点按中文习惯。

<!-- fragment: tells-en -->
Chinese-to-English tells: parallel triplets, 'not X but Y' pivots, aphoristic sentence-final flourishes, 'we can see that', 'it is worth noting', noun stacks ('the abstraction layer design principle'), missing articles, 'the' before plural generics, 'make the code not burn the heart' style literalisms (say what the idiom means), sentence-initial 'And'/'But' more than twice per section.
