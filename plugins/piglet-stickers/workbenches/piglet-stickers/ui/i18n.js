/* Piggy Sticker World: the interface language, Chinese or English.
 *
 * A classic script, loaded right after storage-bridge.js and before the game's scripts. It sets
 * window.PigletI18n:
 *
 *   lang()           "zh" or "en"
 *   setLang(code)    switches to "zh" or "en" (anything else is ignored), remembers the choice
 *                    under zz_lang, sets <html lang> and calls every onChange listener
 *   t(key, ...args)  the current language's text; a function entry is called with args; a key
 *                    the current language lacks falls back to the other one, then to the key
 *   onChange(fn)     registers fn(code), called after every setLang
 *   strings          { zh, en }: two flat dictionaries with the same keys
 *
 * At start a saved "zh" or "en" wins; otherwise a device language starting with "zh" gives
 * Chinese and anything else English. zz_lang goes through storage-bridge.js like the game's other
 * zz_* keys, so the choice is kept with the workbench.
 *
 * Everything the player reads is here, the stickers' names included: stk.<id> is a sticker's
 * name and desc.<id> a pig's one-line description, cat.<id> a category, scene.<id> a scene,
 * level.<id> and level.<id>.tip a level, theme.<n> a daily theme. Sticker ids are positional
 * (see stickers.js), so the lists below follow the registry's order. Entries ending in "Html"
 * hold markup and take numbers only.
 */
