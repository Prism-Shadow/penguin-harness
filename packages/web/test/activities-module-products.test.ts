import { describe, expect, it } from "vitest";
import type { ModuleProduct } from "@prismshadow/penguin-server/api";
import { filterModuleProducts, moduleProductKey } from "../src/features/activities/module-products";

const product = (over: Partial<ModuleProduct>): ModuleProduct => ({
  moduleFolder: "waf-module-r2pt01",
  productCode: "r2pt01",
  title: "Pat",
  activityType: "standard",
  refNums: [1],
  ...over,
});

describe("searching the products in the modules", () => {
  const items = [
    product({}),
    product({ moduleFolder: "waf-module-lang1", productCode: "lang1", title: null }),
  ];

  it("matches the title, the product code or the module folder", () => {
    expect(filterModuleProducts(items, "pat").map((item) => item.productCode)).toEqual(["r2pt01"]);
    expect(filterModuleProducts(items, "LANG").map((item) => item.productCode)).toEqual(["lang1"]);
    expect(filterModuleProducts(items, "waf-module-")).toHaveLength(2);
    expect(filterModuleProducts(items, "  ")).toHaveLength(2);
  });

  it("knows a product by its folder and code", () => {
    expect(moduleProductKey(items[1]!)).toBe("waf-module-lang1/lang1");
  });
});
