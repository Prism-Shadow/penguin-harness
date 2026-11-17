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
  today,
  displayDay,
} from "./desk-kit.js";
const zones = {
  chilled: t("Fridge", "冷藏"),
  frozen: t("Freezer", "冷冻"),
  pantry: t("Pantry", "常温"),
};
let filter = "all",
  editId = null;
desk(t("Fridge Keeper", "冰箱管家"), (fridge, { send, draw }) => {
  const editing = fridge.items.find((i) => i.id === editId);
  const soon = (date) => date && (Date.parse(date) - Date.parse(today())) / 86400000 <= 3;
  const items = fridge.items
    .filter((i) => filter === "all" || (filter === "soon" ? soon(i.day) : filter === i.zone))
    .sort(
      (a, b) => (a.day || "9999").localeCompare(b.day || "9999") || a.name.localeCompare(b.name),
    );
  const fields = form(
    "item-" + (editing?.id ?? "new"),
    editing ? t("Save changes", "保存更改") : t("Add to inventory", "入库"),
    async (v, id) => {
      if (
        await send(
          { type: editing ? "edit" : "add", ...v, id: editing?.id, count: Number(v.count) },
          id,
        )
      ) {
        editId = null;
        draw(id);
      }
    },
    field(
      t("Ingredient", "食材名称"),
      input("name", { required: true, value: editing?.name ?? "" }),
    ),
    field(
      t("Quantity", "数量"),
      input("count", {
        type: "number",
        required: true,
        value: editing?.count ?? 1,
        min: 1,
        max: 999,
      }),
    ),
    field(
      t("Unit", "单位"),
      input("unit", {
        maxLength: 18,
        value: editing?.unit ?? "",
        placeholder: t("e.g. cartons", "例如：盒"),
      }),
    ),
    field(
      t("Location", "存放位置"),
      select("zone", Object.entries(zones), editing?.zone ?? "chilled"),
    ),
    field(t("Best before", "保质期至"), input("day", { type: "date", value: editing?.day ?? "" })),
  );
  const filters = row(
    ...Object.entries({
      all: t("All", "全部"),
      soon: t("Due soon or past", "临期与过期"),
      ...zones,
    }).map(([key, label]) => {
      const b = button(
        label,
        () => {
          filter = key;
          draw();
        },
        filter === key,
      );
      b.setAttribute("aria-pressed", String(filter === key));
      return b;
    }),
  );
  const stock = section(
    t("Inventory", "食材清单"),
    filters,
    items.length
      ? list(
          ...items.map((item) =>
            entry(
              brief(item.name, zones[item.zone] + (item.day ? " · " + displayDay(item.day) : "")),
              node("strong", {}, String(item.count) + " " + item.unit),
              button(t("Use one", "用掉一份"), () => send({ type: "use", id: item.id })),
              button(t("Edit", "编辑"), () => {
                editId = item.id;
                draw();
                document.querySelector("input[name=name]").focus();
              }),
            ),
          ),
        )
      : hint(
          fridge.items.length
            ? t("No matching ingredients.", "这个分组里还没有食材。")
            : t("Add an ingredient to start your inventory.", "从录入第一份食材开始。"),
        ),
  );
  return [
    section(
      editing ? t("Edit ingredient", "编辑食材") : t("Stock an ingredient", "添加食材"),
      fields,
      editing
        ? row(
            button(t("Cancel", "取消"), () => {
              editId = null;
              draw();
            }),
            button(t("Remove ingredient", "移除食材"), async () => {
              if (await send({ type: "remove", id: editing.id })) {
                editId = null;
                draw();
              }
            }),
          )
        : null,
    ),
    stock,
  ];
});
