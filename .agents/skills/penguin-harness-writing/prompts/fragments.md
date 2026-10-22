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
After every factual sentence write its fact id in braces, e.g. `{F3}`; after a sentence that states our position write `{O1}`. Several ids: `{F3}{F7}`. These are removed before publishing, so write the sentence as if they were not there. Headings, figure blocks and frontmatter carry no markers.

<!-- fragment: markers-keep -->
The fact markers (`{F3}`, `{O1}`) stay exactly as the input has them, at the end of the same sentences. Never add a marker to a sentence that has none, and never remove or renumber one. Headings, figure blocks and frontmatter carry no markers.

<!-- fragment: markers-fix -->
The fact markers (`{F3}`, `{O1}`) stay exactly as the input has them. Add a marker only to a factual sentence you write or change because of a finding, and only an id the input already carries or a finding names; never add one to a sentence you leave unchanged. An answer with any other new id is rejected. Headings, figure blocks and frontmatter carry no markers.

<!-- fragment: count-rule-en -->
The size check counts exactly this way: a word is any run of characters between spaces or line breaks that holds at least one letter or digit, so a lone dash or symbol is no word. Text in lists, tables, quotes, link text and code blocks counts; the frontmatter, headings, figure blocks, HTML comments, link targets, image and italic caption lines, and the markers `{F#}`/`{O#}` do not. For example, {{COUNT_EXAMPLE}} counts as {{COUNT_EXAMPLE_N}}.

