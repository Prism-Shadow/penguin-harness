/** Pure helpers behind the Open from modules dialog. */
import type { ModuleProduct } from "@prismshadow/penguin-server/api";

/** The products matching a search over title, product code and module folder, in order. */
export function filterModuleProducts(
  items: readonly ModuleProduct[],
  query: string,
): ModuleProduct[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...items];
  return items.filter((item) =>
    [item.title ?? "", item.productCode, item.moduleFolder].some((field) =>
      field.toLowerCase().includes(needle),
    ),
  );
}

/** The key one product is known by in the dialog. */
export function moduleProductKey(item: Pick<ModuleProduct, "moduleFolder" | "productCode">) {
  return `${item.moduleFolder}/${item.productCode}`;
}
