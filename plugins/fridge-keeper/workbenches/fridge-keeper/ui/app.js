import {
  t,
  desk,
  node,
  row,
  section,
  hint,
  field,
  input,
  select,
  form,
  button,
  list,
  entry,
  brief,
  today,
  displayDay,
} from "./desk-kit.js";
const zones = {
  chilled: t("Fridge", "冷藏"),
  frozen: t("Freezer", "冷冻"),
  pantry: t("Pantry", "常温"),
};
let location = "all";
let editor = null;

desk(t("Fridge Keeper", "冰箱管家"), (fridge, { send, draw }) => {
  function openEditor(id) {
    editor = id;
    draw();
    document.querySelector("input[name=name]")?.focus();
  }
  if (editor !== null) {
    const item = fridge.items.find((i) => i.id === editor);
    if (editor === "new" || item) {
      const fields = form(
        "item-" + editor,
        item ? t("Save changes", "保存更改") : t("Add to inventory", "入库"),
        async (v, id) => {
          if (
            await send(
              { type: item ? "edit" : "add", ...v, id: item?.id, count: Number(v.count) },
              id,
            )
          ) {
            editor = null;
            if (location !== "all") location = v.zone;
            draw(id);
          }
        },
        field(
          t("Ingredient", "食材名称"),
          input("name", { required: true, value: item?.name ?? "" }),
        ),
        field(
          t("Quantity", "数量"),
          input("count", {
            type: "number",
            required: true,
            value: item?.count ?? 1,
            min: 1,
            max: 999,
          }),
        ),
        field(
          t("Unit", "单位"),
          input("unit", {
            maxLength: 18,
            value: item?.unit ?? "",
            placeholder: t("e.g. cartons", "例如：盒"),
          }),
        ),
        field(
          t("Location", "存放位置"),
          select(
            "zone",
            Object.entries(zones),
            item?.zone ?? (location === "all" ? "chilled" : location),
          ),
        ),
        field(t("Best before", "保质期至"), input("day", { type: "date", value: item?.day ?? "" })),
      );
      return [
        section(
          item ? t("Edit ingredient", "编辑食材") : t("Stock an ingredient", "添加食材"),
          fields,
          row(
            button(t("Cancel", "取消"), () => {
              editor = null;
              draw();
            }),
            item
              ? button(t("Remove ingredient", "移除食材"), async () => {
                  if (await send({ type: "remove", id: item.id })) {
                    editor = null;
                    draw();
                  }
                })
              : null,
          ),
        ),
      ];
    }
    editor = null;
  }
  const date = today();
  const stock = fridge.items
    .filter((i) => location === "all" || i.zone === location)
    .sort(
      (a, b) => (a.day || "9999").localeCompare(b.day || "9999") || a.name.localeCompare(b.name),
    );
  const past = [],
    soon = [],
    other = [];
  for (const item of stock) {
    const days = item.day ? (Date.parse(item.day) - Date.parse(date)) / 86400000 : Infinity;
    const deadline =
      days === 0
        ? t("Today", "今天到期")
        : days === 1
          ? t("Tomorrow", "明天到期")
          : item.day
            ? displayDay(item.day)
            : "";
    const group = days < 0 ? past : days <= 3 ? soon : other;
    group.push(
      entry(
        brief(item.name, [zones[item.zone], deadline].filter(Boolean).join(" · ")),
        node("strong", {}, [item.count, item.unit].filter(Boolean).join(" ")),
        button(t("Use one", "用掉一份"), () => send({ type: "use", id: item.id })),
        button(t("Edit", "编辑"), () => openEditor(item.id)),
      ),
    );
  }
  const picker = select(
    "location",
    [["all", t("All locations", "全部位置")], ...Object.entries(zones)],
    location,
  );
  picker.setAttribute("aria-label", t("Storage location", "存放位置"));
  picker.onchange = () => {
    location = picker.value;
    draw();
  };
  const toolbar = node(
    "div",
    { className: "inventory-bar" },
    node("h2", {}, t("Inventory", "食材清单")),
    row(
      picker,
      button(t("Add ingredient", "添加食材"), () => openEditor("new"), true),
    ),
  );
  const used = fridge.lastUsed;
  const feedback = used
    ? node(
        "div",
        { className: "consumption", role: "status" },
        node("span", {}, t("Used one portion of ", "已用掉一份") + used.name),
        button(t("Undo", "撤销"), () => send({ type: "undo-use", id: used.id })),
      )
    : null;
  return [
    toolbar,
    feedback,
    past.length ? section(t("Past best-before date", "已过保质期"), list(...past)) : null,
    soon.length
      ? section(t("Use in the next three days", "优先使用 · 三天内到期"), list(...soon))
      : null,
    other.length ? section(t("Other ingredients", "其余食材"), list(...other)) : null,
    !stock.length
      ? hint(
          fridge.items.length
            ? t("No ingredients in this location.", "这里暂时没有食材。")
            : t("Your inventory is empty.", "食材清单为空。"),
        )
      : null,
  ].filter(Boolean);
});
