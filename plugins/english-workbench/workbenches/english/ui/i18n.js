/* English Learning Workbench: the interface language, Chinese or English.
 *
 * A classic script, loaded before content.js and app.js. It sets window.EnglishI18n:
 *
 *   lang()           "zh" or "en"
 *   setLang(code)    switches to "zh" or "en" (anything else is ignored), remembers the choice,
 *                    sets <html lang> and calls every onChange listener
 *   t(key, ...args)  the current language's text; a function entry is called with args; a key
 *                    the current language lacks falls back to the other one, then to the key
 *   onChange(fn)     registers fn(code), called after every setLang
 *   strings          { zh, en }: two flat dictionaries with the same keys
 *
 * At start a saved "zh" or "en" wins; otherwise a device language starting with "zh" gives
 * Chinese and anything else English.
 *
 * The choice is saved in localStorage under `english-workbench:lang`, the page's only
 * localStorage key: everything else (the learning record, the press switch) is kept by the
 * workbench's handler. The key holds nothing but "zh" or "en", so the storage it shares with
 * every other workbench page of the app learns nothing from it; it is a per-browser
 * convenience, and a browser without storage simply asks the device again next time.
 *
 * Only the interface is here. The study material in content.js (English passages, the Chinese
 * glosses and translations, notes, exam prompts and model answers) stays as written. Entries
 * ending in "Html" hold markup and take no outside text.
 */
