import { date, integer, requireValue, text, workbench } from "./desk-kit.js";
interface Item {
  id: number;
  name: string;
  count: number;
  unit: string;
  zone: string;
  day: string;
}
interface Fridge {
  items: Item[];
  nextId: number;
}
export default workbench<Fridge>({ items: [], nextId: 1 }, (fridge, a) => {
  if (a.type === "add" || a.type === "edit") {
    const fields = {
      name: text(a.name),
      count: integer(a.count, 1, 999),
      unit: text(a.unit, 18, true),
      zone: text(a.zone, 12),
      day: a.day === "" ? "" : date(a.day),
    };
    requireValue(["chilled", "frozen", "pantry"].includes(fields.zone));
    if (a.type === "add") {
      requireValue(fridge.items.length < 500, "full");
      fridge.items.push({ id: fridge.nextId++, ...fields });
    } else {
      const item = fridge.items.find((i) => i.id === a.id);
      requireValue(item);
      Object.assign(item, fields);
    }
    return;
  }
  const at = fridge.items.findIndex((i) => i.id === a.id);
  requireValue(at >= 0);
  if (a.type === "use") {
    if (--fridge.items[at]!.count === 0) fridge.items.splice(at, 1);
  } else if (a.type === "remove") fridge.items.splice(at, 1);
  else requireValue(false);
});
