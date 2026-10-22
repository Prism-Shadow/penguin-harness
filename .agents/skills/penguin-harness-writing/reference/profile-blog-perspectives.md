# Profile: perspective posts

Loaded for `--profile blog-perspectives` (blog category `perspectives`). The `prompt` block is sent
to the model as `{{PROFILE}}` after the style guide; a `prompt zh` block, when present, replaces it
for Chinese text. `## Check settings` is read by `prose.mjs` and never sent: the ranges are
`floor-cap`, English in words and Chinese in characters of body text (figure blocks, headings,
frontmatter and the references list do not count). The outline's plan is held to the caps, and
`check` makes a section above its cap (or above 1.1 × its planned size) an error and one below its
floor a warning. `emphasis` turns on the one marked key sentence per section that `emphasize`
adds and `check` and `pair` hold to its cap.

<!-- prompt -->
A perspective post argues one thesis.
- Voice: a senior engineer writing a perspective piece on a good engineering blog. The reader is a developer or technical founder who has used an agent product and has ten minutes.
- One thesis, stated in the first paragraph, carried by every section, never restated at the end.
- Shape: a lead of one or two paragraphs (50 to 90 words) with no heading that states the thesis in plain words, then the TL;DR, then 4 to 5 sections headed with `## `, each 90 to 150 words. The whole body is at most 750 words; figures carry what would otherwise take a paragraph.
- TL;DR: right after the lead, a line `**TL;DR**` (the one bold you write) and three bullets, the post's key points in the order the sections make them, 30 to 50 words in all, each bullet ending with its fact or opinion marker.
- End on a concrete point or a next step, not on a summary, a question or a line about the future.
<!-- /prompt -->

<!-- prompt zh -->
一篇 perspective 文章只论证一个论点。
- 语气：一位做过工程、也写过设计文档的人在讲自己的看法。读者是用过 Agent 产品的开发者或技术负责人，有十分钟。
- 全文一个论点，第一段就说出来，每一节往前推一步，结尾不再复述。
- 结构：先是一到两段不带标题的导语（不超过 220 字），用平实的话说出论点；然后是 TL;DR；然后 4 到 5 节，每节用 `## ` 标题，每节不超过 400 字。正文合计不超过 1800 字，能用图说清的就不写成一段话。
- TL;DR：紧跟导语，单独一行 `**TL;DR**`（你唯一要写的粗体），下面三条要点，按各节展开的顺序写出全文的关键结论，合计 70 到 120 字，每条以它的事实或观点标记结尾。
- 结尾落在一件具体的事或下一步上，不升华，不展望，不反问。
<!-- /prompt -->

## Check settings

- sections: 4-5
- lead: yes
- words: 550-750
- lead-words: 50-90
- section-words: 90-160
- zh-chars: 1300-1800
- zh-lead-chars: 120-220
- zh-section-chars: 200-400
- tldr: yes
- tldr-words: 30-50
- zh-tldr-chars: 70-120
- emphasis: yes
- emphasis-words: 25
- zh-emphasis-chars: 40
