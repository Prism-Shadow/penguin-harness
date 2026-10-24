import type { ComponentType } from "react";
import type { PageEntry } from "./early-frame-page-table";

export function ContributedPage({
  page,
  builtins = {},
}: {
  page: PageEntry;
  builtins?: Readonly<Record<string, ComponentType>>;
}) {
  if ("iframe" in page.renderer) {
    return (
      <iframe title={page.key} src={page.renderer.iframe.src} className="h-full w-full border-0" />
    );
  }
  const Component = builtins[page.renderer.builtin];
  if (Component === undefined) {
    throw new Error(
      `Missing builtin renderer "${page.renderer.builtin}" for contributed page "${page.key}" (${page.path})`,
    );
  }
  return <Component />;
}