(function () {
  "use strict";

  var KEY = "english-workbench:lang";

  function plural(n, one, many) {
    return Number(n) === 1 ? one : many;
  }

  var zh = {
    "doc.title": "英语学习工作台",
    "doc.description":
      "英语学习工作台：名著点读、新闻与 TED 导读、粘贴文章精读、每日外刊、词句库与复习、口语跟读、考试微练。",
    "app.name": "英语学习工作台",
    "brand.home": "英语学习工作台 首页",
    "lang.switch": "EN",
    "lang.switchLabel": "Switch to English",
    "lang.zh": "中文",
    "lang.en": "English",
    "list.sep": "、",
    "common.all": "全部",
    "common.read": "朗读",
    "common.slow": "慢速",
    "common.delete": "删掉",
    "common.done": "已完成 ✓",
    "common.markRead": "标记今天读完",

    "nav.main": "主导航",
    "nav.today": "今日工作台",
    "nav.press": "每日外刊",
    "nav.news": "新闻精读",
    "nav.ted": "TED 精读",
    "nav.books": "名著轻阅读",
    "nav.media": "Vlog / 播客",
    "nav.wechat": "英语公众号",
    "nav.exams": "考试专项",
    "nav.words": "我的词句库",
    "nav.resources": "资源库",
    "nav.settings": "设置",
    "tab.label": "底部导航",
    "tab.today": "今日",
    "tab.press": "外刊",
    "tab.news": "新闻",
    "tab.words": "词句库",
    "tab.more": "更多",
    "title.pressitem": "外刊精读",

    "side.loading": "正在读取记录…",
    "side.updated": "内容更新",
    "side.streak": function (n) {
      return "连续 " + n + " 天";
    },
    "top.minutes": function (n) {
      return n + " 分钟";
    },
    "theme.toggle": "切换深色模式",
    "theme.toDark": "已切到夜间模式",
    "theme.toLight": "已切到日间模式",

    "rd.label": "朗读控制",
    "rd.pause": "暂停或继续朗读",
    "rd.pauseTitle": "暂停 / 继续",
    "rd.stop": "停止朗读",
    "rd.stopTitle": "停止",
    "rd.rate": "语速",
    "rd.rateLabel": "朗读语速",
    "rd.accentLabel": "切换英音美音",
    "rd.rec": "跟读",
    "rd.recLabel": "跟读录音",
    "pop.label": "单词信息",
    "sel.speak": "朗读",
    "sel.slow": "慢速",
    "sel.save": "存句",
    "sel.copy": "复制",

    "tts.idle": "点单词或句子开始朗读",
    "tts.unsupported": "这个浏览器不支持朗读",
    "tts.done": "读完啦 · 再点一个句子",
    "tts.blocked": "浏览器拦下了这次朗读，点一下页面再试",
    "tts.failed": "这次没读出来，再点一次试试",
    "tts.startFailed": "朗读启动失败",
    "tts.resumed": "继续朗读…",
    "tts.paused": "已暂停",
    "read.tip": "点单词听发音、看本篇注释 · 点句子朗读 · 虚线框住的是本篇标注词",

    "level.1": "基础",
    "level.2": "中级",
    "level.3": "中高级",
    "level.4": "高级",
    "level.1.tip": "读短一点、注释多一点，先看懂再求快",
    "level.2.tip": "全文精读 + 复述，每天 1 篇就够",
    "level.3.tip": "少看注释，多抓结构与观点",
    "level.4.tip": "全文快读，重点在观点与反驳",

    "passage.play": "▶ 播放段落",
    "passage.shadow": "跟读",
    "pop.marked": "本篇标注",
    "pop.noNote": "这个词没有本站注释。先听发音，再自己写一条释义——写下来记得更牢。",
    "pop.coll": "常见搭配",
    "pop.ex": "例句",
    "pop.src": "出自",
    "pop.placeholder": "我理解的意思，例如：n. 申请",
    "pop.inLib": "已在词句库",
    "pop.add": "加入词句库",
    "pop.added": "已加入",
    "word.noMeaning": "（待补释义）",
    "toast.addedWord": "已加入词句库",
    "toast.copied": "已复制",
    "toast.copyFailed": "复制失败",
    "toast.wordExists": "这个词已在词句库里",
    "toast.sentenceExists": "这句已存过",
    "toast.sentenceSaved": "已存入句子本",
    "toast.cleared": "已清空",
    "toast.removed": "已删掉",

    "rec.unsupported": "这个浏览器不支持录音",
    "rec.stop": "停止录音",
    "rec.recording": function (time) {
      return "录音中 " + time + " · 点「停止录音」结束";
    },
    "rec.noMic": "没有拿到麦克风权限，录音需要你允许一次",
    "rec.done": "录好了，点播放回听对比",
    "rec.replay": "再读一遍原句",
    "rec.delete": "删除",
    "rec.memoryOnly": "录音只在本页内存里，刷新即消失",
    "accent.us": "美音",
    "accent.uk": "英音",
    "accent.toUS": "已切到美音",
    "accent.toUK": "已切到英音（无英音音色时会用最接近的）",

    "err.network": "网络错误",
    "err.http": function (status) {
      return "请求失败 " + status;
    },
    "err.data-missing": "请求里没有学习记录",
    "err.data-invalid": "记录格式不对",
    "err.data-too-large": "记录太大（超过 700 KB），先导出再清理一下",
    "err.online-invalid": "联网开关只能是开或关",
    "err.press-failed": "抓取失败",
    "err.feeds-unreachable": "所有订阅源都没有响应",
    "err.url-invalid": "原文链接要以 http:// 或 https:// 开头",
    "err.text-too-long": "正文太长了，一次最多 20 万字符",
    "err.text-too-short": "正文太短，至少 40 个英文单词",
    "err.not-found": "没有这个接口",
    "sync.saveFailed": function (message, retry) {
      return "学习记录没能保存：" + message + (retry ? "，稍后自动重试" : "");
    },
    "sync.notLoaded": "记录没读取到 · 改动不会保存",
    "sync.failing": "记录没能保存 · 稍后重试",
    "sync.ok": "记录保存在工作台里",
    "sync.loadFailed": "没能读取学习记录。为了不覆盖已有记录，这次的改动不会保存，请稍后刷新再试。",

    "heat.done": function (n) {
      return n + " 项完成";
    },
    "heat.none": "没有记录",

    "greet.night": "还醒着？那就读一小段就睡",
    "greet.morning": "早上好，先读一段再开始一天",
    "greet.afternoon": "下午好，读一篇刚刚好",
    "greet.evening": "晚上好，睡前读一段正好",
    "today.eyebrow": function (date, level, levelName, exam) {
      return date + " · L" + level + " " + levelName + " · 目标 " + exam;
    },
    "today.lead": function (tip) {
      return (
        tip +
        "。今天的新闻、TED 和名著都在下面：名著直接点读，新闻和 TED 先看注释和观点题，再去原站读全文。"
      );
    },
    "today.planTitle": function (m) {
      return "今天的 " + m + " 分钟";
    },
    "today.pickNews": function (topic) {
      return "今日新闻 · " + topic;
    },
    "today.pickTed": "今日 TED",
    "today.pickBook": "今日名著",
    "meta.aboutWords": function (n) {
      return "约 " + n + " 词";
    },
    "meta.annotated": function (n) {
      return n + " 个标注词";
    },
    "today.speakTitle": "口语 10 分钟",
    "today.speakSub": "用今天的新闻问题练：",
    "today.speakGo": "去新闻页答题并录音",
    "today.examTitle": function (exam) {
      return "考试微练 · " + exam;
    },
    "today.examGo": "去做这题",
    "today.dueTitle": function (n) {
      return "待复习 " + n + " 个词";
    },
    "today.dueNone": "还没有到期的词。读书时把生词加入词句库，到点再来复习。",
    "today.dueGo": "去词句库复习",
    "today.week": "本周",
    "today.statDays": "有学习的天数",
    "today.statWords": "词句库单词",
    "today.statSentences": "收藏句子",
    "today.statStreak": "连续天数",
    "today.last30": "最近 30 天",
    "today.goPress": "看今天的外刊",
    "today.goWechat": "英语公众号清单",
    "today.review": "本周复盘",
    "today.reviewSub": "自动汇总最近 7 天：读了什么、存了多少词、下周怎么调。",
    "today.reviewNews": "新闻",
    "today.reviewTasks": function (n) {
      return "任务 " + n + " 项";
    },
    "today.reviewNoNews": "没读新闻",
    "today.reviewRead": function (list) {
      return "读了 " + list;
    },
    "today.topicCount": function (topic, n) {
      return topic + " " + n + " 篇";
    },
    "today.summary": function (dist, words, sentences, days) {
      return (
        "主题分布：" +
        (dist || "本周还没有读完的新闻") +
        "；新增单词 " +
        words +
        " 个、句子 " +
        sentences +
        " 句；有学习的天数 " +
        days +
        "/7。"
      );
    },
    "today.adviceSteady": function (next) {
      return "节奏已经稳了。下周可以把新闻换成 L" + next + " 档，或者每天加 1 篇 TED 节选。";
    },
    "today.adviceOk": "保持 3 天以上就算成功。下周先固定一个时间点，比如早饭后 15 分钟。",
    "today.adviceLow": function (n) {
      return "本周只有 " + n + " 天，先只做 15 分钟最小版：新闻标题 + 首段 + 3 个词，做完就收工。";
    },
    "today.adviceFewWords": " 新词偏少，每篇点 3 个词就够了。",
    "today.advice": function (text) {
      return "下周建议：" + text;
    },
    "today.footer": function (date, note) {
      return "内容更新：" + date + "。" + note;
    },

    "paste.forItemTitle": "读完原文，把正文粘进来",
    "paste.forItemSub":
      "在原站全选复制正文，粘到下面：可以点词、点句朗读，本篇的标注词会用虚线框出来。粘贴的内容只存在你的学习记录里。",
    "paste.ownTitle": "粘一篇你自己的文章",
    "paste.ownSub": "任何英文段落都可以：同样能点读、存句子，只是没有本站注释。",
    "paste.placeholder": "Paste an English article here…",
    "paste.open": "打开精读",
    "paste.tooShort": "太短了，至少 20 个词",

    "news.intro":
      "每篇新闻带标题、原文链接、本站写的标注词和观点题。正文在原站读；想点读，把正文粘进来就能点词、点句朗读。",
    "news.original": "原文 ↗",
    "news.cardMeta": function (full, n) {
      return (full ? "可在站内精读" : "正文在原站") + " · " + n + " 个标注词 · 观点题";
    },
    "article.link": "原文链接",
    "article.note": function (level, shown, total, words) {
      return "L" + level + " · 本次显示 " + shown + " / " + total + " 段 · 约 " + words + " 词";
    },
    "article.showAll": "显示全文",
    "article.coveredAll": "全文（本档位已覆盖）",
    "article.onlyLevel": "只看档位片段",
    "article.readAll": "▶ 朗读全文",
    "cn.on": "中文：开",
    "cn.off": "中文：关",
    "cn.none": "无中文",
    "article.atSourceTitle": "正文在原站",
    "article.atSourceSub": "本站不收录新闻正文。先看标注词和观点题，再去原站读全文。",
    "article.openSource": "打开原文",
    "article.vocabTitle": function (n) {
      return "词汇精讲 · " + n;
    },
    "article.vocabBoxed": "文中虚线框住的词",
    "article.vocabBefore": "读原文前先过一遍",
    "vocab.coll": "搭配：",
    "article.breaksTitle": function (n) {
      return "长难句拆解 · " + n;
    },
    "break.main": "主干",
    "break.mods": "修饰成分挂在哪里",
    "break.cn": "中文大意",
    "break.model": "仿写",
    "break.modsShort": "修饰",
    "break.cnShort": "中文",
    "break.readSrc": "朗读原句",
    "break.save": "存进句子本",
    "article.notesTitle": "引申学习笔记",
    "article.examTitle": function (exam) {
      return "考试映射 · " + exam;
    },
    "article.examChange": "改目标考试",
    "map.reading": "阅读同义替换",
    "map.academic": "学术词汇",
    "map.sentence": "翻译 / 写作句型",
    "map.word": "高频词",
    "map.structure": "长难句结构",
    "map.writing": "写作可复用表达",
    "map.sep": "。",
    "map.colon": "：",
    "question.title": "今日观点问题",
    "question.hint": function (hint) {
      return "提示：" + hint;
    },
    "question.placeholder": "用英文写 2—3 句，写不完就先说一遍再写…",
    "question.record": "录一段口语",

    "quiz.title": function (n) {
      return "阅读理解 · " + n + " 题";
    },
    "quiz.sub": "先自己选，再对照解析",
    "quiz.right": "✓ 答对了 — ",
    "quiz.answer": function (letter) {
      return "正确答案 " + letter + " — ";
    },
    "quiz.score": function (done, total, right) {
      return "已做 " + done + "/" + total + " · 正确 " + right;
    },
    "quiz.reset": "重做",

    "ted.intro":
      "视频和官方文字稿都在 TED 官网；这里给摘要、标注词和观点题，看之前先过一遍，看完回来做题、记笔记。",
    "ted.cardMeta": function (level, lines, n) {
      return (
        level +
        (lines ? " · 双语稿 " + lines + " 句" : " · 文字稿在 TED 官网") +
        " · " +
        n +
        " 个标注词 · 摘要与观点题"
      );
    },
    "ted.linkMeta": function (level) {
      return level + " · 站内没有注释 · 点开去 TED 官网";
    },
    "ted.aboutMin": function (n) {
      return "约 " + n + " 分钟";
    },
    "ted.note": "站内不收录 TED 文字稿：官方文字稿在每个演讲页面的 Transcript 里。",
    "ted.videoEmbedded": "视频在 TED 官网播放（这里只嵌入文字稿）",
    "ted.videoAtTed": "视频和官方文字稿都在 TED 官网：打开演讲页面，点 Transcript 就能对照着看。",
    "ted.openVideo": "打开原视频",
    "ted.playLine": function (i) {
      return "播放第 " + i + " 句";
    },
    "ted.summaryTitleHtml": "Summary &amp; 核心观点",
    "ted.summarySub": "先看骨架再听",
    "ted.vocabSub": "点「加入词句库」收起来",
    "ted.breaksTitle": "长难句拆解",
    "ted.question": "观点问题",
    "ted.markDone": "标记今天看完",
    "notes.title": "我的笔记",
    "ted.notesPlaceholder": "记下你想在口语里用的一句话…",
    "notes.export": "导出 Markdown",
    "notes.empty": "(空)",

    "books.intro": "三本公版书原文，每本两段。点任意句子朗读，点生词看注释。",
    "books.passages": function (n) {
      return n + " 段";
    },
    "books.gutenberg": "Gutenberg 原文",
    "book.vocabTitle": function (n) {
      return "生词注释 · " + n;
    },
    "book.vocabSub": "虚线框住的是这些词",
    "book.goodTitle": "好句赏析",
    "book.readThis": "朗读这句",
    "book.todayTitle": "今天这段",
    "book.another": "换一段读",

    "pasted.defaultTitle": "我的文章",
    "pasted.forItem": "你粘贴的正文 · 虚线框住的是本篇标注词，点词看注释、点句朗读。",
    "pasted.plain": "粘贴的文本，点词听读音、点句朗读。",
    "pasted.howTitle": "怎么用这篇",
    "pasted.howSub": "粘贴来的也能精读",
    "pasted.howBody":
      "点任意单词听发音，有本站注释的会显示释义；点一个句子就从头读到尾；选中一段还能存进句子本。没有注释的词，加入词句库时可以自己写一条释义。",
    "pasted.back": "回到这篇的注释和观点题",
    "pasted.another": "换一篇",

    "media.intro":
      "休闲输入，全部来自 B 站，不用翻墙。挑一个先看 10 分钟，别做笔记，先让耳朵熟悉。点击卡片会新开原视频。",
    "media.type.vlog": "Vlog",
    "media.type.podcast": "播客",
    "media.type.ted": "TED",
    "media.views": function (n) {
      return n + " 播放";
    },
    "media.by": function (author, dur) {
      return "UP 主：" + author + " · " + dur;
    },
    "media.meta": function (sub, levels, scene) {
      return "字幕：" + sub + " · 适合 " + levels + " · 用法：" + scene;
    },
    "media.series": function (hours) {
      return "合集 " + hours + " 小时";
    },
    "media.note":
      "卡片信息（UP 主、时长、播放量）是 2026-11-09 的记录，可能已经变化；卡片用本站插画，不加载 B 站封面，点开会在新标签页打开原视频。",
    "scene.read": "精读",
    "scene.listen": "精听",
    "scene.shadow": "跟读",
    "scene.extensive": "泛听",
    "scene.relax": "休闲",
    "scene.exam": "考试",
    "scene.speak": "口语",

    "exams.intro": "题目围绕本站的新闻话题和名著原句，做完看示范答案和加分表达。",
    "exams.show": "看示范答案",
    "exams.hide": "收起答案",
    "exam.IELTS": "IELTS",
    "exam.TOEFL": "TOEFL",
    "exam.CET-4": "CET-4",
    "exam.CET-6": "CET-6",
    "exam.KAOYAN": "考研英语",
    "exam.NONE": "无明确考试",

    "words.tab.all": "全部",
    "words.tab.review": "复习",
    "words.tab.sentences": "句子本",
    "words.intro": "读书时点到的词都在这儿。每过几天回来过一遍，忘掉的会自动多来几轮。",
    "words.stat": function (n, due) {
      return "共 " + n + " 词 · 待复习 " + due;
    },
    "words.startReview": "开始复习",
    "words.exportJson": "导出 JSON",
    "words.empty": "还没有词。去新闻页点几个词试试——点一下就朗读，再点「加入词句库」。",
    "words.meta": function (src, n) {
      return "来自：" + src + " · 复习 " + n + " 次";
    },
    "sentences.empty": "还没有句子。选一段英文，点浮动工具条的「存句」就会进这里。",
    "sentences.from": function (src) {
      return "来自：" + src;
    },
    "review.none": "现在没有到期的词。去读一篇新闻，遇到生词点「加入词句库」。",
    "review.title": function (n) {
      return "复习 · 还剩 " + n + " 个";
    },
    "review.sub": "先自己说出意思，再选。选对加一轮，选错明天再来。",
    "review.listen": "听发音",
    "review.right": function (days) {
      return "对了 · " + days + " 天后再见";
    },
    "review.wrong": function (cn) {
      return "这个不对，正确答案是：" + cn;
    },

    "res.intro": "按类别整理，标注了费用、口音、字幕与适合档位。看不完就先收藏这一页。",
    "res.search": "搜索：",
    "res.auxTitle": "辅助工具（可选）",
    "res.auxBodyHtml":
      "Mera 英文阅读助手：网页阅读时直接给生词提示和长难句讲解。<br>L-feed Collect：划线标注、点词查义、多端同步。<br>本页的精读内容自带注释，不依赖任何插件。",
    "paid.free": "免费",
    "paid.freePartly": "免费（部分订阅）",
    "paid.trial": "付费（有试读）",
    "paid.metered": "付费（限量免费）",
    "paid.library": "免费（凭图书馆卡）",
    "accentTag.us": "美音",
    "accentTag.uk": "英音",
    "accentTag.mixed": "多口音",
    "accentTag.usSlow": "美音（慢速）",
    "accentTag.none": "—",

    "set.levelTitle": "难度档位",
    "set.levelSub":
      "档位决定正文截取长度、注释数量、长难句数量和是否显示中文。任务难度按当前档位，考试映射按目标考试。",
    "set.levelTip": function (level, tip) {
      return "L" + level + "：" + tip;
    },
    "set.levelCnHint": "提示：L1—L2 默认打开中文对照，可在阅读页右上角关掉。",
    "set.examTitle": "目标考试",
    "set.examSub": "新闻页和考试页会按这个考试给出表达。",
    "set.readTitle": "朗读",
    "set.accent": "口音",
    "set.accentUS": "美音 en-US",
    "set.accentUK": "英音 en-GB",
    "set.rate": "语速",
    "set.test": "试听一句",
    "set.noSound":
      "如果没声音：Chrome / Edge 一般自带语音；Firefox 与部分系统需要先安装英文语音包。",
    "set.displayTitle": "阅读显示",
    "set.cnOn": "中文对照：开",
    "set.cnOff": "中文对照：关",
    "set.theme": function (name) {
      return "主题：" + name;
    },
    "theme.auto": "跟随系统",
    "theme.dark": "深色",
    "theme.light": "浅色",
    "set.spreadOn": "左右开页：开",
    "set.spreadOff": "左右开页：关（单栏）",
    "set.spreadHint": "电脑上左页读正文、右页看解析，两页各自滚动；窗口变窄或手机上自动变回单栏。",
    "set.langTitle": "界面语言",
    "set.langSub": "只改变界面文字；阅读材料、释义和译文保持原样。",
    "set.pressTitle": "每日外刊联网",
    "set.dataTitle": "数据",
    "set.dataSub":
      "设置和学习记录保存在这个工作台里（服务端），浏览器里不留副本：换一个浏览器打开同一个工作台，记录还在；移除工作台会把记录一起删掉。界面语言是例外，只记在这个浏览器里。",
    "set.export": "导出全部记录",
    "set.clear": "清空学习记录",
    "set.clearConfirm": "再点一次：清空词句库、进度和笔记（设置保留）",

    "more.press": "主流外刊的 RSS 标题（先打开联网），粘贴正文就能精读",
    "more.wechat": "14 个值得跟的号 + 粘贴正文导入",
    "more.media": "休闲输入，挑一个看 10 分钟",
    "more.exams": "雅思 / 托福 / 四六级 / 考研微练",
    "more.words": "点过的词、存下的句子",
    "more.resources": "分类资源清单",
    "more.settings": "档位、目标考试、口音、左右开页、界面语言、数据",

    "press.cat.all": "全部",
    "press.cat.world": "世界",
    "press.cat.business": "商业",
    "press.cat.culture": "文化",
    "press.cat.tech": "科技",
    "press.cat.science": "科学",
    "ago.now": "刚刚",
    "ago.min": function (n) {
      return n + " 分钟前";
    },
    "ago.hour": function (n) {
      return n + " 小时前";
    },
    "ago.day": function (n) {
      return n + " 天前";
    },
    "press.someFeeds": "固定的几个外刊订阅源",
    "press.gateOn": function (hosts) {
      return (
        "每日外刊已打开：服务端读取 " +
        hosts +
        " 的 RSS（每 20 分钟最多一次），封面图由浏览器直接从各站加载。"
      );
    },
    "press.gateOff": function (hosts) {
      return (
        "每日外刊已关闭，工作台不联网。打开后，服务端会读取 " +
        hosts +
        " 的 RSS（每 20 分钟最多一次），封面图由浏览器直接从各站加载。"
      );
    },
    "press.turnOff": "关闭每日外刊",
    "press.turnOn": "打开每日外刊",
    "press.saveFailed": "没能保存设置",
    "press.fallbackSource": "外刊",
    "press.cnBadge": "中",
    "press.cnBadgeTitle": "带中文对照",
    "press.openSite": "打开原站",
    "press.continue": "继续精读",
    "press.pasteRead": "粘贴正文精读",
    "press.intro":
      "打开联网后，这里按「今天更新 / 更早」列出主流外刊 RSS 里的标题和摘要，每条都标了来源与原文链接；想精读，就在原站复制正文，粘到下面的「导入一篇」（点词、点句朗读、存词句库）。",
    "press.importedTitle": function (n) {
      return "已导入 · 打开就能精读 · " + n;
    },
    "press.importedSub": "存在你的学习记录里",
    "press.todayTitle": "今天的外刊",
    "press.loading": "正在读取…",
    "press.fetching": "正在抓取最新外刊…",
    "press.refresh": "↻ 刷新最新",
    "press.refreshOff": "先打开每日外刊",
    "press.emptyOff": "打开上面的「每日外刊」后，这里会列出今天的外刊。",
    "press.emptyError": "这次没抓到，点「刷新最新」再试一次。",
    "press.emptyCat": "这个分类今天还没有新文章。",
    "press.sectionToday": "今天更新",
    "press.sectionOlder": "更早",
    "press.offCached": function (n, when) {
      return "联网已关闭 · 下面是上次抓到的 " + n + " 条（" + when + "），不再更新";
    },
    "press.offEmpty": "联网已关闭",
    "press.status": function (n, when, err) {
      return (
        "共 " +
        n +
        " 条 · 更新于 " +
        when +
        "（缓存 20 分钟）" +
        (err ? " · 这次刷新失败：" + err : "")
      );
    },
    "press.noneYet": "暂时没有抓到文章。",

    "import.title": "导入一篇",
    "import.kinds": "公众号文章 / 任意网页 / 纯文本",
    "import.sub":
      "在原文页面（微信里也一样）全选复制正文，粘到下面，段落之间空一行。工作台不会替你去抓网页。",
    "import.titlePh": "标题（可留空）",
    "import.sourcePh": "来源，比如 LearnAndRecord（可留空）",
    "import.urlPh": "原文链接（可留空），以 https:// 开头",
    "import.textPh": "把英文正文粘在这里，段落之间空一行",
    "import.go": "导入这段正文",
    "import.busy": "正在整理段落…",
    "import.failed": "导入失败",
    "import.filled":
      "已填好标题和链接。先点「原文链接」在新标签页打开文章，复制正文后粘到上面的框里。",
    "import.defaultTitle": "粘贴的外刊",
    "import.defaultSource": "粘贴导入",

    "pressitem.missingTitle": "这篇不在记录里了",
    "pressitem.missingSub": "导入的文章只留最近 24 篇，可能已经被清掉。",
    "pressitem.back": "回每日外刊",
    "pressitem.note": function (level, shown, total, words) {
      return (
        "L" +
        level +
        " · 本次显示 " +
        shown +
        " / " +
        total +
        " 段 · 约 " +
        words +
        " 词 · 点单词听发音、点句子朗读"
      );
    },
    "pressitem.sourceLabel": "来源：",
    "pressitem.original": "原文 ↗",
    "pressitem.readFirst": "只读第一段",
    "pressitem.noCnTitle": "这篇还没有译文",
    "pressitem.readCheck": "已读 ✓",
    "pressitem.markRead": "标记今天读了",
    "pressitem.cnHint": function (shown, total, on) {
      return (
        "已显示 " +
        shown +
        " / " +
        total +
        " 段 · 中文对照" +
        (on ? "已打开" : "已关闭") +
        "，点「中文」随时切换；想看全文点「显示全文」。"
      );
    },
    "pressitem.noCnHint":
      "粘贴导入的文章没有中文对照。可以点「只读第一段」，或到设置里调整档位，决定一次显示多少段。",
    "pressitem.notesSub": "只存在你的学习记录里",
    "pressitem.notesPh": "记下生词、好句、或者你想练的一句话…",
    "pressitem.originTitle": "出处",
    "pressitem.noLink": "这篇是粘贴导入的，没有填原文链接。",
    "pressitem.delete": "从记录里删掉这篇",

    "wechat.intro":
      "公众号的文章在微信里读，这里给你清单、读法和导入：看到好文章，把正文粘进来就能点词听发音、点句朗读。",
    "wechat.howTitle": "怎么把公众号文章变成精读",
    "wechat.howSteps": "三步",
    "wechat.step1": "在微信里打开文章，长按正文全选、复制（链接可以点右上角「…」→ 复制链接）。",
    "wechat.step2": "回到这里，把正文粘到下面「导入一篇」的正文框，标题、来源和链接可以一起填上。",
    "wechat.step3": "点「导入这段正文」，就能点词、点句朗读，好句存进句子本。",
    "wechat.type.press": "外刊精读",
    "wechat.type.speaking": "口语发音",
    "wechat.type.listening": "听力泛听",
    "wechat.type.writing": "写作翻译",
    "wechat.type.general": "综合学习",
    "wechat.type.exam": "考试备考",
    "wechat.copyName": "复制名字",
    "wechat.search": "去搜一搜",
    "wechat.foot":
      "清单按「读什么、怎么读」整理，不含二维码，也不代替你关注；账号名可在微信里直接搜到。",
  };

  var en = {
    "doc.title": "English Learning Workbench",
    "doc.description":
      "English Learning Workbench: read classics aloud word by word, news and TED guides, close reading of pasted articles, a daily press feed, a word and sentence library with review, shadowing and exam practice.",
    "app.name": "English Learning Workbench",
    "brand.home": "English Learning Workbench home",
    "lang.switch": "中文",
    "lang.switchLabel": "切换到中文",
    "lang.zh": "中文",
    "lang.en": "English",
    "list.sep": ", ",
    "common.all": "All",
    "common.read": "Read aloud",
    "common.slow": "Slow",
    "common.delete": "Remove",
    "common.done": "Done ✓",
    "common.markRead": "Mark as read today",

    "nav.main": "Main navigation",
    "nav.today": "Today",
    "nav.press": "Daily press",
    "nav.news": "News reading",
    "nav.ted": "TED talks",
    "nav.books": "Classics",
    "nav.media": "Vlogs & podcasts",
    "nav.wechat": "WeChat accounts",
    "nav.exams": "Exam practice",
    "nav.words": "My library",
    "nav.resources": "Resources",
    "nav.settings": "Settings",
    "tab.label": "Bottom navigation",
    "tab.today": "Today",
    "tab.press": "Press",
    "tab.news": "News",
    "tab.words": "Library",
    "tab.more": "More",
    "title.pressitem": "Press reading",

    "side.loading": "Reading your record…",
    "side.updated": "Content updated",
    "side.streak": function (n) {
      return n + "-day streak";
    },
    "top.minutes": function (n) {
      return n + " min";
    },
    "theme.toggle": "Toggle dark mode",
    "theme.toDark": "Dark mode on",
    "theme.toLight": "Light mode on",

    "rd.label": "Read-aloud controls",
    "rd.pause": "Pause or resume reading",
    "rd.pauseTitle": "Pause / resume",
    "rd.stop": "Stop reading",
    "rd.stopTitle": "Stop",
    "rd.rate": "Speed",
    "rd.rateLabel": "Reading speed",
    "rd.accentLabel": "Switch between US and UK accent",
    "rd.rec": "Shadow",
    "rd.recLabel": "Record yourself",
    "pop.label": "Word details",
    "sel.speak": "Read",
    "sel.slow": "Slow",
    "sel.save": "Save",
    "sel.copy": "Copy",

    "tts.idle": "Click a word or a sentence to hear it",
    "tts.unsupported": "This browser cannot read aloud",
    "tts.done": "Done · click another sentence",
    "tts.blocked": "The browser blocked reading aloud; click the page and try again",
    "tts.failed": "That did not play; click again",
    "tts.startFailed": "Reading aloud could not start",
    "tts.resumed": "Reading…",
    "tts.paused": "Paused",
    "read.tip":
      "Click a word to hear it and see its note · click a sentence to hear it · words in a dashed box are annotated here",

    "level.1": "Basic",
    "level.2": "Intermediate",
    "level.3": "Upper intermediate",
    "level.4": "Advanced",
    "level.1.tip": "Shorter passages and more notes: understand first, speed comes later",
    "level.2.tip": "Read the whole piece closely and retell it; one a day is enough",
    "level.3.tip": "Fewer notes; follow the structure and the argument",
    "level.4.tip": "Read the whole piece fast; focus on the argument and the rebuttal",

    "passage.play": "▶ Play paragraph",
    "passage.shadow": "Shadow",
    "pop.marked": "Annotated here",
    "pop.noNote":
      "There is no note for this word here. Listen first, then write your own meaning: writing it down helps it stick.",
    "pop.coll": "Collocations",
    "pop.ex": "Example",
    "pop.src": "From",
    "pop.placeholder": "Your meaning, for example: n. a formal request",
    "pop.inLib": "In your library",
    "pop.add": "Add to library",
    "pop.added": "Added",
    "word.noMeaning": "(meaning to add)",
    "toast.addedWord": "Added to your library",
    "toast.copied": "Copied",
    "toast.copyFailed": "Copy failed",
    "toast.wordExists": "This word is already in your library",
    "toast.sentenceExists": "You already saved this sentence",
    "toast.sentenceSaved": "Saved to your sentences",
    "toast.cleared": "Cleared",
    "toast.removed": "Removed",

    "rec.unsupported": "This browser cannot record",
    "rec.stop": "Stop recording",
    "rec.recording": function (time) {
      return "Recording " + time + " · click Stop recording to finish";
    },
    "rec.noMic": "No microphone access: allow it once to record",
    "rec.done": "Recorded: play it back to compare",
    "rec.replay": "Hear the original again",
    "rec.delete": "Delete",
    "rec.memoryOnly": "The recording stays in this page's memory and is gone when you reload",
    "accent.us": "US",
    "accent.uk": "UK",
    "accent.toUS": "US accent",
    "accent.toUK": "UK accent (the closest voice is used when there is no UK one)",

    "err.network": "network error",
    "err.http": function (status) {
      return "request failed (" + status + ")";
    },
    "err.data-missing": "the request carries no record",
    "err.data-invalid": "the record is not in the expected form",
    "err.data-too-large": "the record is over 700 KB: export it, then clear some of it",
    "err.online-invalid": "the switch can only be on or off",
    "err.press-failed": "fetching failed",
    "err.feeds-unreachable": "none of the feeds answered",
    "err.url-invalid": "The link must start with http:// or https://",
    "err.text-too-long": "The text is too long: at most 200,000 characters at a time",
    "err.text-too-short": "The text is too short: at least 40 English words",
    "err.not-found": "no such route",
    "sync.saveFailed": function (message, retry) {
      return "Your record was not saved: " + message + (retry ? "; retrying shortly" : "");
    },
    "sync.notLoaded": "Record not loaded · changes are not saved",
    "sync.failing": "Record not saved · retrying",
    "sync.ok": "Record kept in the workbench",
    "sync.loadFailed":
      "Could not read your learning record. So that nothing saved is overwritten, changes made now are not saved; reload later.",

    "heat.done": function (n) {
      return n + " done";
    },
    "heat.none": "nothing recorded",

    "greet.night": "Still up? Read a short passage, then sleep",
    "greet.morning": "Good morning: read a passage before the day starts",
    "greet.afternoon": "Good afternoon: just the time for one article",
    "greet.evening": "Good evening: a passage before bed",
    "today.eyebrow": function (date, level, levelName, exam) {
      return date + " · L" + level + " " + levelName + " · Goal: " + exam;
    },
    "today.lead": function (tip) {
      return (
        tip +
        ". Today's news, TED talk and classic are below: read the classic right here; for the news and the talk, go through the notes and the question first, then read the full text at the source."
      );
    },
    "today.planTitle": function (m) {
      return "Your " + m + " minutes today";
    },
    "today.pickNews": function (topic) {
      return "Today's news · " + topic;
    },
    "today.pickTed": "Today's TED talk",
    "today.pickBook": "Today's classic",
    "meta.aboutWords": function (n) {
      return "about " + n + " words";
    },
    "meta.annotated": function (n) {
      return n + plural(n, " annotated word", " annotated words");
    },
    "today.speakTitle": "10 minutes of speaking",
    "today.speakSub": "Practise with today's news question: ",
    "today.speakGo": "Answer and record on the news page",
    "today.examTitle": function (exam) {
      return "Exam practice · " + exam;
    },
    "today.examGo": "Try it",
    "today.dueTitle": function (n) {
      return n + plural(n, " word to review", " words to review");
    },
    "today.dueNone":
      "No words are due yet. Add new words to your library while you read, and review them here when they come due.",
    "today.dueGo": "Review in your library",
    "today.week": "This week",
    "today.statDays": "Days studied",
    "today.statWords": "Words saved",
    "today.statSentences": "Sentences saved",
    "today.statStreak": "Day streak",
    "today.last30": "Last 30 days",
    "today.goPress": "Today's press",
    "today.goWechat": "WeChat account list",
    "today.review": "Weekly review",
    "today.reviewSub":
      "The last 7 days at a glance: what you read, what you saved, and what to adjust next week.",
    "today.reviewNews": "news",
    "today.reviewTasks": function (n) {
      return n + plural(n, " task", " tasks");
    },
    "today.reviewNoNews": "No news read",
    "today.reviewRead": function (list) {
      return "Read: " + list;
    },
    "today.topicCount": function (topic, n) {
      return topic + " " + n;
    },
    "today.summary": function (dist, words, sentences, days) {
      return (
        "Topics: " +
        (dist || "no news finished this week") +
        "; new words: " +
        words +
        ", new sentences: " +
        sentences +
        "; days studied: " +
        days +
        "/7."
      );
    },
    "today.adviceSteady": function (next) {
      return (
        "Your rhythm is steady. Next week, try the news at level L" +
        next +
        ", or add a TED excerpt each day."
      );
    },
    "today.adviceOk":
      "Three days or more counts as a success. Next week, fix one time of day, such as 15 minutes after breakfast.",
    "today.adviceLow": function (n) {
      return (
        "Only " +
        n +
        plural(n, " day", " days") +
        " this week. Start with the 15-minute minimum: a headline, the first paragraph and 3 words, then stop."
      );
    },
    "today.adviceFewWords": " Few new words: three per article is enough.",
    "today.advice": function (text) {
      return "Next week: " + text;
    },
    "today.footer": function (date, note) {
      return "Content updated " + date + ". " + note;
    },

    "paste.forItemTitle": "Read the original, then paste its text here",
    "paste.forItemSub":
      "Copy the article text at the source and paste it below: click words and sentences to hear them, and this story's annotated words are boxed. What you paste is kept only in your learning record.",
    "paste.ownTitle": "Paste an article of your own",
    "paste.ownSub":
      "Any English text works: you can click it to hear it and save sentences; there are just no notes.",
    "paste.placeholder": "Paste an English article here…",
    "paste.open": "Open in the reader",
    "paste.tooShort": "Too short: at least 20 words",

    "news.intro":
      "Each story comes with its headline, a link to the original, and annotated words and a question written for this workbench. Read the text at the source; to read it here word by word, paste it in.",
    "news.original": "Original ↗",
    "news.cardMeta": function (full, n) {
      return (
        (full ? "Readable here" : "Text at the source") +
        " · " +
        n +
        plural(n, " annotated word", " annotated words") +
        " · a question"
      );
    },
    "article.link": "Original article",
    "article.note": function (level, shown, total, words) {
      return (
        "L" +
        level +
        " · showing " +
        shown +
        " / " +
        total +
        " paragraphs · about " +
        words +
        " words"
      );
    },
    "article.showAll": "Show the whole text",
    "article.coveredAll": "Whole text (your level covers it)",
    "article.onlyLevel": "Only my level's part",
    "article.readAll": "▶ Read it all",
    "cn.on": "Chinese: on",
    "cn.off": "Chinese: off",
    "cn.none": "No Chinese",
    "article.atSourceTitle": "The text is at the source",
    "article.atSourceSub":
      "This workbench does not carry news text. Go through the annotated words and the question, then read the full article at the source.",
    "article.openSource": "Open the original",
    "article.vocabTitle": function (n) {
      return "Vocabulary · " + n;
    },
    "article.vocabBoxed": "Boxed in the text",
    "article.vocabBefore": "Go through them before reading",
    "vocab.coll": "Collocations: ",
    "article.breaksTitle": function (n) {
      return "Long sentences · " + n;
    },
    "break.main": "Core",
    "break.mods": "Where the modifiers attach",
    "break.cn": "Gist in Chinese",
    "break.model": "Your turn",
    "break.modsShort": "Modifiers",
    "break.cnShort": "Chinese",
    "break.readSrc": "Read the sentence",
    "break.save": "Save to sentences",
    "article.notesTitle": "Further notes",
    "article.examTitle": function (exam) {
      return "For your exam · " + exam;
    },
    "article.examChange": "Change exam",
    "map.reading": "Reading: paraphrase",
    "map.academic": "Academic word",
    "map.sentence": "Translation / writing pattern",
    "map.word": "High-frequency word",
    "map.structure": "Long-sentence structure",
    "map.writing": "Reusable in writing",
    "map.sep": ". ",
    "map.colon": ": ",
    "question.title": "Today's question",
    "question.hint": function (hint) {
      return "Hint: " + hint;
    },
    "question.placeholder": "Write 2–3 sentences in English; if you get stuck, say it aloud first…",
    "question.record": "Record your answer",

    "quiz.title": function (n) {
      return "Comprehension · " + n + plural(n, " question", " questions");
    },
    "quiz.sub": "Choose first, then read the explanation",
    "quiz.right": "✓ Correct — ",
    "quiz.answer": function (letter) {
      return "Answer " + letter + " — ";
    },
    "quiz.score": function (done, total, right) {
      return "Done " + done + "/" + total + " · correct " + right;
    },
    "quiz.reset": "Start over",

    "ted.intro":
      "The video and the official transcript are on TED's site. Here you get a summary, annotated words and a question: go through them before watching, then come back for the question and your notes.",
    "ted.cardMeta": function (level, lines, n) {
      return (
        level +
        (lines ? " · bilingual transcript, " + lines + " lines" : " · transcript on TED's site") +
        " · " +
        n +
        plural(n, " annotated word", " annotated words") +
        " · summary and question"
      );
    },
    "ted.linkMeta": function (level) {
      return level + " · no notes here · opens TED's site";
    },
    "ted.aboutMin": function (n) {
      return "about " + n + " min";
    },
    "ted.note":
      "This workbench does not carry TED transcripts: the official one is under Transcript on each talk's page.",
    "ted.videoEmbedded": "The video plays on TED's site (only the transcript is here)",
    "ted.videoAtTed":
      "The video and the official transcript are on TED's site: open the talk's page and click Transcript to follow along.",
    "ted.openVideo": "Open the video",
    "ted.playLine": function (i) {
      return "Play line " + i;
    },
    "ted.summaryTitleHtml": "Summary &amp; key ideas",
    "ted.summarySub": "The outline before you listen",
    "ted.vocabSub": "Add a word to keep it",
    "ted.breaksTitle": "Long sentences",
    "ted.question": "Question",
    "ted.markDone": "Mark as watched today",
    "notes.title": "My notes",
    "ted.notesPlaceholder": "Note a sentence you want to use when you speak…",
    "notes.export": "Export Markdown",
    "notes.empty": "(empty)",

    "books.intro":
      "Public-domain text from three books, two passages each. Click any sentence to hear it, and a word for its note.",
    "books.passages": function (n) {
      return n + plural(n, " passage", " passages");
    },
    "books.gutenberg": "Full text at Gutenberg",
    "book.vocabTitle": function (n) {
      return "Words · " + n;
    },
    "book.vocabSub": "These are the boxed words",
    "book.goodTitle": "A sentence to study",
    "book.readThis": "Read this sentence",
    "book.todayTitle": "Today's passage",
    "book.another": "Another passage",

    "pasted.defaultTitle": "My article",
    "pasted.forItem":
      "The text you pasted · boxed words are annotated for this story; click a word for its note, a sentence to hear it.",
    "pasted.plain": "Pasted text: click a word to hear it, a sentence to have it read.",
    "pasted.howTitle": "How to use it",
    "pasted.howSub": "Pasted text reads like any other",
    "pasted.howBody":
      "Click any word to hear it; annotated words also show their meaning. Click a sentence to hear it from start to end, or select a passage to save it. For a word without a note, write your own meaning when you add it to your library.",
    "pasted.back": "Back to this story's notes and question",
    "pasted.another": "Another article",

    "media.intro":
      "Relaxed listening, all on Bilibili. Pick one and watch 10 minutes without taking notes: just let your ears get used to it. A card opens the video in a new tab.",
    "media.type.vlog": "Vlog",
    "media.type.podcast": "Podcast",
    "media.type.ted": "TED",
    "media.views": function (n) {
      return n + " views";
    },
    "media.by": function (author, dur) {
      return "By " + author + " · " + dur;
    },
    "media.meta": function (sub, levels, scene) {
      return "Subtitles: " + sub + " · suits " + levels + " · use: " + scene;
    },
    "media.series": function (hours) {
      return "series, " + hours + " h";
    },
    "media.note":
      "Card details (uploader, length, views) were recorded on 2026-11-09 and may have changed. Cards show this workbench's own illustrations, not Bilibili covers; a card opens the video in a new tab.",
    "scene.read": "Close reading",
    "scene.listen": "Close listening",
    "scene.shadow": "Shadowing",
    "scene.extensive": "Background listening",
    "scene.relax": "Relaxing",
    "scene.exam": "Exams",
    "scene.speak": "Speaking",

    "exams.intro":
      "Tasks built on this workbench's news topics and classic sentences. Afterwards, read the model answer and the phrases that lift a score.",
    "exams.show": "Show the model answer",
    "exams.hide": "Hide the answer",
    "exam.IELTS": "IELTS",
    "exam.TOEFL": "TOEFL",
    "exam.CET-4": "CET-4",
    "exam.CET-6": "CET-6",
    "exam.KAOYAN": "Kaoyan English",
    "exam.NONE": "No specific exam",

    "words.tab.all": "All",
    "words.tab.review": "Review",
    "words.tab.sentences": "Sentences",
    "words.intro":
      "The words you add while reading are here. Come back every few days: the ones you forget come round more often.",
    "words.stat": function (n, due) {
      return n + plural(n, " word", " words") + " · " + due + " due";
    },
    "words.startReview": "Start review",
    "words.exportJson": "Export JSON",
    "words.empty":
      "No words yet. Click a few words in a news story: each one is read aloud, then click Add to library.",
    "words.meta": function (src, n) {
      return "From: " + src + " · reviewed " + n + plural(n, " time", " times");
    },
    "sentences.empty":
      "No sentences yet. Select some English text and click Save on the floating bar.",
    "sentences.from": function (src) {
      return "From: " + src;
    },
    "review.none": "No words are due. Read a news story and add new words to your library.",
    "review.title": function (n) {
      return "Review · " + n + " left";
    },
    "review.sub":
      "Say the meaning yourself first, then choose. A right answer moves the word on; a wrong one brings it back tomorrow.",
    "review.listen": "Listen",
    "review.right": function (days) {
      return "Right · see it again in " + days + plural(days, " day", " days");
    },
    "review.wrong": function (cn) {
      return "Not that one. The answer is: " + cn;
    },

    "res.intro":
      "Grouped by kind, each marked with its cost, accent, subtitles and level. Bookmark this page and come back to it.",
    "res.search": "Search: ",
    "res.auxTitle": "Helper tools (optional)",
    "res.auxBodyHtml":
      "Mera English reading assistant: word hints and long-sentence explanations while you read web pages.<br>L-feed Collect: highlights, click-to-look-up and sync across devices.<br>The reading material here carries its own notes and needs no add-on.",
    "paid.free": "Free",
    "paid.freePartly": "Free (some subscriber-only)",
    "paid.trial": "Paid (free samples)",
    "paid.metered": "Paid (a few free articles)",
    "paid.library": "Free with a library card",
    "accentTag.us": "US accent",
    "accentTag.uk": "UK accent",
    "accentTag.mixed": "Mixed accents",
    "accentTag.usSlow": "US accent (slow)",
    "accentTag.none": "—",

    "set.levelTitle": "Level",
    "set.levelSub":
      "Your level sets how much text is shown, how many notes and long sentences you get, and whether Chinese is shown. Tasks follow your level; exam tips follow your target exam.",
    "set.levelTip": function (level, tip) {
      return "L" + level + ": " + tip;
    },
    "set.levelCnHint":
      "At L1–L2 the Chinese translation is on by default; turn it off at the top of a reading page.",
    "set.examTitle": "Target exam",
    "set.examSub": "The news and exam pages tailor their phrases to this exam.",
    "set.readTitle": "Read aloud",
    "set.accent": "Accent",
    "set.accentUS": "US English en-US",
    "set.accentUK": "UK English en-GB",
    "set.rate": "Speed",
    "set.test": "Try a sentence",
    "set.noSound":
      "No sound? Chrome and Edge usually have voices built in; Firefox and some systems need an English voice pack installed first.",
    "set.displayTitle": "Display",
    "set.cnOn": "Chinese translation: on",
    "set.cnOff": "Chinese translation: off",
    "set.theme": function (name) {
      return "Theme: " + name;
    },
    "theme.auto": "Automatic",
    "theme.dark": "Dark",
    "theme.light": "Light",
    "set.spreadOn": "Two pages: on",
    "set.spreadOff": "Two pages: off (one column)",
    "set.spreadHint":
      "On a computer the text is on the left page and the notes on the right, each scrolling on its own; a narrow window or a phone shows one column.",
    "set.langTitle": "Interface language",
    "set.langSub":
      "Changes the interface only; the reading material, meanings and translations stay as they are.",
    "set.pressTitle": "Daily press online",
    "set.dataTitle": "Data",
    "set.dataSub":
      "Settings and your learning record are kept in this workbench, on the server, with no copy in the browser: open the same workbench in another browser and the record is there; removing the workbench deletes it. The interface language is the exception: only this browser remembers it.",
    "set.export": "Export the whole record",
    "set.clear": "Clear learning record",
    "set.clearConfirm": "Click again to clear your library, progress and notes (settings stay)",

    "more.press":
      "Headlines from major papers' RSS feeds (switch it on first); paste the text to read closely",
    "more.wechat": "14 accounts worth following, and paste-in import",
    "more.media": "Relaxed listening: pick one for 10 minutes",
    "more.exams": "Short tasks for IELTS, TOEFL, CET and Kaoyan",
    "more.words": "The words and sentences you saved",
    "more.resources": "Resources by kind",
    "more.settings": "Level, target exam, accent, layout, language and data",

    "press.cat.all": "All",
    "press.cat.world": "World",
    "press.cat.business": "Business",
    "press.cat.culture": "Culture",
    "press.cat.tech": "Tech",
    "press.cat.science": "Science",
    "ago.now": "just now",
    "ago.min": function (n) {
      return n + " min ago";
    },
    "ago.hour": function (n) {
      return n + " h ago";
    },
    "ago.day": function (n) {
      return n + plural(n, " day ago", " days ago");
    },
    "press.someFeeds": "a fixed set of press feeds",
    "press.gateOn": function (hosts) {
      return (
        "The daily press is on: the server reads the RSS feeds of " +
        hosts +
        " (at most once every 20 minutes), and your browser loads the cover pictures straight from those sites."
      );
    },
    "press.gateOff": function (hosts) {
      return (
        "The daily press is off, and the workbench contacts nothing outside. Once on, the server reads the RSS feeds of " +
        hosts +
        " (at most once every 20 minutes), and your browser loads the cover pictures straight from those sites."
      );
    },
    "press.turnOff": "Turn the daily press off",
    "press.turnOn": "Turn the daily press on",
    "press.saveFailed": "Could not save the setting",
    "press.fallbackSource": "Press",
    "press.cnBadge": "CN",
    "press.cnBadgeTitle": "Has a Chinese translation",
    "press.openSite": "Open the site",
    "press.continue": "Continue reading",
    "press.pasteRead": "Paste the text to read",
    "press.intro":
      "With the daily press on, headlines and summaries from major papers' RSS feeds are listed here under Today and Earlier, each with its source and a link. To read one closely, copy its text at the source and paste it into Import an article below (click words and sentences to hear them, save words).",
    "press.importedTitle": function (n) {
      return "Imported · ready to read · " + n;
    },
    "press.importedSub": "Kept in your learning record",
    "press.todayTitle": "Today's press",
    "press.loading": "Loading…",
    "press.fetching": "Fetching the latest articles…",
    "press.refresh": "↻ Refresh",
    "press.refreshOff": "Turn the daily press on first",
    "press.emptyOff": "Turn on the daily press above and today's articles are listed here.",
    "press.emptyError": "Nothing came in this time; click Refresh to try again.",
    "press.emptyCat": "Nothing new in this category today.",
    "press.sectionToday": "Today",
    "press.sectionOlder": "Earlier",
    "press.offCached": function (n, when) {
      return (
        "Offline · these " +
        n +
        plural(n, " item is", " items are") +
        " from the last fetch (" +
        when +
        ") and no longer updated"
      );
    },
    "press.offEmpty": "Offline",
    "press.status": function (n, when, err) {
      return (
        n +
        plural(n, " item", " items") +
        " · updated " +
        when +
        " (cached for 20 minutes)" +
        (err ? " · this refresh failed: " + err : "")
      );
    },
    "press.noneYet": "No articles yet.",

    "import.title": "Import an article",
    "import.kinds": "A WeChat article, any web page or plain text",
    "import.sub":
      "On the article's page (in WeChat too), select and copy the text and paste it below, with a blank line between paragraphs. The workbench never fetches the page for you.",
    "import.titlePh": "Title (optional)",
    "import.sourcePh": "Source, for example LearnAndRecord (optional)",
    "import.urlPh": "Link to the original (optional), starting with https://",
    "import.textPh": "Paste the English text here, with a blank line between paragraphs",
    "import.go": "Import this text",
    "import.busy": "Splitting it into paragraphs…",
    "import.failed": "Import failed",
    "import.filled":
      "The title and link are filled in. Click Original article to open it in a new tab, copy its text and paste it into the box above.",
    "import.defaultTitle": "Pasted article",
    "import.defaultSource": "Pasted",

    "pressitem.missingTitle": "This article is no longer in your record",
    "pressitem.missingSub":
      "Only the 24 most recent imports are kept; this one may have been cleared.",
    "pressitem.back": "Back to the daily press",
    "pressitem.note": function (level, shown, total, words) {
      return (
        "L" +
        level +
        " · showing " +
        shown +
        " / " +
        total +
        " paragraphs · about " +
        words +
        " words · click a word to hear it, a sentence to have it read"
      );
    },
    "pressitem.sourceLabel": "Source: ",
    "pressitem.original": "original ↗",
    "pressitem.readFirst": "Read the first paragraph",
    "pressitem.noCnTitle": "No translation for this article",
    "pressitem.readCheck": "Read ✓",
    "pressitem.markRead": "Mark as read today",
    "pressitem.cnHint": function (shown, total, on) {
      return (
        "Showing " +
        shown +
        " / " +
        total +
        " paragraphs · Chinese translation " +
        (on ? "on" : "off") +
        "; switch it with the Chinese button, and click Show the whole text for all of it."
      );
    },
    "pressitem.noCnHint":
      "A pasted article has no Chinese translation. Click Read the first paragraph, or change your level in Settings to set how many paragraphs show at once.",
    "pressitem.notesSub": "Kept only in your learning record",
    "pressitem.notesPh": "Note new words, good sentences, or a line you want to practise…",
    "pressitem.originTitle": "Source",
    "pressitem.noLink": "This article was pasted in without a link to the original.",
    "pressitem.delete": "Remove it from your record",

    "wechat.intro":
      "WeChat articles are read in WeChat. Here you get a list, how to read each account, and an import: paste a good article's text to click its words and sentences and hear them.",
    "wechat.howTitle": "Turning a WeChat article into close reading",
    "wechat.howSteps": "Three steps",
    "wechat.step1":
      "Open the article in WeChat, press and hold the text to select all of it, and copy it (for the link, tap … at the top right, then Copy Link).",
    "wechat.step2":
      "Come back here and paste the text into the box of Import an article below; add the title, source and link if you like.",
    "wechat.step3":
      "Click Import this text: then click words and sentences to hear them, and save good sentences.",
    "wechat.type.press": "Press reading",
    "wechat.type.speaking": "Speaking & pronunciation",
    "wechat.type.listening": "Listening",
    "wechat.type.writing": "Writing & translation",
    "wechat.type.general": "General",
    "wechat.type.exam": "Exam prep",
    "wechat.copyName": "Copy the name",
    "wechat.search": "Search for it",
    "wechat.foot":
      "The list is organised by what to read and how. It has no QR codes and follows nothing for you; search for an account's name in WeChat to find it.",
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

  window.EnglishI18n = { lang: lang, setLang: setLang, t: t, onChange: onChange, strings: strings };
})();
