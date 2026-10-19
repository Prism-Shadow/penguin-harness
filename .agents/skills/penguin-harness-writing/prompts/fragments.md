<!--
Slot values that are prompt text, one copy each. `scripts/prose.mjs` reads every block below
its `fragment:` marker (up to the next marker) and substitutes it where a template names the
matching slot. Nothing above the first marker is sent to the model.
-->

<!-- fragment: piece-post -->
{{CATEGORY_NAME}} post for the PenguinHarness blog (penguin.ooo)

<!-- fragment: piece-docs -->
page of the PenguinHarness documentation (penguin.ooo/docs)

<!-- fragment: piece-landing -->
set of strings for the PenguinHarness landing page (penguin.ooo)

<!-- fragment: profile-wrapper -->
Profile for this {{NOUN}}; where it differs from the style guide above, the profile wins:

{{PROFILE_TEXT}}

<!-- fragment: markers-write -->
After every factual sentence write its fact id in braces, e.g. `{F3}`; after a sentence that states our position write `{O1}`. Several ids: `{F3}{F7}`. These are removed before publishing, so write the sentence as if they were not there. Headings, figure blocks, frontmatter and the footer carry no markers.

<!-- fragment: markers-keep -->
The fact markers (`{F3}`, `{O1}`) stay exactly as the input has them, at the end of the same sentences. Never add a marker to a sentence that has none, and never remove or renumber one. Headings, figure blocks, frontmatter and the footer carry no markers.

<!-- fragment: markers-fix -->
The fact markers (`{F3}`, `{O1}`) stay exactly as the input has them. Add a marker only to a factual sentence you write or change because of a finding, using an id from FACTS; never add one to a sentence you leave unchanged. Headings, figure blocks, frontmatter and the footer carry no markers.

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
 When a sentence contradicts FACTS, say so as a finding naming the fact id.

<!-- fragment: review-facts-section -->
{{FACTS}}

<!-- fragment: review-no-tells -->
(none: this text was written in this language, not translated)

<!-- fragment: tells-zh -->
{{ZH_TRANSLATIONESE}}
- 长句一律拆短；被动改主动；「它」能省则省；每段最多一个「这」字开头的句子；量词与标点按中文习惯。

<!-- fragment: tells-en -->
Chinese-to-English tells: parallel triplets, 'not X but Y' pivots, aphoristic sentence-final flourishes, 'we can see that', 'it is worth noting', noun stacks ('the abstraction layer design principle'), missing articles, 'the' before plural generics, 'make the code not burn the heart' style literalisms (say what the idiom means), sentence-initial 'And'/'But' more than twice per section.
