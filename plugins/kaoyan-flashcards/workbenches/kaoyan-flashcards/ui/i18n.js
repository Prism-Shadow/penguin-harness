/* Kaoyan Flashcards: the interface language, Chinese or English.
 *
 * A classic script, loaded right after storage-bridge.js and before app.js. It sets
 * window.KaoyanI18n:
 *
 *   lang()           "zh" or "en"
 *   setLang(code)    switches to "zh" or "en" (anything else is ignored), remembers the choice
 *                    under kmc:lang, sets <html lang> and calls every onChange listener
 *   t(key, ...args)  the current language's text; a function entry is called with args; a key
 *                    the current language lacks falls back to the other one, then to the key
 *   onChange(fn)     registers fn(code), called after every setLang
 *   strings          { zh, en }: two flat dictionaries with the same keys
 *
 * At start a saved "zh" or "en" wins; otherwise a device language starting with "zh" gives
 * Chinese and anything else English. kmc:lang goes through storage-bridge.js like the app's
 * other keys, so the choice is kept with the workbench.
 *
 * Content data stays as written and is not here: the question bank, the recitation documents,
 * the import sample. Entries ending in "Html" hold markup and take numbers only.
 */
(function () {
  "use strict";

  var KEY = "kmc:lang";

  /** "3 cards", "1 card". */
  function count(n, one, many) {
    return n + " " + (n === 1 ? one : many);
  }

  var zh = {
    "app.title": "考研记忆卡 · 题库 / 刷题 / 背诵",
    "app.shortName": "记忆卡",
    "app.name": "考研记忆卡",
    "app.logo": "记",
    "lang.switch": "EN",
    "lang.switchLabel": "Switch to English",
    "common.close": "关闭",
    "list.sep": "；",

    "nav.views": "模式",
    "nav.home": "首页",
    "nav.decks": "题库",
    "nav.quiz": "刷题",
    "nav.read": "背诵",
    "nav.theme": "切换深色模式",

    "greet.night": "夜深了",
    "greet.morning": "早上好",
    "greet.noon": "中午好",
    "greet.afternoon": "下午好",
    "greet.evening": "晚上好",
    "home.date": function (d) {
      return (
        d.toLocaleDateString("zh-CN", { month: "long", day: "numeric" }) +
        " · " +
        d.toLocaleDateString("zh-CN", { weekday: "short" })
      );
    },
    "home.streak": function (n) {
      return "连续打卡 " + n + " 天";
    },
    "home.ringUnit": "题",
    "home.goalDone": "今天的目标完成了，保持这个节奏。",
    "home.goalDoneWrong": "今天的目标完成了，顺手清一下错题本？",
    "home.goalLeftHtml": function (n) {
      return "还差 <b>" + n + "</b> 题就完成今天的计划";
    },
    "home.goalStartHtml": function (n) {
      return "今天还没开始，先做 <b>" + n + "</b> 题热身吧";
    },
    "home.goalChip": function (n) {
      return n + " 题";
    },
    "home.reviewDue": function (n) {
      return "先复习到期的 " + n + " 题";
    },
    "home.again": "再练一轮",
    "home.start": "开始今日计划",
    "home.tiles": "学习数据",
    "home.shortcuts": "快捷入口",
    "home.progress": "科目进度",
    "home.resume": "继续上次",
    "home.notStarted": "未开始",
    "home.import": "导入资料",
    "home.count": function (n) {
      return n + " 题";
    },
    "tile.dueHint": "到期巩固",
    "tile.dueNone": "都复习完了",
    "tile.wrong": "错题",
    "tile.wrongHint": "去清一清",
    "tile.wrongNone": "还没有错题",
    "tile.total": function (n) {
      return "共 " + n + " 题";
    },
    "tile.answers": function (n) {
      return n + " 次作答";
    },
    "stat.total": "题量",
    "stat.mastered": "已掌握",
    "stat.accuracy": "正确率",
    "stat.streak": "连续天数",
    "stat.due": "待复习",

    "scope.all": "全部",
    "scope.todo": "未掌握",
    "scope.done": "已掌握",
    "scope.hard": "只练不会",
    "scope.wrong": "错题本",
    "scope.due": "今日复习",
    "scope.fav": "只看收藏",

    "type.single_choice": "单选",
    "type.multiple_choice": "多选",
    "type.true_false": "判断",
    "type.basic": "问答",
    "type.cloze": "填空",
    "type.card": "卡片",
    "type.question": "题",
    "tf.true": "正确",
    "tf.false": "错误",
    "chapter.imported": "导入资料",
    "field.public": "公共课",
    "field.major": "专业课",
    "field.real": "真题",
    "field.bank": "题库",
    "field.practice": "练习",

    "quiz.preparing": "准备中",
    "quiz.today": function (n) {
      return "今日 " + n + " 张";
    },
    "quiz.roundHtml": function (n) {
      return "本轮 <b>" + n + "</b> 题";
    },
    "quiz.noCards": "这个范围里没有卡片",
    "quiz.cardArea": "记忆卡",
    "quiz.star": "收藏此题",
    "quiz.options": "选项",
    "quiz.confirm": function (n) {
      return "确认答案" + (n ? "（已选 " + n + "）" : "（可多选）");
    },
    "quiz.answer": "答案",
    "quiz.correct": "答对",
    "quiz.incorrect": "未答对",
    "quiz.reveal": "显示答案",
    "hint.space": "空格",
    "hint.reveal": "看答案",
    "hint.move": "切题",
    "hint.rate": "评级",
    "hint.swipe": "手机可左右滑动",
    "rate.group": "掌握程度",
    "rate.prev": "上一题",
    "rate.prevTitle": "上一题（←）",
    "rate.skip": "跳过这一题",
    "rate.nextTitle": "下一题（→）",
    "rate.again": "不会",
    "rate.hard": "模糊",
    "rate.good": "会了",
    "done.title": "这一轮完成了",
    "done.text": function (n) {
      return "共 " + n + " 张。不会和模糊的卡片会留在「未掌握」里，下次重点过。";
    },
    "done.redo": "再来一轮",
    "done.drill": "重练不会的",
    "empty.text": "可能是筛选条件太窄，或者记录里已经没有未掌握的卡片了。",
    "empty.adjust": "调整筛选",
    "empty.all": "看全部",
    "chooser.none": "还没选科目",
    "chooser.title": "今天刷哪一科？",
    "chooser.text": "点整卷从头刷，点下面的章节就只刷那一章。",
    "chooser.browse": "打开题库（含真题）",

    "decks.real": "真题 · 按院校",
    "decks.realHintHtml":
      "还没有真题。<b>导入 PDF / Word / 文字</b>，标题里写明「东北大学 2019 年」，题卡就会自动标上院校和年份，并按学校分卷。",
    "decks.importReal": "导入真题",
    "decks.practice": "练习题库 · 非真题",
    "deck.icon": "题",
    "deck.last": "上次",
    "deck.noSchool": "院校未标注",
    "deck.sideHtml": function (n, good) {
      return "<b>" + n + " 题</b>掌握 " + good;
    },
    "deck.builtin.name": "内置卡片",
    "deck.builtin.desc": "内置的卡片",
    "deck.imported.name": function (school, year) {
      return (school || "导入") + (year ? " " + year : "") + " 真题";
    },
    "deck.imported.desc": function (school, year, n) {
      return (school || "院校未标注") + (year ? " · " + year + " 年" : "") + " · " + n + " 题";
    },
    "deck.imported.icon": "真",

    "drawer.title": "筛选与设置",
    "drawer.decks": "题库",
    "drawer.search": "搜索",
    "drawer.searchPlaceholder": "题干、选项、解析里的词",
    "drawer.source": "院校 / 年份",
    "drawer.year": function (year) {
      return year + " 年";
    },
    "drawer.chapters": "章节",
    "drawer.types": "题型",
    "drawer.scope": "范围",
    "drawer.order": "顺序",
    "drawer.data": "资料",
    "drawer.importDoc": "导入 PDF / Word / 文本",
    "drawer.importCards": "导入卡片 JSON",
    "drawer.backup": "导出学习数据",
    "drawer.restore": "导入学习数据",
    "drawer.reset": "清空学习记录",
    "drawer.resetConfirm": "再点一次，确认清空",
    "order.seq": "按章节顺序",
    "order.shuffle": "随机打乱",
    "filter.matchHtml": function (n) {
      return "当前匹配 <b>" + n + "</b> 题";
    },
    "filter.reset": "重置筛选",

    "read.choose": "选择资料",
    "read.veil": "遮重点",
    "read.veilTitle": "把标记的重点遮住，点一下再看",
    "read.body": "知识点正文",
    "read.presets": "恢复预置资料",
    "read.clearMarks": "清除本文标记",
    "read.delete": "删除本文",
    "read.deleteConfirm": "再点一次，确认删除",
    "read.noDocs": "还没有资料",
    "read.untitled": "未命名资料",
    "read.option": function (title, n) {
      return title + "（" + n + "段）";
    },
    "read.paras": function (n) {
      return "共 " + n + " 段";
    },
    "read.marked": function (marked, total) {
      return "已标记 " + marked + " / " + total + " 段";
    },
    "read.veilProgress": function (marked, seen) {
      return "已遮 " + marked + " 段 · 已看 " + seen + " / " + marked;
    },
    "read.emptyTitle": "还没有可背的资料",
    "read.emptyText":
      "导入 PDF、Word 或粘贴一段文字，就能在这里滚动划重点；也可以先恢复内置的重点速记。",

    "import.title": "导入资料",
    "import.intro":
      "支持 .docx / .pdf / .txt / .md，也可以直接粘贴文字。识别到「题干 + 选项 + 答案」的会变成刷题卡片，其余文字进背诵模式。",
    "import.pick": "选择文件",
    "import.sample": "填入示例",
    "import.noFile": "未选择文件",
    "import.dropHint":
      "把 .docx / .pdf / .txt / .md 拖到这里也行；示例里有单选、多选、判断和解析，可以先看看识别效果。",
    "import.pastePlaceholder":
      "也可以粘贴文字，例如：\n1. 从经济性和生产周期性考虑，单件生产的箱体最好采用______。\nA. 铸铁件　B. 铸钢件　C. 焊接件　D. 塑料件\n【答案】C\n【解析】单件生产不用开模，焊接件最省。",
    "import.docTitle": "资料标题",
    "import.addCardsHtml": function (n) {
      return "把识别到的 <b>" + n + "</b> 道题加入刷题";
    },
    "import.addDocHtml": function (n) {
      return "把 <b>" + n + "</b> 段文字加入背诵";
    },
    "import.target": "题目加入",
    "import.newDeck": "新建一份卷（用资料标题）",
    "import.into": function (name) {
      return "并入「" + name + "」";
    },
    "import.clear": "清空",
    "import.do": "导入",
    "import.foundHtml": function (questions, paragraphs) {
      return "识别到 <b>" + questions + "</b> 道题、<b>" + paragraphs + "</b> 段文字";
    },
    "import.noQuestions":
      "没认到题目：答案行写成「答案：C」或「【答案】C」，选项写成「A. 内容」即可",
    "import.more": function (n) {
      return "另有 " + n + " 道题…";
    },
    "import.textOnly": "只有背诵资料",
    "import.pasted": "粘贴的资料",
    "import.defaultTitle": "导入资料",
    "import.optionsSuffix": function (keys) {
      return "（选项：" + keys + "）";
    },
    "import.reading": function (name) {
      return name + " · 解析中…";
    },
    "import.failed": function (reason) {
      return "解析失败：" + reason;
    },
    "import.unknownError": "未知错误",
    "import.sampleSource": "示例：机械设计试卷",
    "import.sampleFile": "示例内容",

    "err.noInflate": "当前浏览器不支持解压（请使用新版 Chrome / Edge）",
    "err.zip": "这不是有效的 .docx（ZIP 结构缺失）",
    "err.notDocx": "这不是 .docx 文件",
    "err.compression": "不支持这种压缩方式",
    "err.pdf": "这不是有效的 PDF",
    "err.doc": "老版 .doc 无法直接解析，请另存为 .docx",
    "err.noText": "没有提取到文字（可能是扫描版）",

    "load.bank": function (reason) {
      return "内置题库没有加载出来（data/decks.json：" + reason + "）";
    },
    "load.docs": function (reason) {
      return "预置背诵资料没有加载出来（data/docs.json：" + reason + "）";
    },
    "load.badFormat": "格式不对或是空的",
    "load.tail": "。导入的资料和学习记录不受影响，刷新页面可以重试。",

    "toast.docsTooBig": "资料太大，浏览器存不下；可只保留关键章节",
    "toast.cardsTooMany": "卡片太多，浏览器存不下",
    "toast.starred": "已加入收藏",
    "toast.unstarred": "已取消收藏",
    "toast.filtersReset": "已重置筛选",
    "toast.progressCleared": "学习记录已清空",
    "toast.exported": "已导出学习数据",
    "toast.restored": "已导入，正在刷新…",
    "toast.notBackup": "这不是本应用导出的备份文件",
    "toast.cardsImported": function (n) {
      return "已导入 " + n + " 张卡片";
    },
    "toast.noNewCards": "没有新的卡片",
    "toast.badCardJson": "这个文件不是合法的卡片 JSON",
    "toast.bankEmpty": "题库里还没有题目，可以先导入资料",
    "toast.start": function (name) {
      return "开始刷「" + name + "」";
    },
    "toast.noWrong": "还没有错题，先去刷几道",
    "toast.noDue": "今天没有到期的卡片，刷题后会按 1/2/4/7 天排期",
    "toast.presetsFailed": "预置资料没有加载出来，刷新页面再试",
    "toast.noPresets": "没有预置资料",
    "toast.presetsHere": "预置资料都已经在里面了",
    "toast.presetsAdded": function (n) {
      return "已加入 " + n + " 份预置资料";
    },
    "toast.marksCleared": "已清除本文标记",
    "toast.deleted": "已删除",
    "toast.imported": function (questions, paragraphs) {
      return (
        "已导入" +
        (questions ? " " + questions + " 道题" : "") +
        (paragraphs ? " " + paragraphs + " 段知识点" : "")
      );
    },
    "toast.sampleFilled": "已填入示例，改完可以直接导入",
  };

  var en = {
    "app.title": "Kaoyan Flashcards · Decks / Quiz / Recite",
    "app.shortName": "Flashcards",
    "app.name": "Kaoyan Flashcards",
    "app.logo": "K",
    "lang.switch": "中文",
    "lang.switchLabel": "切换为中文",
    "common.close": "Close",
    "list.sep": "; ",

    "nav.views": "Views",
    "nav.home": "Home",
    "nav.decks": "Decks",
    "nav.quiz": "Quiz",
    "nav.read": "Recite",
    "nav.theme": "Toggle dark mode",

    "greet.night": "It's late",
    "greet.morning": "Good morning",
    "greet.noon": "Hello",
    "greet.afternoon": "Good afternoon",
    "greet.evening": "Good evening",
    "home.date": function (d) {
      return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    },
    "home.streak": function (n) {
      return n + "-day streak";
    },
    "home.ringUnit": "cards",
    "home.goalDone": "Today's goal is done. Keep it up.",
    "home.goalDoneWrong": "Today's goal is done. Clear a few mistakes while you're at it?",
    "home.goalLeftHtml": function (n) {
      return "<b>" + n + "</b> more " + (n === 1 ? "card" : "cards") + " to reach today's goal";
    },
    "home.goalStartHtml": function (n) {
      return "Not started yet today. Warm up with <b>" + n + "</b> cards.";
    },
    "home.goalChip": function (n) {
      return n + "/day";
    },
    "home.reviewDue": function (n) {
      return "Review " + count(n, "due card", "due cards") + " first";
    },
    "home.again": "One more round",
    "home.start": "Start today's plan",
    "home.tiles": "Study stats",
    "home.shortcuts": "Shortcuts",
    "home.progress": "Progress by subject",
    "home.resume": "Resume",
    "home.notStarted": "Not started",
    "home.import": "Import",
    "home.count": function (n) {
      return String(n);
    },
    "tile.dueHint": "Review now",
    "tile.dueNone": "All done",
    "tile.wrong": "Mistakes",
    "tile.wrongHint": "Clear them",
    "tile.wrongNone": "None yet",
    "tile.total": function (n) {
      return "of " + n;
    },
    "tile.answers": function (n) {
      return count(n, "answer", "answers");
    },
    "stat.total": "Questions",
    "stat.mastered": "Mastered",
    "stat.accuracy": "Accuracy",
    "stat.streak": "Streak",
    "stat.due": "Due",

    "scope.all": "All",
    "scope.todo": "Not mastered",
    "scope.done": "Mastered",
    "scope.hard": "Again or Hard",
    "scope.wrong": "Mistakes",
    "scope.due": "Due today",
    "scope.fav": "Starred",

    "type.single_choice": "Single choice",
    "type.multiple_choice": "Multiple choice",
    "type.true_false": "True/false",
    "type.basic": "Short answer",
    "type.cloze": "Fill in the blank",
    "type.card": "Card",
    "type.question": "Question",
    "tf.true": "True",
    "tf.false": "False",
    "chapter.imported": "Imported",
    "field.public": "General subjects",
    "field.major": "Major subjects",
    "field.real": "Past papers",
    "field.bank": "Question bank",
    "field.practice": "Practice",

    "quiz.preparing": "Loading",
    "quiz.today": function (n) {
      return count(n, "card", "cards") + " today";
    },
    "quiz.roundHtml": function (n) {
      return "<b>" + n + "</b> this round";
    },
    "quiz.noCards": "No cards here",
    "quiz.cardArea": "Flashcard",
    "quiz.star": "Star this card",
    "quiz.options": "Options",
    "quiz.confirm": function (n) {
      return n ? "Check answer (" + n + " selected)" : "Check answer (pick one or more)";
    },
    "quiz.answer": "Answer",
    "quiz.correct": "Correct",
    "quiz.incorrect": "Incorrect",
    "quiz.reveal": "Show answer",
    "hint.space": "Space",
    "hint.reveal": "show answer",
    "hint.move": "previous / next",
    "hint.rate": "rate",
    "hint.swipe": "swipe on a phone",
    "rate.group": "How well you knew it",
    "rate.prev": "Previous card",
    "rate.prevTitle": "Previous (←)",
    "rate.skip": "Skip this card",
    "rate.nextTitle": "Next (→)",
    "rate.again": "Again",
    "rate.hard": "Hard",
    "rate.good": "Good",
    "done.title": "Round complete",
    "done.text": function (n) {
      return (
        count(n, "card", "cards") +
        ". Cards rated Again or Hard stay in Not mastered for next time."
      );
    },
    "done.redo": "Another round",
    "done.drill": "Redo the hard ones",
    "empty.text": "The filters may be too narrow, or every card here is mastered already.",
    "empty.adjust": "Adjust filters",
    "empty.all": "Show all",
    "chooser.none": "No subject chosen",
    "chooser.title": "Which subject today?",
    "chooser.text": "Pick a deck to go through all of it, or a chapter to practice just that one.",
    "chooser.browse": "Browse decks and past papers",

    "decks.real": "Past papers · by school",
    "decks.realHintHtml":
      "No past papers yet. <b>Import a PDF, Word file or text</b> whose title names the school and the year in Chinese, such as “东北大学 2019 年”: its cards are tagged with both and grouped by school.",
    "decks.importReal": "Import past papers",
    "decks.practice": "Practice decks · not past papers",
    "deck.icon": "Q",
    "deck.last": "Last",
    "deck.noSchool": "School not given",
    "deck.sideHtml": function (n, good) {
      return "<b>" + count(n, "question", "questions") + "</b>" + good + " mastered";
    },
    "deck.builtin.name": "Built-in cards",
    "deck.builtin.desc": "The built-in cards",
    "deck.imported.name": function (school, year) {
      return (school || "Imported") + (year ? " " + year : "") + " past paper";
    },
    "deck.imported.desc": function (school, year, n) {
      return (
        (school || "School not given") +
        (year ? " · " + year : "") +
        " · " +
        count(n, "question", "questions")
      );
    },
    "deck.imported.icon": "P",

    "drawer.title": "Filters and settings",
    "drawer.decks": "Decks",
    "drawer.search": "Search",
    "drawer.searchPlaceholder": "Words in questions, options or explanations",
    "drawer.source": "School / year",
    "drawer.year": function (year) {
      return String(year);
    },
    "drawer.chapters": "Chapters",
    "drawer.types": "Question type",
    "drawer.scope": "Show",
    "drawer.order": "Order",
    "drawer.data": "Data",
    "drawer.importDoc": "Import PDF / Word / text",
    "drawer.importCards": "Import cards (JSON)",
    "drawer.backup": "Export study data",
    "drawer.restore": "Restore study data",
    "drawer.reset": "Clear progress",
    "drawer.resetConfirm": "Click again to clear",
    "order.seq": "In chapter order",
    "order.shuffle": "Shuffled",
    "filter.matchHtml": function (n) {
      return "<b>" + n + "</b> " + (n === 1 ? "question matches" : "questions match");
    },
    "filter.reset": "Reset filters",

    "read.choose": "Choose a document",
    "read.veil": "Hide marked",
    "read.veilTitle": "Blur the key words of marked paragraphs; click one to peek",
    "read.body": "Document",
    "read.presets": "Restore presets",
    "read.clearMarks": "Clear marks",
    "read.delete": "Delete",
    "read.deleteConfirm": "Click again to delete",
    "read.noDocs": "No documents yet",
    "read.untitled": "Untitled",
    "read.option": function (title, n) {
      return title + " (" + count(n, "paragraph", "paragraphs") + ")";
    },
    "read.paras": function (n) {
      return count(n, "paragraph", "paragraphs");
    },
    "read.marked": function (marked, total) {
      return marked + " / " + total + " marked";
    },
    "read.veilProgress": function (marked, seen) {
      return marked + " hidden · " + seen + " / " + marked + " seen";
    },
    "read.emptyTitle": "Nothing to recite yet",
    "read.emptyText":
      "Import a PDF or Word file, or paste some text, to read it here and mark the key points. Or restore the preset notes first.",

    "import.title": "Import material",
    "import.intro":
      "Takes .docx, .pdf, .txt and .md files, or pasted text. A question with options and an answer line (【答案】 or 答案：) becomes a quiz card; other text goes to Recite.",
    "import.pick": "Choose file",
    "import.sample": "Try the sample",
    "import.noFile": "No file chosen",
    "import.dropHint":
      "You can also drop a .docx, .pdf, .txt or .md file here. The sample has single and multiple choice, true/false and explanations: try it to see what gets recognized.",
    "import.pastePlaceholder":
      "Or paste text. Mark answers with 【答案】 and explanations with 【解析】, for example:\n1. The most economical housing for a one-off gearbox is a ______.\nA. iron casting  B. steel casting  C. welded part  D. plastic part\n【答案】C\n【解析】A one-off part needs no mold, so welding costs least.",
    "import.docTitle": "Title",
    "import.addCardsHtml": function (n) {
      return "Add the <b>" + n + "</b> " + (n === 1 ? "question" : "questions") + " to Quiz";
    },
    "import.addDocHtml": function (n) {
      return "Add the <b>" + n + "</b> " + (n === 1 ? "paragraph" : "paragraphs") + " to Recite";
    },
    "import.target": "Add questions to",
    "import.newDeck": "A new deck, named after the title",
    "import.into": function (name) {
      return "Add to “" + name + "”";
    },
    "import.clear": "Clear",
    "import.do": "Import",
    "import.foundHtml": function (questions, paragraphs) {
      return (
        "Found <b>" +
        questions +
        "</b> " +
        (questions === 1 ? "question" : "questions") +
        " and <b>" +
        paragraphs +
        "</b> " +
        (paragraphs === 1 ? "paragraph" : "paragraphs")
      );
    },
    "import.noQuestions":
      "No questions found. Write the answer line as “答案：C” or “【答案】C” and options as “A. text”.",
    "import.more": function (n) {
      return n + " more…";
    },
    "import.textOnly": "Text only, no questions",
    "import.pasted": "Pasted text",
    "import.defaultTitle": "Imported material",
    "import.optionsSuffix": function (keys) {
      return " (options: " + keys + ")";
    },
    "import.reading": function (name) {
      return name + " · reading…";
    },
    "import.failed": function (reason) {
      return "Could not read the file" + (reason ? ": " + reason : "");
    },
    "import.unknownError": "unknown error",
    "import.sampleSource": "Sample: mechanical design paper",
    "import.sampleFile": "Sample",

    "err.noInflate": "This browser cannot decompress files; use a recent Chrome or Edge",
    "err.zip": "Not a valid .docx (no ZIP structure)",
    "err.notDocx": "Not a .docx file",
    "err.compression": "Unsupported compression method",
    "err.pdf": "Not a valid PDF",
    "err.doc": "Old .doc files cannot be read; save it as .docx first",
    "err.noText": "No text found (it may be a scan)",

    "load.bank": function (reason) {
      return "The question bank did not load (data/decks.json: " + reason + ")";
    },
    "load.docs": function (reason) {
      return "The preset notes did not load (data/docs.json: " + reason + ")";
    },
    "load.badFormat": "wrong format or empty",
    "load.tail": ". Imported material and progress are not affected; reload the page to try again.",

    "toast.docsTooBig": "Too much to store in this browser; keep only the key chapters",
    "toast.cardsTooMany": "Too many cards to store in this browser",
    "toast.starred": "Starred",
    "toast.unstarred": "Removed from starred",
    "toast.filtersReset": "Filters reset",
    "toast.progressCleared": "Progress cleared",
    "toast.exported": "Study data exported",
    "toast.restored": "Restored. Reloading…",
    "toast.notBackup": "This is not a backup file from this app",
    "toast.cardsImported": function (n) {
      return "Imported " + count(n, "card", "cards");
    },
    "toast.noNewCards": "No new cards",
    "toast.badCardJson": "This file is not valid card JSON",
    "toast.bankEmpty": "The bank has no questions yet. Import some material first.",
    "toast.start": function (name) {
      return "Starting “" + name + "”";
    },
    "toast.noWrong": "No mistakes yet. Do a few cards first.",
    "toast.noDue": "Nothing is due today. Rated cards come back after 1, 2, 4, 7… days.",
    "toast.presetsFailed": "The preset notes did not load. Reload the page to try again.",
    "toast.noPresets": "There are no preset notes",
    "toast.presetsHere": "All preset notes are here already",
    "toast.presetsAdded": function (n) {
      return "Added " + count(n, "preset document", "preset documents");
    },
    "toast.marksCleared": "Marks cleared",
    "toast.deleted": "Deleted",
    "toast.imported": function (questions, paragraphs) {
      var parts = [];
      if (questions) parts.push(count(questions, "question", "questions"));
      if (paragraphs) parts.push(count(paragraphs, "paragraph", "paragraphs"));
      return parts.length ? "Imported " + parts.join(" and ") : "Imported";
    },
    "toast.sampleFilled": "Sample filled in. Edit it, or import it as it is.",
  };

  var strings = { zh: zh, en: en };
  var has = Object.prototype.hasOwnProperty;

  function valid(code) {
    return code === "zh" || code === "en";
  }
  function deviceLang() {
    var nav = typeof navigator === "undefined" ? null : navigator;
    var tag = String((nav && nav.language) || "");
    return /^zh/i.test(tag) ? "zh" : "en";
  }
  function savedLang() {
    try {
      var value = localStorage.getItem(KEY);
      return valid(value) ? value : null;
    } catch (e) {
      return null;
    }
  }
  function stamp(code) {
    if (typeof document !== "undefined" && document && document.documentElement) {
      document.documentElement.lang = code === "zh" ? "zh-CN" : "en";
    }
  }

  var current = savedLang() || deviceLang();
  var listeners = [];
  stamp(current);

  function lang() {
    return current;
  }
  function setLang(code) {
    if (!valid(code)) return;
    current = code;
    try {
      localStorage.setItem(KEY, code);
    } catch (e) {
      /* storage unavailable: the choice lasts until the page closes */
    }
    stamp(code);
    for (var i = 0; i < listeners.length; i++) {
      try {
        listeners[i](code);
      } catch (err) {
        /* one broken listener must not stop the others; the console still shows it */
        if (typeof console !== "undefined" && console.error) console.error(err);
      }
    }
  }
  function t(key) {
    var args = Array.prototype.slice.call(arguments, 1);
    var other = current === "zh" ? "en" : "zh";
    var entry = has.call(strings[current], key)
      ? strings[current][key]
      : has.call(strings[other], key)
        ? strings[other][key]
        : key;
    if (typeof entry !== "function") return String(entry);
    try {
      return String(entry.apply(null, args));
    } catch (e) {
      return String(key);
    }
  }
  function onChange(fn) {
    if (typeof fn === "function") listeners.push(fn);
  }

  window.KaoyanI18n = { lang: lang, setLang: setLang, t: t, onChange: onChange, strings: strings };
})();
