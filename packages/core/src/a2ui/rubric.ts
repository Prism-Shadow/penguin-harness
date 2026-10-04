/**
 * The self-review questions the checker prints with `--rubric`: the L2/L3 judgements no rule can
 * make (value over text, component–intent fit, grounding, completeness, naturalness, cognitive
 * load, the no-UI cases, and real data in widgets). The model answers them before sending; the
 * skill quotes them.
 */
export const A2UI_RUBRIC: { zh: string[]; en: string[] } = {
  en: [
    "Would plain text have served the reader as well? If yes, remove the block.",
    "Does a sentence before each block say what it is for, so no block arrives unexplained?",
    "Is each component the right one: choice for one decision, form for several answers at once, steps for a procedure, callout for one warning or tip, mermaid for a structure or a flow, a widget (weather, clock, countdown, metrics) for a reading taken in at a glance?",
    "Do the options cover the realistic answers, with one marked recommended when you have a view, and is the question the last thing in the reply?",
    "Is the reply what a person would naturally say: short sentences, one instruction each, no filler?",
    "Can the reader take everything in at a glance: at most 5 options, 4 fields, 10 steps, one or two blocks?",
    "Did you keep UI out of a plain fact, a conversational turn or an emotional moment?",
    "Is every number in a widget real — read by a script, a tool or the user, with its `asOf` time — and never invented or rounded into a guess?",
  ],
  zh: [
    "换成纯文本是否同样清楚？如果是，删掉这个组件。",
    "每个组件前面是否有一句话说明它是干什么的，没有组件是突然出现的？",
    "组件选对了吗：choice 用于一个决定，form 用于一次回答多个问题，steps 用于操作步骤，callout 用于一条警告或提示，mermaid 用于结构或流程，小组件（weather、clock、countdown、metrics）用于一眼看懂的读数？",
    "选项是否覆盖了现实中的答案，有倾向时是否标了一个推荐项，问题是否放在回复的最后？",
    "这段回复像不像一个人自然会说的话：短句、一句一个指令、没有废话？",
    "读者能否一眼看完：选项不超过 5 个、字段不超过 4 个、步骤不超过 10 步、组件不超过一两个？",
    "对于一句话的事实、闲聊或情绪性的对话，是否没有使用组件？",
    "小组件里的每个数字是否都是真实的——来自脚本、工具或用户，并带有 `asOf` 时间——而不是编造或猜测？",
  ],
};