<!-- fragment: count-rule-zh -->
The size check counts exactly this way: it removes the Markdown symbols (`*`, `_`, backticks, `|`, `#`, list bullets and numbers, the `>` of a quote, a table's `---` row), then counts every remaining character that is not whitespace as one: each Chinese character, each punctuation mark (，。、；：「」（） included), each Latin letter and each digit. A Latin word counts one per letter, and a code span counts every character inside it. Text in lists, tables, quotes, link text and code blocks counts; the frontmatter, headings, figure blocks, HTML comments, link targets, image and italic caption lines, and the markers `{F#}`/`{O#}` do not. For example, {{COUNT_EXAMPLE}} counts as {{COUNT_EXAMPLE_N}}.

<!-- fragment: count-example-en -->
Run `check --svg` on the v0.2.16 draft, e.g. twice. {F3}

<!-- fragment: count-example-zh -->
用 `check --svg` 核对 v0.2.16 的 2 张图，Agent 才不会漏掉。{F3}

<!-- fragment: plan-other-unit -->
The plan counts {{PLAN_UNIT_NAME}}: this section's planned size is its {{PLAN_ROW_SIZE}} at {{ZH_RATIO}} Chinese characters per English word.

<!-- fragment: budget-why -->
It is the lowest of: {{BUDGET_PARTS}}.

<!-- fragment: budget-why-one -->
It is {{BUDGET_PARTS}}.

<!-- fragment: budget-part-planned -->
this section's planned size, {{B_PLANNED}}

<!-- fragment: budget-part-translated -->
what the source section comes to in {{LANG_NAME}}, {{B_PLANNED}}

<!-- fragment: budget-part-page -->
what the page has left, {{B_LEFT}} (its cap of {{B_PAGE_CAP}} less the {{B_OTHERS}} the rest of the page takes)

<!-- fragment: budget-part-lead-cap -->
the profile's cap for the lead, {{B_CAP}}

<!-- fragment: budget-part-section-cap -->
the profile's cap for a section, {{B_CAP}}

<!-- fragment: budget-part-margin -->
{{B_MARGIN}}, a margin under the refusal cap

<!-- fragment: section-now -->
The section as given counts {{SECTION_NOW_COUNT}}.

<!-- fragment: budget-whole -->
The size is binding: at most {{TOTAL_CAP}} of body text in all, the lead at most {{LEAD_CAP}}, and each `## ` section, everything under its heading, at most {{SECTION_CAP_TEXT}}. {{COUNT_RULE}} A text over a cap is rejected and written again.

<!-- fragment: trim-budget -->
at most {{TRIM_CAP}} of body text, or the answer is refused. The section given here counts {{TRIM_NOW}}, so cut at least {{TRIM_EXCESS}}. Aim for at most {{TRIM_AIM}}.{{SECTION_BUDGET_WHY}}

<!-- fragment: trim-budget-within -->
at most {{TRIM_CAP}} of body text outside the TL;DR, and that text is within it ({{TRIM_NOW}}); leave it as it is.

<!-- fragment: trim-keep-note -->
the quoted version-note line right after it

<!-- fragment: trim-tldr -->
The TL;DR after the lead is counted apart and holds at most {{TLDR_CAP}}; it counts {{TLDR_NOW}} now.

<!-- fragment: section-shape-lead -->
the frontmatter below, nothing before it, then the lead, one or two paragraphs with no heading.{{VERSION_NOTE_SENTENCE}}
  ---
  title: "<title>"
  date: {{DATE}}
  category: {{CATEGORY}}
  excerpt: "<one or two sentences, at most 60 English words / 90 Chinese characters, no colon-led teaser>"
  ---

<!-- fragment: section-shape-body -->
one `## ` heading (the plan's working heading, improved without changing its meaning; no numbering, no `###`), then the body. No other heading of any level, no frontmatter.

<!-- fragment: figure-reuse -->
Existing figure blocks for this section are given below. Reuse a block verbatim when its strings still say what the new text needs; change a string only when the new text makes it wrong, keep the block's id, keys and order, and list each changed block at the very end as <!-- figure changed: <id> -->.

<!-- fragment: existing-figure-blocks -->
## Existing figure blocks (from the frozen draft; reuse them per the rule above)
{{EXISTING_BLOCKS}}

<!-- fragment: section-feedback -->
## Feedback on the previous attempt at this section
{{FEEDBACK_NOTES}}

````markdown
{{PREVIOUS_SECTION}}
````

<!-- fragment: previous-none -->
(none: this is the lead, the first text of the piece)

<!-- fragment: facts-subset-intro -->
## FACTS (only the entries this section may cite)

<!-- fragment: neighbours -->
## Neighbouring sections (read-only, for continuity)
{{NEIGHBOUR_TEXT}}

<!-- fragment: translated-context -->
## The plan (headings, for consistency)
{{PLAN_TABLE}}

## Sections already translated (final)
{{PREVIOUS_SECTIONS}}

<!-- fragment: review-scope-section -->
You review one section of a longer piece. Its neighbours are given for context only; flag nothing in them.

<!-- fragment: review-scope-post -->
Flow across sections is the main question of this review: a transition that does not follow, a point made in two sections, a gloss repeated, a section that re-opens what an earlier one settled, an ending that summarises.

<!-- fragment: tldr-budget -->
A TL;DR after the lead, when the profile or the plan asks for one, is not part of the lead's budget: it has its own, {{TLDR_RANGE}}, and is counted apart.

<!-- fragment: emphasis-mirror-rule -->
The {{MIRROR_LANG_NAME}} edition of the same text is already marked; it is given before the text. In each section, mark the span that says what its marked span says, so both editions stress the same point.

<!-- fragment: emphasis-mirror-section -->
## The {{MIRROR_LANG_NAME}} edition, already marked (read-only)
{{MIRROR}}

<!-- fragment: tldr-plan -->
Row 0 is the lead alone; a TL;DR, if the post has one, is not a row and has its own budget of {{TLDR_RANGE}}.

<!-- fragment: title-rule-section -->
Choose the title from the outline's title candidates, or improve its wording without changing its meaning.

<!-- fragment: plan-feedback -->
The plan table in the previous outline breaks these limits. Return the whole outline again with a plan that keeps them, and change nothing the list does not require:

<!-- fragment: version-note-rule -->
Directly after the frontmatter, reproduce this line verbatim and then a blank line: > {{VERSION_NOTE}}

<!-- fragment: no-version-note -->
Nothing goes between the frontmatter and the lead.

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
