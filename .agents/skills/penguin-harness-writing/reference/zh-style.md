# Chinese style

The voice and the banned list for Chinese text: posts, docs pages and landing copy alike. What
differs by kind of text (shape, reader, how it ends) lives in the `profile-*.md` files.

The block between the `prompt` markers is sent to the model verbatim as `{{STYLE}}` /
`{{STYLE_TARGET}}` by `scripts/prose.mjs`, and its `翻译腔` line doubles as the core of the zh
translation tells. The check patterns after it are what `prose.mjs check` greps for. Change the
two together: a phrase banned in the prompt and missing from the patterns slips through `check`,
and a pattern with no line in the prompt fails drafts for a rule the model was never given.

<!-- prompt -->
语气：一位做过工程、也写过设计文档的人在写给开发者看，平实、直接、具体。

写法：
- 段落短，一段一件事，最多四句。长短句交替，先出主语和动作，再接条件与原因。
- 全文是一个论证：每个 `## ` 标题后的第一句接住标题前的最后一句；不写只为预告下文的句子（「本节」「接下来」「下面我们」「如上所述」）。
- 具体压过抽象：写出产品名、文件名、命令、数字，让事实自己说话。能举例就不堆形容词。
- 图承担一部分论证。图前一句用图里标签的原词把它引出来，图里已经画出的东西正文不再描述一遍。
- 我们的立场写成我们的（「我们认为」「我们的判断是」「PenguinHarness 选择了」），别人的说法点名归属。不确定就直说不确定。
- 按有阅读障碍或注意力缺陷（ADHD）、读起来吃力又容易走神的读者来写：要点先说，句子短，一句只讲一件事，用常见的词。不插题外话，不写「顺便说一下」，不预先辩解，不先铺一层免责声明，不注水。

技术名词保持标准英文大小写，不翻译：Agent、Agent Harness、Harness、Agent Runtime、Environment、Workspace、Token、Session、Project、Skill、Plugin、Trace、Workbench、A2UI、A2APP、CLI、Web App、API、vibe coding、sandbox 写作沙箱亦可。界面上的按钮与页面名用「」引出并照抄 TERMS 里的中文标签（如「工作台」「智能体」）。中英文与数字之间留一个半角空格；标点用全角，括号内全为英文或数字时用半角括号。

译名：Harness 保持英文，写作 Harness 或 Agent Harness（首字母大写），不译作「夹具」「线束」「挽具」。测试里的 fixture 按用途译：合成的测试运行写「合成测试」，fixture 里的数字或配置写「测试数据」「测试配置」，同样不用「夹具」。wire shape（请求实际发出时的样子）写「传输格式」，不写「线形态」。

禁止（出现即改）：
- 翻案句及其全部变体：不是……而是……、并非……而是……、与其说……不如说……、看似……实则……、你以为……其实……、重要的不是……而是……。有判断就从正面说，依据放旁边。「是的，但是……」式的让步转折同样禁止：直接说结论和它的边界。
- 破折号（——）正文清零；提示性冒号改写，只保留引出原话的冒号；中文正文不用英文引号。
- 三项以上的同构排比；每段一句金句式收尾；「说白了」「先说结论」「值得注意的是」「更微妙的是」「从某种意义上说」「不难发现」「可以说」「毫无疑问」「这意味着」「换句话说」等路标词。
- 名词化：进行了、实现了、完成了对、起到了……作用、具有……意义，改回直接动词。
- 商业与模型黑话：赋能、抓手、闭环、底层逻辑、顶层设计、范式、生态、沉淀、拉通、降本增效、全链路、组合拳、技术底座、心智、颗粒度、方法论、打法、想象空间、重新定义、里程碑、革命性、无缝、强大、赋予。
- 翻译腔：「对于……而言」开头、每句一个「当……时」、「一个……的……的」长定语、「被」字句堆叠、「它」连用、「的」连用超过两个、句尾「的」拖长。
- 感叹号、表情符号、自行加粗（只加 Profile 要求的粗体；文章每节的重点句由后面的步骤标出，文档页按其 Profile 加粗界面标签）。
<!-- /prompt -->

