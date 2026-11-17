/* Built-in palettes.
 * The basic 29-colour palette (id `hama`, kept for saved settings) uses the H-numbers of the
 * Hama bead colour chart only so that a pattern can be matched to beads bought in a shop; the
 * app is not affiliated with that brand, and the UI says so. Its screen hex values are
 * community approximations and differ from real beads; the in-app palette panel calibrates
 * them one by one or imports a whole palette.
 *
 * Each colour is [code, Chinese name, English name, hex]. A palette's name, short name and note
 * are interface text and come from the i18n dictionaries.
 */
(function () {
  const PS = (window.PS = window.PS || {});
  const t = (key, ...args) => (PS.i18n ? PS.i18n.t(key, ...args) : key);

  const hamaColors = [
    ["H01", "白", "White", "#FFFFFF"],
    ["H02", "奶油", "Cream", "#F7E7C6"],
    ["H03", "黄", "Yellow", "#FFD400"],
    ["H04", "橙", "Orange", "#F58220"],
    ["H05", "红", "Red", "#E2231A"],
    ["H06", "粉", "Pink", "#ED5D95"],
    ["H07", "紫", "Purple", "#6C3F9E"],
    ["H08", "蓝", "Blue", "#1B4C9E"],
    ["H09", "浅蓝", "Light Blue", "#5AA8DC"],
    ["H10", "绿", "Green", "#009E4F"],
    ["H11", "浅绿", "Light Green", "#7CBF44"],
    ["H12", "棕", "Brown", "#7B4B2A"],
    ["H13", "灰", "Grey", "#8E9093"],
    ["H14", "米色", "Beige", "#E7CBA6"],
    ["H17", "浅棕", "Light Brown", "#C08A57"],
    ["H18", "黑", "Black", "#1A1A1A"],
    ["H21", "浅粉", "Light Pink", "#F6B7CE"],
    ["H22", "深红", "Dark Red", "#8E2B34"],
    ["H26", "肤色", "Flesh", "#F2C9A2"],
    ["H35", "粉蓝", "Pastel Blue", "#A8D5ED"],
    ["H36", "粉红", "Pastel Pink", "#F6C8D8"],
    ["H37", "粉绿", "Pastel Green", "#C6E3B4"],
    ["H38", "粉黄", "Pastel Yellow", "#FBEFA8"],
    ["H39", "粉紫", "Pastel Purple", "#C5B4DC"],
    ["H46", "深绿", "Dark Green", "#0B5C35"],
    ["H49", "天蓝", "Azure", "#2AA7DF"],
    ["H53", "湖蓝", "Turquoise", "#1AB0A6"],
    ["H54", "丁香紫", "Lilac", "#AE9BD0"],
    ["H83", "金", "Gold", "#C9A227"],
  ];

  const universalColors = [
    ["C01", "白", "White", "#FFFFFF"],
    ["C02", "米白", "Ivory", "#F5F1E6"],
    ["C03", "淡黄", "Pale Yellow", "#FFF3B0"],
    ["C04", "黄", "Yellow", "#FFD93D"],
    ["C05", "琥珀", "Amber", "#E0A100"],
    ["C06", "橙", "Orange", "#FF9F1C"],
    ["C07", "深橙", "Deep Orange", "#E86A17"],
    ["C08", "珊瑚", "Coral", "#FF6B6B"],
    ["C09", "红", "Red", "#E63946"],
    ["C10", "深红", "Dark Red", "#A4161A"],
    ["C11", "玫红", "Rose", "#E75480"],
    ["C12", "粉", "Pink", "#FFB6C1"],
    ["C13", "浅粉", "Light Pink", "#FFD9E1"],
    ["C14", "紫", "Purple", "#7B2CBF"],
    ["C15", "深紫", "Deep Purple", "#5A2A82"],
    ["C16", "浅紫", "Lavender", "#B39DDB"],
    ["C17", "蓝", "Blue", "#1D4ED8"],
    ["C18", "深蓝", "Navy", "#0B2E6F"],
    ["C19", "天蓝", "Sky", "#3FA9F5"],
    ["C20", "浅蓝", "Light Blue", "#A8D8FF"],
    ["C21", "青", "Teal", "#00B8A9"],
    ["C22", "深青", "Dark Teal", "#00756B"],
    ["C23", "绿", "Green", "#1E9E4F"],
    ["C24", "深绿", "Dark Green", "#14532D"],
    ["C25", "草绿", "Grass", "#8BC34A"],
    ["C26", "薄荷", "Mint", "#B8F2C9"],
    ["C27", "橄榄", "Olive", "#6B7A1F"],
    ["C28", "卡其", "Khaki", "#C7B299"],
    ["C29", "浅棕", "Light Brown", "#C49567"],
    ["C30", "棕", "Brown", "#8B5E34"],
    ["C31", "深棕", "Dark Brown", "#4E342E"],
    ["C32", "焦糖", "Caramel", "#A9744F"],
    ["C33", "米灰", "Greige", "#D9D4CB"],
    ["C34", "浅灰", "Light Grey", "#BFBFBF"],
    ["C35", "中灰", "Grey", "#808080"],
    ["C36", "深灰", "Dark Grey", "#4D4D4D"],
    ["C37", "黑", "Black", "#1A1A1A"],
    ["C38", "肤色", "Skin", "#F6D2B0"],
    ["C39", "深肤色", "Dark Skin", "#C98E63"],
    ["C40", "金", "Gold", "#D4AF37"],
    ["C41", "浅肤", "Light Skin", "#FCE0C8"],
    ["C42", "蜜肤", "Honey", "#EAB58C"],
    ["C43", "小麦", "Tan", "#B87C55"],
    ["C44", "深肤", "Deep Skin", "#8A5A3B"],
    ["C45", "可可", "Cocoa", "#4A3126"],
    ["C46", "奶白", "Off White", "#FAF6EF"],
    ["C47", "米黄", "Sand", "#EADCB8"],
    ["C48", "柠檬", "Lemon", "#FFF176"],
    ["C49", "橙黄", "Marigold", "#FFB020"],
    ["C50", "杏", "Apricot", "#FFC48C"],
    ["C51", "砖红", "Brick", "#B2452F"],
    ["C52", "酒红", "Wine", "#7B1E2B"],
    ["C53", "灰粉", "Dusty Rose", "#D8A0A8"],
    ["C54", "藕粉", "Mauve", "#C48F9F"],
    ["C55", "淡紫", "Lilac", "#D8CCF0"],
    ["C56", "紫罗兰", "Violet", "#8E5FB5"],
    ["C57", "靛蓝", "Indigo", "#3B4C9E"],
    ["C58", "冰蓝", "Ice", "#D6EEF9"],
    ["C59", "石板", "Slate", "#64748B"],
    ["C60", "银", "Silver", "#C9CED6"],
    ["C61", "石墨", "Graphite", "#333A42"],
    ["C62", "抹茶", "Matcha", "#A8C66C"],
    ["C63", "森林", "Forest", "#2F6B3A"],
    ["C64", "青柠", "Lime", "#B6E36B"],
    ["C65", "珍珠", "Pearl", "#F2EDE4"],
    ["C66", "瓷白", "Porcelain", "#FFFDFA"],
    ["C67", "浅暖灰", "Warm Grey", "#CFC8C0"],
    ["C68", "暖灰", "Taupe", "#A99F94"],
    ["C69", "冷灰", "Cool Grey", "#9AA3AD"],
    ["C70", "炭", "Charcoal", "#2B2F33"],
    ["C71", "雾蓝", "Mist Blue", "#B9CCDB"],
    ["C72", "钢蓝", "Steel", "#4F6D8C"],
    ["C73", "夜蓝", "Midnight", "#16233F"],
    ["C74", "海蓝", "Ocean", "#1E6FA8"],
    ["C75", "湖绿", "Lagoon", "#2E8B84"],
    ["C76", "苔绿", "Moss", "#6B8E4E"],
    ["C77", "军绿", "Army", "#4B5320"],
    ["C78", "浅杏", "Light Apricot", "#F8D9BA"],
    ["C79", "蜜桃", "Peach", "#F7B48C"],
    ["C80", "珊瑚粉", "Coral", "#F08A7A"],
    ["C81", "玫粉", "Fuchsia", "#CE2E7B"],
    ["C82", "梅子", "Plum", "#7A3E5C"],
    ["C83", "薰衣草灰", "Lavender Grey", "#B7AEC0"],
    ["C84", "雾紫", "Mist Purple", "#D6CCE0"],
    ["C85", "香槟", "Champagne", "#E8D6AE"],
    ["C86", "驼", "Camel", "#B58B5A"],
    ["C87", "摩卡", "Mocha", "#6F4E37"],
    ["C88", "栗", "Chestnut", "#8B4A2F"],
    ["C89", "赭", "Ochre", "#B07D2B"],
    ["C90", "芥末", "Mustard", "#D8A31A"],
    ["C91", "苹果绿", "Apple", "#7DBB42"],
    ["C92", "蓝绿", "Blue Green", "#1F8A70"],
    ["C93", "青灰", "Teal Grey", "#5F7E7A"],
    ["C94", "玫瑰金", "Rose Gold", "#C88C7A"],
    ["C95", "古铜", "Bronze", "#8C6239"],
    ["C96", "雾粉", "Mist Pink", "#F3D3D8"],
  ];

  /* The pastel palette: an in-house set of low-saturation colours for soft illustrations and pets. */
  const pastelColors = [
    ["P01", "云白", "Cloud White", "#FFFDFB"],
    ["P02", "奶油黄", "Cream Yellow", "#FFF6D6"],
    ["P03", "柠檬雪", "Lemon Ice", "#FDF3B0"],
    ["P04", "蜜瓜", "Honeydew", "#FCE9C8"],
    ["P05", "蜜桃", "Peach", "#FFD9C7"],
    ["P06", "珊瑚粉", "Coral Pink", "#FFC4B8"],
    ["P07", "樱粉", "Cherry Blossom", "#FFD3E0"],
    ["P08", "玫瑰粉", "Rose Pink", "#F7B7CB"],
    ["P09", "莓粉", "Berry Pink", "#EE9BB5"],
    ["P10", "藕荷", "Orchid", "#E3AFC4"],
    ["P11", "淡紫", "Pale Lilac", "#DCCBF0"],
    ["P12", "薰衣草", "Lavender", "#CDBCE8"],
    ["P13", "雾紫", "Mist Purple", "#BCAFD9"],
    ["P14", "灰蓝紫", "Periwinkle Grey", "#A9A6C9"],
    ["P15", "雾蓝", "Mist Blue", "#C3DCEF"],
    ["P16", "天空", "Pale Sky", "#B2D4F0"],
    ["P17", "冰蓝", "Ice Blue", "#D8ECF7"],
    ["P18", "湖水", "Aqua", "#A8DAE0"],
    ["P19", "薄荷", "Mint", "#C4EBD9"],
    ["P20", "青柠", "Lime", "#DDF0B8"],
    ["P21", "抹茶", "Matcha", "#CBDDA0"],
    ["P22", "浅苔", "Light Moss", "#B8CFA0"],
    ["P23", "奶绿", "Pistachio", "#DCEDC8"],
    ["P24", "淡黄绿", "Pale Yellow Green", "#EAF3C4"],
    ["P25", "浅杏", "Light Apricot", "#FBE3C9"],
    ["P26", "蜜糖", "Honey", "#F6D2A8"],
    ["P27", "奶茶", "Milk Tea", "#E0C3A8"],
    ["P28", "浅棕", "Light Brown", "#CBA98B"],
    ["P29", "米灰", "Greige", "#E6E1D8"],
    ["P30", "暖灰", "Warm Grey", "#D6D0C6"],
    ["P31", "浅灰", "Light Grey", "#C9C9C9"],
    ["P32", "银灰", "Silver Grey", "#B7BCC2"],
    ["P33", "蓝灰", "Blue Grey", "#A6B0BA"],
    ["P34", "雾灰", "Mist Grey", "#9AA1A8"],
    ["P35", "灰紫", "Dusty Lilac", "#B0A6B8"],
    ["P36", "灰粉", "Dusty Pink", "#D9BFC4"],
    ["P37", "淡金", "Pale Gold", "#E7D3A1"],
    ["P38", "浅铜", "Light Copper", "#D8B08C"],
    ["P39", "藕粉", "Pale Mauve", "#EFC6CE"],
    ["P40", "奶咖", "Latte", "#D3BBA9"],
  ];

  const toObj = ([code, name, en, hex]) => ({ code, name, en, hex: hex.toUpperCase() });

  const base = {
    hama: { id: "hama", colors: hamaColors.map(toObj) },
    universal: { id: "universal", colors: universalColors.map(toObj) },
    pastel: { id: "pastel", colors: pastelColors.map(toObj) },
  };

  PS.palettes = {
    order: ["hama", "universal", "pastel"],
    /* A deep copy of the built-in data, so calibration never changes it; the texts are in the
       current interface language. */
    base(id) {
      const p = base[id] || base.hama;
      return {
        id: p.id,
        name: t(`palette.${p.id}.name`),
        short: t(`palette.${p.id}.short`),
        note: t(`palette.${p.id}.note`),
        colors: p.colors.map((c) => ({ ...c })),
      };
    },
    /* A colour's name in the interface language. A pasted palette has one name only (`en` is
       empty), and it stands for both languages. */
    nameOf(c) {
      return PS.i18n && PS.i18n.lang() === "en" ? c.en || c.name : c.name;
    },
    all() {
      return this.order.map((id) => this.base(id));
    },
    hexToRgb(hex) {
      let h = String(hex || "")
        .trim()
        .replace("#", "");
      if (h.length === 3)
        h = h
          .split("")
          .map((c) => c + c)
          .join("");
      const n = parseInt(h, 16);
      if (Number.isNaN(n)) return { r: 0, g: 0, b: 0 };
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    },
  };
})();
