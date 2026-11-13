/**
 * The company mode's contributed-page nav rows (features/company/sidebar-mode.tsx
 * `orgNavRowsOf`): a page with a `parent` that is one of the released org pages hangs as a
 * child under it, in table order; a page without a parent sits at the top level; a page whose
 * `parent` is not among these pages has nowhere to hang, so the nav leaves it out.
 */
import { describe, expect, it } from "vitest";
import { orgNavRowsOf } from "../src/features/company/sidebar-mode";
import type { WebAppPage } from "../src/web-app/page-table";

const Blank = () => null;

function page(key: string, parent?: string): WebAppPage {
  return {
    id: `${key}.page`,
    key,
    path: `/${key}`,
    frame: "shell",
    nav: "org",
    admin: false,
    released: true,
    order: 0,
    ...(parent === undefined ? {} : { parent }),
    Component: Blank,
  };
}

const toOf = (p: { path: string }) => p.path;
const labelOf = (p: { key: string }) => p.key;
const iconOf = (p: { key: string }) => p.key;
const keysOf = (items: readonly { key: string }[]) => items.map((item) => item.key);

describe("orgNavRowsOf", () => {
  it("hangs a child under its parent and keeps top-level pages in order", () => {
    const rows = orgNavRowsOf(
      [page("reports"), page("report-detail", "reports"), page("insights")],
      toOf,
      labelOf,
      iconOf,
    );
    expect(keysOf(rows)).toEqual(["reports", "insights"]);
    expect(rows[0]!.children?.map((child) => child.key)).toEqual(["report-detail"]);
    expect(rows[0]!.children?.[0]!.to).toBe("/report-detail");
  });

  it("leaves a page out of the nav when its parent is not one of these pages", () => {
    const rows = orgNavRowsOf([page("reports"), page("orphan", "nowhere")], toOf, labelOf, iconOf);
    expect(keysOf(rows)).toEqual(["reports"]);
  });

  it("does not hang a child under a child, and treats a self-parent as none", () => {
    const rows = orgNavRowsOf(
      [page("reports"), page("detail", "reports"), page("deep", "detail"), page("self", "self")],
      toOf,
      labelOf,
      iconOf,
    );
    expect(keysOf(rows)).toEqual(["reports"]);
    expect(rows[0]!.children?.map((child) => child.key)).toEqual(["detail"]);
  });
});