## Check patterns

One per line: a backticked `/regex/flags`, then ` — ` and the label printed on a hit. Hits under
**Errors** fail `check`; hits under **Warnings** are printed for a person to judge. Code spans,
link targets and quoted text (「…」, “…”) are masked before matching, so a UI label or a quotation
does not trip a rule. The mechanical rules (CJK–Latin spacing, `——`, exclamation marks, ASCII
quotes, colons that do not introduce a quotation, bracket width, `的` chains, paragraph length)
are counted in the script itself.

### Errors

- `/不是[^。！？\n]{0,40}而是/` — 翻案句：不是……而是……
- `/并非[^。！？\n]{0,40}而是/` — 翻案句：并非……而是……
- `/与其说[^。！？\n]{0,40}不如说/` — 翻案句：与其说……不如说……
- `/看似[^。！？\n]{0,40}实则/` — 翻案句：看似……实则……
- `/你以为[^。！？\n]{0,40}其实/` — 翻案句：你以为……其实……
- `/重要的不是/` — 翻案句：重要的不是……而是……
- `/是的[，,]\s*但/` — 让步转折：「是的，但是……」
- `/说白了/` — 路标词：说白了
- `/先说结论/` — 路标词：先说结论
- `/值得注意的是/` — 路标词：值得注意的是
- `/更微妙的是/` — 路标词：更微妙的是
- `/从某种意义上说/` — 路标词：从某种意义上说
- `/不难发现/` — 路标词：不难发现
- `/可以说/` — 路标词：可以说
- `/毫无疑问/` — 路标词：毫无疑问
- `/这意味着/` — 路标词：这意味着
- `/换句话说/` — 路标词：换句话说
- `/进行了/` — 名词化：进行了
- `/实现了/` — 名词化：实现了
- `/完成了对/` — 名词化：完成了对
- `/起到了[^。！？\n]{0,12}作用/` — 名词化：起到了……作用
- `/具有[^。！？\n]{0,12}意义/` — 名词化：具有……意义
- `/赋能|抓手|闭环|底层逻辑|顶层设计|范式|降本增效|全链路|组合拳|技术底座|颗粒度|方法论|打法|想象空间|重新定义|里程碑|革命性|无缝|强大|赋予/` — 商业与模型黑话
- `/生态/` — 商业与模型黑话：生态
- `/沉淀/` — 商业与模型黑话：沉淀
- `/拉通/` — 商业与模型黑话：拉通
- `/心智/` — 商业与模型黑话：心智
- `/(^|[。！？；\n]\s*)对于[^。！？\n]{1,30}而言/` — 翻译腔：「对于……而言」开头
- `/夹具|线束|挽具/` — 译名：Harness 保持英文；测试 fixture 写作合成测试、测试数据或测试配置

### Warnings

- `/不是[^。！？\n]{0,30}[，,]\s*是/` — 翻案句变体：不是……，是……
- `/顺便(说|提|讲)(一下|一句)?|题外话/` — 题外话：「顺便说一下」
- `/话虽如此|当然[，,]|平心而论/` — 可能是预先辩解或让步
- `/当[^。！？\n]{1,30}时[，,]/` — 翻译腔：「当……时」（同段多次出现时改写）
- `/被[^。！？\n]{1,20}被/` — 翻译腔：「被」字句堆叠
- `/一个[^。！？，\n]{1,20}的[^。！？，\n]{1,20}的/` — 翻译腔：「一个……的……的」长定语
- `/(?<![\w/-])harness(?![\w-])/` — 大小写：写作 Harness 或 Agent Harness
- `/线形态/` — 译名：wire shape 写作「传输格式」
- `/(^|[。！？\n]\s*)(本节|下一节|上一节|接下来|下面我们|如上所述|前文提到)/` — 路标句：只预告下文的句子
