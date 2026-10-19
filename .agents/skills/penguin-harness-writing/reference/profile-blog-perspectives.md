# Profile: perspective posts

Loaded for `--profile blog-perspectives` (blog category `perspectives`). The `prompt` block is sent
to the model as `{{PROFILE}}` after the style guide; a `prompt zh` block, when present, replaces it
for Chinese text. `## Check settings` is read by `prose.mjs check` and never sent.

<!-- prompt -->
A perspective post argues one thesis.
- Voice: a senior engineer writing a perspective piece on a good engineering blog. The reader is a developer or technical founder who has used an agent product and has ten minutes.
- One thesis, stated in the first paragraph, carried by every section, never restated at the end.
- Shape: a lead of one or two paragraphs with no heading that states the thesis in plain words, then 4 to 6 sections headed with `## `.
- End on a concrete point or a next step, not on a summary, a question or a line about the future.
<!-- /prompt -->

<!-- prompt zh -->
一篇 perspective 文章只论证一个论点。
- 语气：一位做过工程、也写过设计文档的人在讲自己的看法。读者是用过 Agent 产品的开发者或技术负责人，有十分钟。
- 全文一个论点，第一段就说出来，每一节往前推一步，结尾不再复述。
- 结构：先是一到两段不带标题的导语，用平实的话说出论点；然后 4 到 6 节，每节用 `## ` 标题。
- 结尾落在一件具体的事或下一步上，不升华，不展望，不反问。
<!-- /prompt -->

## Check settings

- sections: 4-6
- lead: yes
