import {
  t,
  desk,
  node,
  row,
  section,
  heading,
  hint,
  field,
  input,
  select,
  form,
  button,
  list,
  entry,
  brief,
} from "./desk-kit.js";

desk(t("Tabletop Desk", "跑团桌"), (table, { send }) => {
  const active = table.players.find((p) => p.id === table.active);
  const hero = node(
    "div",
    { className: "hero" },
    heading(t("Round ", "第 ") + table.round + t("", " 轮")),
    node("p", { className: "readout" }, active?.name || t("Take a seat", "队员入席")),
    active
      ? button(t("Next turn", "下一位"), () => send({ type: "next" }), true)
      : hint(t("Add the first player below to begin.", "在下方加入第一位队员即可开始。")),
  );
  const players = section(
    t("Turn order", "出场顺序"),
    list(
      ...table.players.map((p) =>
        entry(
          brief(p.name, t("Initiative ", "先攻值 ") + p.initiative),
          p.id === table.active
            ? node("span", { className: "wb-badge" }, t("Playing", "当前行动"))
            : button(t("Take turn", "开始行动"), () => send({ type: "lead", id: p.id })),
          button(t("Remove", "移除"), () => send({ type: "leave", id: p.id })),
        ),
      ),
    ),
    form(
      "player",
      t("Add player", "加入队员"),
      (v, id) => send({ type: "join", name: v.name, initiative: Number(v.initiative) }, id),
      field(t("Player", "队员"), input("name", { required: true, maxLength: 60 })),
      field(
        t("Initiative", "先攻值"),
        input("initiative", { type: "number", min: -99, max: 999, value: 0, required: true }),
      ),
    ),
  );
  const rolls = section(
    t("Dice tray", "骰盘"),
    form(
      "dice",
      t("Roll", "掷骰"),
      (v) =>
        send({
          type: "roll",
          count: Number(v.count),
          sides: Number(v.sides),
          modifier: Number(v.modifier),
        }),
      field(
        t("Dice", "数量"),
        input("count", { type: "number", value: 1, min: 1, max: 12, required: true }),
      ),
      field(
        t("Die", "骰型"),
        select(
          "sides",
          [4, 6, 8, 10, 12, 20, 100].map((n) => [String(n), "D" + n]),
          "20",
        ),
      ),
      field(
        t("Modifier", "修正值"),
        input("modifier", { type: "number", value: 0, min: -99, max: 99, required: true }),
      ),
    ),
    table.rolls.length
      ? list(
          ...table.rolls.map((r) =>
            entry(
              brief(String(r.total), r.who),
              node(
                "span",
                {},
                r.dice.join(" + ") +
                  (r.modifier ? (r.modifier > 0 ? " + " : " − ") + Math.abs(r.modifier) : "") +
                  " (D" +
                  r.sides +
                  ")",
              ),
            ),
          ),
        )
      : hint(t("Your rolls will appear here.", "骰点将记录在这里。")),
  );
  return [
    hero,
    node(
      "div",
      { className: "columns" },
      node(
        "div",
        {},
        players,
        section(
          t("Scene notes", "场景笔记"),
          form(
            "note",
            t("Save notes", "保存笔记"),
            (v, id) => send({ type: "note", body: v.body }, id),
            field(
              t("Scene", "场景"),
              node("textarea", { name: "body", maxLength: 6000, rows: 4, value: table.notes }),
            ),
          ),
        ),
      ),
      rolls,
    ),
  ];
});
