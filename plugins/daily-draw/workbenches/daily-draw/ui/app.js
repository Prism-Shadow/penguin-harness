import {
  t,
  zh,
  desk,
  node,
  row,
  heading,
  section,
  hint,
  button,
  form,
  field,
  list,
  entry,
  brief,
  today,
  displayDay,
} from "./desk-kit.js";
let selected = null;
let displayedDay = today();
const redraw = desk(t("Daily Draw", "每日一签"), (journal, { send, draw }) => {
  const day = selected ?? today();
  const record = journal.draws.find((d) => d.day === day);
  const hero = node(
    "article",
    { className: "hero slip" },
    node("img", { className: "slip-mark", alt: "", src: "./slip-mark.svg" }),
    heading(displayDay(day)),
  );
  if (record) {
    hero.append(
      node("p", { className: "readout" }, record.slip[zh ? 1 : 0]),
      node("p", {}, record.slip[zh ? 3 : 2]),
      form(
        "note-" + day,
        t("Save reflection", "保存感想"),
        (v, id) => send({ type: "note", day, note: v.note }, id),
        field(
          t("A line to remember", "记下一句话"),
          node("textarea", { name: "note", rows: 2, maxLength: 600, value: record.note }),
        ),
      ),
    );
  } else
    hero.append(
      node("p", { className: "readout" }, t("Today’s slip", "今日签笺")),
      button(t("Draw a slip", "抽一支签"), () => send({ type: "draw", day }), true),
    );
  const history = section(
    t("Draw journal", "签笺手记"),
    journal.draws.length
      ? list(
          ...journal.draws.map((r) =>
            entry(
              brief(r.slip[zh ? 1 : 0], r.note),
              button(displayDay(r.day), () => {
                selected = r.day;
                draw();
              }),
            ),
          ),
        )
      : hint(t("Your first draw will be kept here.", "抽出的第一支签会收在这里。")),
  );
  if (selected && selected !== today())
    history.prepend(
      button(t("Back to today", "回到今天"), () => {
        selected = null;
        draw();
      }),
    );
  return [node("div", { className: "draw-layout" }, hero, history)];
});
setInterval(() => {
  if (displayedDay !== today()) {
    displayedDay = today();
    selected = null;
    redraw();
  }
}, 30000);
