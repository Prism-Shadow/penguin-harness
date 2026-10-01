/**
 * The plugin rules panel (src/features/plugins/plugin-import-dialog.tsx).
 *
 * It states, at the point where an operator is naming a plugin, the rules the form cannot show.
 * Two of them carry the weight: leave the name empty and it comes from the SOURCE — and a GitHub
 * repository URL carries the repository's name, which is how a plugin installs under a name
 * nobody asked for; and a plugin must not carry its author's account details or credentials, a
 * rule whose home is this surface rather than any one plugin repository.
 *
 * The dialogs themselves cannot be rendered here (Modal portals to document.body, this suite is
 * `environment: "node"`), so the panel is rendered on its own and the two dialogs are checked
 * against the source, the way modal-focus.test.ts checks its portal-bound wiring.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PluginRules } from "../src/features/plugins/plugin-import-dialog";
import { S } from "../src/lib/strings";

const source = readFileSync(
  fileURLToPath(new URL("../src/features/plugins/plugin-import-dialog.tsx", import.meta.url)),
  "utf8",
);

/** React escapes `&`, `<` and `>` in text children; the rules quote URL shapes, so the markup holds the escaped form. */
const asMarkup = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

describe("PluginRules", () => {
  const html = renderToStaticMarkup(createElement(PluginRules));

  it("carries both titles: importing a plugin, and writing one", () => {
    expect(html).toContain(S.plugins.importRulesTitle);
    expect(html).toContain(S.plugins.authoringRulesTitle);
    expect(S.plugins.importRules.length).toBeGreaterThan(0);
    expect(S.plugins.authoringRules.length).toBeGreaterThan(0);
  });

  it("lists every rule of both lists, in order, as numbered lists", () => {
    // Ordered and not bulleted on purpose: the name rule is a precedence the reader walks.
    const lists = html.match(/<ol[^>]*>.*?<\/ol>/g) ?? [];
    expect(lists).toHaveLength(2);
    expect(html.match(/<li>/g) ?? []).toHaveLength(
      S.plugins.importRules.length + S.plugins.authoringRules.length,
    );
    for (const [i, rules] of [S.plugins.importRules, S.plugins.authoringRules].entries()) {
      const positions = rules.map((rule) => lists[i]!.indexOf(asMarkup(rule)));
      expect(positions).not.toContain(-1);
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
    }
  });

  it("spells out the rule the form cannot show: the name comes from the source", () => {
    // The precedence itself — typed name, then the source's own name, then the archive's layout.
    expect(html).toContain("你填的名字");
    expect(html).toContain("仓库地址取仓库名");
    // …and the caps and the collision rule, which no control on the dialog states either.
    expect(html).toContain("14 MB");
    expect(html).toContain("32 MB");
    expect(html).toContain("覆盖");
  });

  it("keeps a plugin's author from baking in account details or credentials", () => {
    const authoring = S.plugins.authoringRules.join("\n");
    expect(authoring).toContain("目录名即插件名");
    expect(authoring).toContain("不要把账号信息写进插件");
    expect(authoring).toContain("不提交密钥");
    // Stated as the reader's own values being the wrong default, which is how they get in.
    expect(authoring).toContain("不要写死默认值");
  });

  it("is rendered by both import dialogs, upload and download", () => {
    expect(source.match(/<PluginRules \/>/g) ?? []).toHaveLength(2);
  });
});