(function () {
  "use strict";

  var KEY = "zz_lang";

  /** "3 stickers", "1 sticker". */
  function count(n, one, many) {
    return n + " " + (Number(n) === 1 ? one : many);
  }

  var zh = {
    "doc.title": "猪猪的摸鱼小世界",
    "lang.switch": "EN",
    "lang.switchLabel": "Switch to English",
    "date.locale": "zh-CN",

    "home.badge": "♡ 打开就能玩 · 不用动脑",
    "home.titleHtml": "猪猪的<em>摸鱼</em>小世界",
    "home.subtitle": "今天也要偷偷可爱一下。",
    "home.start": "开始造景",
    "home.works": "我的作品",
    "home.catalog": "贴纸图鉴",
    "home.themeTag": "今日主题",
    "home.levels": "主题关卡",
    "home.levelsSub": "10 个小场景 · 摆对贴纸过关拿星星",
    "home.galleryHtml": function (n) {
      return n + " 张<br>小贴纸";
    },
    "home.blindbox": "随机盲盒",
    "home.resume": "继续上次",
    "home.browse": "随便逛逛",
    "home.sound": "音效",
    "home.foot": function (stickers, scenes, got) {
      return "共 " + stickers + " 张贴纸 · " + scenes + " 种场景 · 盲盒已收集 " + got + " 张";
    },

    "goals.title": "今日目标",
    "goals.subHtml": function (n) {
      return "攒 <b>★</b> 换限定小猪 · 现在有 <b>★" + n + "</b> 颗";
    },
    "goal.items6": "摆满 6 张贴纸",
    "goal.pigs3": "用上 3 只不同的小猪",
    "goal.mix": "家具和植物各来一件",
    "goal.cats3": "用上 3 种不同分类",
    "goal.save": "保存一次作品",
    "goal.box": "开一次盲盒",
    "goal.scene": "换一次场景",
    "goal.rename": "给作品起个名字",
    "goal.theme": function (scene) {
      return "在「" + scene + "」摆满 5 张贴纸";
    },
    "toast.goalDone": function (earned, left) {
      return "目标完成 · ★+" + earned + "　还剩 " + left + " 个目标";
    },
    "toast.goalsAll": "今日目标全部完成 · 额外 ★+1",
    "toast.unlocked": function (name) {
      return "解锁限定小猪「" + name + "」♡";
    },

    "levels.sub": function (done, total, stars) {
      return "完成 " + done + "/" + total + " 关 · ★" + stars;
    },
    "level.cleared": function (name) {
      return name + " 过关啦";
    },
    "level.next": "下一关 ›",
    "level.allDone": "全部通关 ♡",
    "level.doneCount": function (done, total) {
      return "已完成 " + done + "/" + total + " 关";
    },
    "toast.levelDone": function (name, stars) {
      return "过关！「" + name + "」★+" + stars;
    },
    "toast.levelStart": function (n, tip) {
      return "第 " + n + " 关：" + tip;
    },

    "studio.home": "返回首页",
    "studio.rename": "点击改名",
    "studio.count": function (n) {
      return n + " 个贴纸";
    },
    "studio.undo": "撤销",
    "studio.redo": "恢复",
    "studio.scene": "换场景",
    "studio.save": "保存作品",
    "studio.export": "导出 PNG",
    "tray.inspire": "帮我搭一下",
    "item.face": "换表情",
    "item.bigger": "放大",
    "item.smaller": "缩小",
    "item.rotate": "旋转 15°",
    "item.flip": "水平翻转",
    "item.layerUp": "上移一层",
    "item.layerDown": "下移一层",
    "item.dupe": "复制",
    "item.lock": "锁定",
    "item.unlock": "解锁",
    "item.del": "删除",
    "toast.locked": "这张贴纸被锁住了",
    "toast.unlockFirst": "先解锁才能改哦",
    "toast.lockOn": "已锁定",
    "toast.lockOff": "已解锁",
    "toast.needStars": function (n, name) {
      return "还差 " + n + " 颗星星才能解锁「" + name + "」";
    },

    "scene.pick": "挑一个场景",
    "toast.sceneChanged": "已换好背景",
    "save.title": "保存这个小世界",
    "save.placeholder": "给它起个可爱的名字",
    "save.do": "保存",
    "toast.saved": "保存好啦 ♡",
    "work.untitled": "未命名小世界",
    "work.today": "今日小世界",
    "work.copySuffix": " 副本",
    "export.defaultName": "猪猪的小世界",
    "toast.exporting": "正在生成高清图…",
    "toast.exportFailed": "生成失败，换个浏览器试试",
    "toast.exported": "已导出 PNG ♡",

    "box.title": "随机贴纸盲盒",
    "box.subHtml": function (fresh, left) {
      return (
        '这次抽到 <b style="color:#E5768B">' + fresh + "</b> 张新的 · 图鉴还差 " + left + " 张"
      );
    },
    "box.complete": "图鉴已经集齐啦，今天是给你复习一下 🍬",
    "box.new": "NEW",
    "box.had": "已有",
    "box.collected": function (had, total) {
      return "已收集 " + had + " / " + total;
    },
    "box.keep": "先收着",
    "common.place": "放进画布",
    "toast.boxNew": function (n) {
      return "收集到 " + n + " 张新贴纸 ♡";
    },
    "toast.boxPlaced": "三张贴纸已放进画布",
    "toast.inspired": "先这样摆摆看，随便改 ♡",

    "works.count": function (n) {
      return n + " 个小世界";
    },
    "works.edit": "编辑",
    "works.copy": "复制",
    "works.export": "导出",
    "works.delete": "删除",
    "works.empty": "还没有作品哦",
    "works.emptyHint": "去造景页摆一摆，保存下来就会出现在这里",
    "toast.copied": "复制好啦",
    "del.title": "要删掉这个作品吗？",
    "del.body": "删掉就找不回来了哦",
    "toast.deleted": "已删除",

    "catalog.sub": function (pigs, total) {
      return "小猪 " + pigs + " 只 · 共 " + total + " 张";
    },
    "catalog.favs": "只看收藏",
    "catalog.search": "搜一搜，比如「草莓」「沙发」",
    "catalog.unlock": function (n) {
      return "★" + n + " 解锁";
    },
    "catalog.empty": "这里空空的，换个关键词试试",
    "detail.fallback": function (cat) {
      return "来自「" + cat + "」分类的小贴纸";
    },
    "detail.fav": "收藏 ♡",
    "detail.unfav": "取消收藏",
    "toast.faved": "收藏好了 ♡",
    "toast.unfaved": "已取消收藏",
    "toast.placed": "已放进画布",

    "resume.title": "继续上次的小世界？",
    "resume.go": "继续编辑",
    "resume.new": "重新开始",
    "rename.title": "作品名称",

    "common.close": "关闭",
    "common.ok": "知道啦",
    "common.later": "再想想",
    "common.cancel": "取消",
    "common.confirm": "确定",
  };

  var en = {
    "doc.title": "Piggy Sticker World",
    "lang.switch": "中文",
    "lang.switchLabel": "切换到中文",
    "date.locale": "en-US",

    "home.badge": "♡ Open it and play · no thinking needed",
    "home.titleHtml": "Piggy <em>Sticker</em> World",
    "home.subtitle": "Sneak a little cute into today.",
    "home.start": "Start building",
    "home.works": "My works",
    "home.catalog": "Sticker book",
    "home.themeTag": "Today's theme",
    "home.levels": "Theme levels",
    "home.levelsSub": "10 little scenes · place the right stickers to win stars",
    "home.galleryHtml": function (n) {
      return n + "<br>stickers";
    },
    "home.blindbox": "Blind box",
    "home.resume": "Continue",
    "home.browse": "Just browse",
    "home.sound": "Sound",
    "home.foot": function (stickers, scenes, got) {
      return (
        count(stickers, "sticker", "stickers") +
        " · " +
        count(scenes, "scene", "scenes") +
        " · " +
        got +
        " collected from blind boxes"
      );
    },

    "goals.title": "Today's goals",
    "goals.subHtml": function (n) {
      return "Collect <b>★</b> to unlock limited pigs · you have <b>★" + n + "</b>";
    },
    "goal.items6": "Place 6 stickers",
    "goal.pigs3": "Use 3 different pigs",
    "goal.mix": "Add a piece of furniture and a plant",
    "goal.cats3": "Use 3 different categories",
    "goal.save": "Save a work",
    "goal.box": "Open a blind box",
    "goal.scene": "Change the scene",
    "goal.rename": "Give a work a name",
    "goal.theme": function (scene) {
      return "Place 5 stickers in " + scene;
    },
    "toast.goalDone": function (earned, left) {
      return "Goal done · ★+" + earned + " · " + count(left, "goal", "goals") + " to go";
    },
    "toast.goalsAll": "All of today's goals done · bonus ★+1",
    "toast.unlocked": function (name) {
      return "Unlocked a limited pig: " + name + " ♡";
    },

    "levels.sub": function (done, total, stars) {
      return done + "/" + total + " cleared · ★" + stars;
    },
    "level.cleared": function (name) {
      return name + ": cleared";
    },
    "level.next": "Next level ›",
    "level.allDone": "Every level cleared ♡",
    "level.doneCount": function (done, total) {
      return done + "/" + total + " levels cleared";
    },
    "toast.levelDone": function (name, stars) {
      return "Level cleared! " + name + " ★+" + stars;
    },
    "toast.levelStart": function (n, tip) {
      return "Level " + n + ": " + tip;
    },

    "studio.home": "Back to home",
    "studio.rename": "Click to rename",
    "studio.count": function (n) {
      return count(n, "sticker", "stickers");
    },
    "studio.undo": "Undo",
    "studio.redo": "Redo",
    "studio.scene": "Change scene",
    "studio.save": "Save work",
    "studio.export": "Export PNG",
    "tray.inspire": "Arrange it for me",
    "item.face": "Change face",
    "item.bigger": "Bigger",
    "item.smaller": "Smaller",
    "item.rotate": "Rotate 15°",
    "item.flip": "Flip",
    "item.layerUp": "Bring forward",
    "item.layerDown": "Send backward",
    "item.dupe": "Duplicate",
    "item.lock": "Lock",
    "item.unlock": "Unlock",
    "item.del": "Delete",
    "toast.locked": "This sticker is locked",
    "toast.unlockFirst": "Unlock it first to change it",
    "toast.lockOn": "Locked",
    "toast.lockOff": "Unlocked",
    "toast.needStars": function (n, name) {
      return count(n, "more star", "more stars") + " to unlock " + name;
    },

    "scene.pick": "Pick a scene",
    "toast.sceneChanged": "Scene changed",
    "save.title": "Save this little world",
    "save.placeholder": "Give it a cute name",
    "save.do": "Save",
    "toast.saved": "Saved ♡",
    "work.untitled": "Untitled world",
    "work.today": "Today's world",
    "work.copySuffix": " (copy)",
    "export.defaultName": "Piggy world",
    "toast.exporting": "Making the picture…",
    "toast.exportFailed": "Couldn't make the picture. Try another browser.",
    "toast.exported": "PNG exported ♡",

    "box.title": "Sticker blind box",
    "box.subHtml": function (fresh, left) {
      return (
        '<b style="color:#E5768B">' + fresh + "</b> new this time · " + left + " left to collect"
      );
    },
    "box.complete": "Your sticker book is complete. Here's a little refresher 🍬",
    "box.new": "NEW",
    "box.had": "Have it",
    "box.collected": function (had, total) {
      return "Collected " + had + " / " + total;
    },
    "box.keep": "Keep for later",
    "common.place": "Put on the canvas",
    "toast.boxNew": function (n) {
      return count(n, "new sticker", "new stickers") + " collected ♡";
    },
    "toast.boxPlaced": "Three stickers are on the canvas",
    "toast.inspired": "Here's a start. Change anything ♡",

    "works.count": function (n) {
      return count(n, "little world", "little worlds");
    },
    "works.edit": "Edit",
    "works.copy": "Copy",
    "works.export": "Export",
    "works.delete": "Delete",
    "works.empty": "No works yet",
    "works.emptyHint": "Arrange a scene and save it, and it shows up here",
    "toast.copied": "Copied",
    "del.title": "Delete this work?",
    "del.body": "A deleted work can't be brought back.",
    "toast.deleted": "Deleted",

    "catalog.sub": function (pigs, total) {
      return pigs + " pigs · " + count(total, "sticker", "stickers");
    },
    "catalog.favs": "Favourites only",
    "catalog.search": "Search, for example strawberry or sofa",
    "catalog.unlock": function (n) {
      return "★" + n + " to unlock";
    },
    "catalog.empty": "Nothing here. Try another word.",
    "detail.fallback": function (cat) {
      return "A sticker from " + cat;
    },
    "detail.fav": "Favourite ♡",
    "detail.unfav": "Remove favourite",
    "toast.faved": "Added to favourites ♡",
    "toast.unfaved": "Removed from favourites",
    "toast.placed": "On the canvas",

    "resume.title": "Continue your last world?",
    "resume.go": "Keep editing",
    "resume.new": "Start over",
    "rename.title": "Work name",

    "common.close": "Close",
    "common.ok": "Got it",
    "common.later": "Not yet",
    "common.cancel": "Cancel",
    "common.confirm": "OK",
  };

  /** Adds `<prefix><n>` (from 1) or `<prefix><id>` keys for a list, in the same order in both. */
  function addList(prefix, keys, zhValues, enValues) {
    for (var i = 0; i < keys.length; i++) {
      zh[prefix + keys[i]] = zhValues[i];
      en[prefix + keys[i]] = enValues[i];
    }
  }
  function numbered(cat, n) {
    var out = [];
    for (var i = 1; i <= n; i++) out.push(cat + i);
    return out;
  }

  var CATS = ["pig", "furn", "plant", "food", "deco", "nat", "life"];
  addList(
    "cat.",
    CATS,
    ["小猪", "家具", "植物", "美食", "装饰", "自然", "生活"],
    ["Pigs", "Furniture", "Plants", "Food", "Decor", "Nature", "Everyday"],
  );

  var SCENES = [
    "blank",
    "pinkroom",
    "creamroom",
    "garden",
    "beach",
    "forest",
    "cafe",
    "flowershop",
    "bath",
    "balcony",
    "kitchen",
    "xmas",
    "starry",
  ];
  addList(
    "scene.",
    SCENES,
    [
      "空白画布",
      "粉色卧室",
      "奶油客厅",
      "草莓花园",
      "海边沙滩",
      "森林露营",
      "甜品咖啡馆",
      "花店",
      "浴室",
      "阳台",
      "小厨房",
      "圣诞小屋",
      "星空露营地",
    ],
    [
      "Blank Canvas",
      "Pink Bedroom",
      "Cream Living Room",
      "Strawberry Garden",
      "Sandy Beach",
      "Forest Camp",
      "Dessert Café",
      "Flower Shop",
      "Bathroom",
      "Balcony",
      "Little Kitchen",
      "Christmas Cottage",
      "Starry Campsite",
    ],
  );

  var LEVELS = numbered("L", 10);
  addList(
    "level.",
    LEVELS,
    [
      "草莓花园的下午茶",
      "海边度假小屋",
      "森林露营夜",
      "甜品咖啡馆开张",
      "花店开门啦",
      "泡泡浴时间",
      "阳台小花园",
      "月亮下的加餐时间",
      "圣诞小屋的礼物",
      "星空下的露营",
    ],
    [
      "Tea in the Strawberry Garden",
      "Seaside Holiday Hut",
      "A Night of Forest Camping",
      "The Dessert Café Opens",
      "The Flower Shop Is Open",
      "Bubble Bath Time",
      "Balcony Garden",
      "Moonlight Snack Time",
      "Gifts in the Christmas Cottage",
      "Camping Under the Stars",
    ],
  );
  addList(
    "level.",
    LEVELS.map(function (id) {
      return id + ".tip";
    }),
    [
      "给小猪摆一张桌子和两把椅子",
      "带小猪去海边，记得带吃的",
      "露营要有植物和灯",
      "甜点越多越好",
      "花店里当然要全是花",
      "浴缸、毛巾、再来点香香的",
      "阳台要慢慢种满",
      "厨房里做点好吃的",
      "礼物、灯、再来一只小猪",
      "最难的一关，摆满整个夜晚",
    ],
    [
      "Set out a table and two chairs for the pigs",
      "Take the pigs to the sea, and bring snacks",
      "A camp needs plants and a light",
      "The more desserts the better",
      "A flower shop needs flowers everywhere",
      "A tub, a towel and something that smells nice",
      "Fill the balcony bit by bit",
      "Cook something tasty in the kitchen",
      "Gifts, lights and one more pig",
      "The hardest one: fill the whole night",
    ],
  );

  addList(
    "theme.",
    numbered("", 12),
    [
      "今天不想上班，只想和小猪躺平。",
      "给小猪布置一个梦中情房。",
      "今天来开一家草莓咖啡馆。",
      "给小猪安排一次海边度假。",
      "小猪今天要过生日啦！",
      "下雨天，和小猪在家喝热可可。",
      "在森林里给小猪搭一个露营地。",
      "带小猪去花店买一束郁金香。",
      "深夜的小猪在星空下看流星。",
      "圣诞节快到了，布置一间小屋吧。",
      "小猪说想把阳台改成小花园。",
      "下班后，去甜品店坐一会儿。",
    ],
    [
      "No work today, just lazing around with the pigs.",
      "Decorate the pigs' dream room.",
      "Open a strawberry café today.",
      "Plan a seaside holiday for the pigs.",
      "It's a pig's birthday today!",
      "A rainy day: hot cocoa at home with the pigs.",
      "Set up a forest campsite for the pigs.",
      "Take the pigs to buy tulips at the flower shop.",
      "Late at night, the pigs watch shooting stars.",
      "Christmas is coming. Decorate a little cottage.",
      "The pigs want to turn the balcony into a garden.",
      "After work, sit a while in a dessert shop.",
    ],
  );

  /* Pigs: pig1-pig32, then the four limited ones, pig33-pig36. [name, description] */
  var PIGS_ZH = [
    ["草莓猪", "头上顶着一整个大草莓，脸颊红扑扑的甜心。"],
    ["奶油猪", "白色奶油质感，最爱一切软软的甜点。"],
    ["面包猪", "戴着面包帽，怀里永远抱着一片吐司。"],
    ["睡觉猪", "穿着小睡衣抱着枕头，哪里都能睡着。"],
    ["富贵猪", "墨镜配小西装，走路带风的猪界老板。"],
    ["兔耳猪", "戴着兔耳发箍，蹦蹦跳跳的软乎乎。"],
    ["困困猪", "眼睛永远半闭着，随时准备躺平。"],
    ["蝴蝶结猪", "粉色大蝴蝶结，特别爱漂亮的小公主。"],
    ["厨师猪", "戴着高高的厨师帽，锅铲从不离手。"],
    ["浴袍猪", "裹着浴袍、敷着黄瓜片，今晚谁也不见。"],
    ["雨天猪", "穿黄色小雨衣，透明伞下听着雨声。"],
    ["海边猪", "草帽和游泳圈，度假是正经事。"],
    ["花园猪", "头顶小花环，提着浇水壶到处温柔。"],
    ["宇航猪", "圆滚滚的太空服，去月亮上找小猪。"],
    ["小恶魔猪", "头上两只小角，调皮捣蛋第一名。"],
    ["天使猪", "顶着光环，随时准备给世界一点甜。"],
    ["圣诞猪", "红帽子加围巾，圣诞树下拆礼物。"],
    ["熊猫猪", "黑白配色加熊猫帽，滚来滚去的团子。"],
    ["蛋糕猪", "整个造型像一块草莓蛋糕，看着就好吃。"],
    ["蘑菇猪", "顶着一顶大蘑菇帽，森林里的小住客。"],
    ["咖啡猪", "抱着超大咖啡杯，续命续到天亮。"],
    ["郁金香猪", "头顶郁金香，穿花裙子的小淑女。"],
    ["小幽灵猪", "白色圆滚滚的幽灵造型，只会温柔吓人。"],
    ["运动猪", "运动服配发带，今天也要跑两圈。"],
    ["朋克猪", "戴着耳机，酷酷的但心很软。"],
    ["小厨娘猪", "围着围裙，篮子里的甜甜圈刚出炉。"],
    ["旅行猪", "背上包包挂着相机，随时准备出发。"],
    ["泡泡猪", "泡在浴缸里玩泡泡，快乐很简单。"],
    ["毛绒猪", "整个人裹在毛绒连体衣里，摸着软软的。"],
    ["烟花猪", "星星发饰一闪一闪，喜欢亮晶晶的一切。"],
    ["宝宝猪", "戴着小帽子，摇铃摇得叮当响。"],
    ["小熊帽猪", "穿着小熊连帽衫，背带裤里装满糖果。"],
    ["皇冠猪", "星星攒到 3 颗才认你当朋友的小公主。"],
    ["彩虹猪", "头顶一道小彩虹，心情每天都很好。"],
    ["云朵猪", "睡在云朵上，梦里也是软软的。"],
    ["星愿猪", "许愿池边的常客，抱住就不想放手。"],
  ];
  var PIGS_EN = [
    ["Strawberry Pig", "A rosy-cheeked sweetheart with a whole strawberry on top."],
    ["Cream Pig", "Soft as whipped cream and fond of every fluffy dessert."],
    ["Bread Pig", "Wears a bread hat and always hugs a slice of toast."],
    ["Sleepy Pig", "Pyjamas on and pillow in arms, ready to nap anywhere."],
    ["Boss Pig", "Shades and a little suit: the boss of all pigs."],
    ["Bunny-Ear Pig", "A bouncy softie in a bunny-ear headband."],
    ["Drowsy Pig", "Eyes always half shut, ready to flop down."],
    ["Bow Pig", "A little princess with a big pink bow."],
    ["Chef Pig", "A tall chef's hat and a pan always in hand."],
    ["Bathrobe Pig", "Bathrobe on, cucumber slices on: no visitors tonight."],
    ["Rainy Day Pig", "A yellow raincoat and the sound of rain under a clear umbrella."],
    ["Seaside Pig", "A straw hat and a swim ring: holidays are serious business."],
    ["Garden Pig", "A flower crown and a watering can, gentle with everything."],
    ["Astronaut Pig", "A round space suit, off to find pigs on the moon."],
    ["Little Devil Pig", "Two little horns and top of the class in mischief."],
    ["Angel Pig", "Wears a halo, ready to make the world a little sweeter."],
    ["Christmas Pig", "A red hat and a scarf, opening gifts under the tree."],
    ["Panda Pig", "Black and white with a panda hood, a rolling dumpling."],
    ["Cake Pig", "Dressed as a slice of strawberry cake. Looks delicious."],
    ["Mushroom Pig", "A big mushroom cap, a little guest of the forest."],
    ["Coffee Pig", "Hugs a huge cup of coffee to keep going till dawn."],
    ["Tulip Pig", "A tulip on top and a flowery dress."],
    ["Little Ghost Pig", "A round white ghost that only scares you gently."],
    ["Sporty Pig", "Sportswear and a headband: two laps again today."],
    ["Punk Pig", "Headphones on, cool outside and soft inside."],
    ["Little Baker Pig", "An apron on, and donuts fresh from the oven in the basket."],
    ["Traveller Pig", "A backpack and a camera, always ready to go."],
    ["Bubble Pig", "Playing with bubbles in the tub. Happiness is simple."],
    ["Fluffy Pig", "Wrapped in a fluffy onesie, soft to the touch."],
    ["Sparkle Pig", "Twinkling star hair clips; loves everything shiny."],
    ["Baby Pig", "A little bonnet and a jingling rattle."],
    ["Bear Hoodie Pig", "A bear hoodie and dungarees full of sweets."],
    ["Crown Pig", "A little princess who becomes your friend once you have 3 stars."],
    ["Rainbow Pig", "A little rainbow overhead and a good mood every day."],
    ["Cloud Pig", "Sleeps on a cloud; even the dreams are soft."],
    ["Wishing Star Pig", "A regular at the wishing well; hug it once and you won't let go."],
  ];
  var pigIds = numbered("pig", PIGS_ZH.length);
  addList(
    "stk.",
    pigIds,
    PIGS_ZH.map(function (x) {
      return x[0];
    }),
    PIGS_EN.map(function (x) {
      return x[0];
    }),
  );
  addList(
    "desc.",
    pigIds,
    PIGS_ZH.map(function (x) {
      return x[1];
    }),
    PIGS_EN.map(function (x) {
      return x[1];
    }),
  );

  /* The other stickers, by category, in registry order: furn1, furn2, … */
  var STICKERS = {
    furn: [
      ["粉色沙发", "Pink Sofa"],
      ["薄荷小沙发", "Mint Loveseat"],
      ["奶油大床", "Big Cream Bed"],
      ["小单人床", "Single Bed"],
      ["木圆桌", "Round Wooden Table"],
      ["方桌", "Square Table"],
      ["小椅子", "Little Chair"],
      ["小圆凳", "Round Stool"],
      ["书架", "Bookshelf"],
      ["衣柜", "Wardrobe"],
      ["圆地毯", "Round Rug"],
      ["条纹地毯", "Striped Rug"],
      ["落地灯", "Floor Lamp"],
      ["台灯", "Desk Lamp"],
      ["窗帘", "Curtains"],
      ["圆镜", "Round Mirror"],
      ["床头柜", "Bedside Table"],
      ["小冰箱", "Mini Fridge"],
      ["洗衣机", "Washing Machine"],
      ["浴缸", "Bathtub"],
      ["小洗手台", "Little Washbasin"],
      ["书桌", "Desk"],
      ["抱枕", "Cushion"],
      ["枕头", "Pillow"],
      ["电视机", "TV"],
      ["长凳", "Bench"],
      ["抽屉柜", "Chest of Drawers"],
      ["挂钟", "Wall Clock"],
      ["墙上搁板", "Wall Shelf"],
      ["小推车", "Little Cart"],
    ],
    plant: [
      ["小盆栽", "Potted Plant"],
      ["龟背竹", "Monstera"],
      ["仙人掌", "Cactus"],
      ["开花仙人掌", "Flowering Cactus"],
      ["玫瑰", "Rose"],
      ["郁金香", "Tulip"],
      ["向日葵", "Sunflower"],
      ["小雏菊", "Daisies"],
      ["小蘑菇", "Little Mushroom"],
      ["蘑菇丛", "Mushroom Patch"],
      ["小树", "Little Tree"],
      ["小松树", "Little Pine"],
      ["花篮", "Flower Basket"],
      ["藤蔓", "Vine"],
      ["吊兰", "Spider Plant"],
      ["草丛", "Grass Tuft"],
      ["小竹子", "Bamboo"],
      ["薰衣草", "Lavender"],
      ["樱花枝", "Cherry Blossom Branch"],
      ["小叶子", "Little Leaf"],
      ["多肉", "Succulent"],
      ["花槽", "Flower Box"],
      ["蒲公英", "Dandelion"],
      ["四叶草", "Four-Leaf Clover"],
      ["蕨类", "Fern"],
      ["盆景", "Bonsai"],
      ["南瓜", "Pumpkin"],
      ["花环", "Wreath"],
    ],
    food: [
      ["草莓蛋糕", "Strawberry Cake"],
      ["蛋糕切块", "Slice of Cake"],
      ["甜甜圈", "Donut"],
      ["珍珠奶茶", "Bubble Tea"],
      ["热咖啡", "Hot Coffee"],
      ["可颂", "Croissant"],
      ["吐司", "Toast"],
      ["冰淇淋甜筒", "Ice Cream Cone"],
      ["冰淇淋杯", "Ice Cream Cup"],
      ["马卡龙", "Macaron"],
      ["三明治", "Sandwich"],
      ["披萨", "Pizza"],
      ["西瓜", "Watermelon"],
      ["草莓", "Strawberry"],
      ["布丁", "Pudding"],
      ["小熊饼干", "Bear Cookie"],
      ["寿司", "Sushi"],
      ["便当盒", "Lunch Box"],
      ["拉面", "Ramen"],
      ["蛋挞", "Egg Tart"],
      ["松饼塔", "Pancake Stack"],
      ["蜂蜜罐", "Honey Jar"],
      ["水果糖", "Fruit Candy"],
      ["棒棒糖", "Lollipop"],
      ["巧克力", "Chocolate"],
      ["麻薯", "Mochi"],
      ["纸杯蛋糕", "Cupcake"],
      ["蝴蝶脆饼", "Pretzel"],
      ["樱桃", "Cherries"],
      ["果汁", "Juice"],
    ],
    deco: [
      ["爱心", "Heart"],
      ["双心", "Two Hearts"],
      ["小星星", "Little Star"],
      ["闪耀", "Sparkle"],
      ["气球", "Balloon"],
      ["气球束", "Balloon Bunch"],
      ["蝴蝶结", "Bow"],
      ["胶带", "Washi Tape"],
      ["便签纸", "Sticky Note"],
      ["信封", "Envelope"],
      ["相框", "Photo Frame"],
      ["书", "Book"],
      ["书堆", "Stack of Books"],
      ["小灯串", "Fairy Lights"],
      ["拍立得", "Instant Photo"],
      ["挂画", "Wall Picture"],
      ["小闹钟", "Alarm Clock"],
      ["小钥匙", "Little Key"],
      ["丝带", "Ribbon"],
      ["图钉", "Pushpin"],
      ["回形针", "Paper Clip"],
      ["邮票", "Stamp"],
      ["便签留言", "Memo"],
      ["小旗串", "Bunting"],
      ["小蜡烛", "Candle"],
      ["雪花球", "Snow Globe"],
      ["贴纸片", "Sticker Sheet"],
      ["信纸", "Letter Paper"],
      ["干花卡", "Pressed Flower Card"],
      ["纸灯笼", "Paper Lantern"],
    ],
    nat: [
      ["云朵", "Cloud"],
      ["两朵云", "Two Clouds"],
      ["太阳", "Sun"],
      ["月亮", "Moon"],
      ["星空", "Starry Sky"],
      ["彩虹", "Rainbow"],
      ["小蝴蝶", "Butterfly"],
      ["蓝蝴蝶", "Blue Butterfly"],
      ["小鸟", "Little Bird"],
      ["小蜜蜂", "Bee"],
      ["雪花", "Snowflake"],
      ["枫叶", "Maple Leaf"],
      ["绿叶", "Green Leaf"],
      ["花瓣", "Petals"],
      ["萤火虫", "Firefly"],
      ["星星团", "Cluster of Stars"],
      ["小雨", "Drizzle"],
      ["小风", "Breeze"],
      ["羽毛", "Feather"],
      ["贝壳", "Seashell"],
      ["小石子", "Pebbles"],
      ["小海浪", "Little Wave"],
      ["小芽", "Sprout"],
      ["蒲公英籽", "Dandelion Seeds"],
      ["星球", "Planet"],
      ["小流星", "Shooting Star"],
    ],
    life: [
      ["手机", "Phone"],
      ["耳机", "Headphones"],
      ["相机", "Camera"],
      ["小包包", "Little Bag"],
      ["雨伞", "Umbrella"],
      ["口红", "Lipstick"],
      ["香水", "Perfume"],
      ["眼镜", "Glasses"],
      ["拖鞋", "Slippers"],
      ["毛绒小熊", "Plush Bear"],
      ["马克杯", "Mug"],
      ["笔记本", "Notebook"],
      ["钢笔", "Fountain Pen"],
      ["化妆镜", "Compact Mirror"],
      ["发圈", "Hair Tie"],
      ["钱包", "Wallet"],
      ["钥匙扣", "Keyring"],
      ["浇水壶", "Watering Can"],
      ["野餐篮", "Picnic Basket"],
      ["小熊玩偶", "Teddy Bear"],
      ["发夹", "Hair Clip"],
      ["手表", "Watch"],
      ["戒指", "Ring"],
      ["袜子", "Socks"],
      ["围巾", "Scarf"],
      ["太阳镜", "Sunglasses"],
      ["帆布包", "Tote Bag"],
      ["雨靴", "Rain Boots"],
    ],
  };
  Object.keys(STICKERS).forEach(function (cat) {
    var list = STICKERS[cat];
    addList(
      "stk.",
      numbered(cat, list.length),
      list.map(function (x) {
        return x[0];
      }),
      list.map(function (x) {
        return x[1];
      }),
    );
  });

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

  window.PigletI18n = { lang: lang, setLang: setLang, t: t, onChange: onChange, strings: strings };
})();
