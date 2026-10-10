// A switch one of whose positions this machine cannot honour (the sandbox's "Temporary
// directory writable" where the backends in use cannot close it).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PluginConfigEntry, PluginConfigField } from "@prismshadow/penguin-server/api";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { ConfigField } from "../src/features/settings/plugin-config-field";

const FIELD: PluginConfigField = { type: "boolean", title: "Temporary directory writable" };
const REASON = "the sandbox backend in use here (dsh-local) cannot close the temporary directory";

const entry = (unavailable: boolean): PluginConfigEntry => ({
  name: "sandbox",
  configuration: { title: "Sandbox", properties: { writableTemp: FIELD } },
  values: { writableTemp: true },
  ...(unavailable
    ? {
        unavailable: [
          { field: "writableTemp", value: "false", reason: REASON, reasonZh: "无法关闭临时目录" },
        ],
      }
    : {}),
});

const draw = (unavailable: boolean, value: boolean, locale: "en" | "zh" = "en") =>
  renderToStaticMarkup(
    createElement(ConfigField, {
      entry: entry(unavailable),
      name: "writableTemp",
      field: FIELD,
      value,
      error: undefined,
      tableErrors: [],
      clearing: false,
      onChange: () => {},
      onClearingChange: () => {},
      disabled: false,
      locale,
    }),
  );

const switchTag = (html: string) => /<button[^>]*role="switch"[^>]*>/.exec(html)?.[0] ?? "";

describe("a switch with a position this machine cannot honour", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));

  // Held on while it stands on; left movable when already off (a backend went away since).
  it.each([
    [true, true, true],
    [true, false, false],
    [false, true, false],
  ])("unavailable %s, on %s: held %s", (unavailable, on, held) => {
    const html = draw(unavailable, on);
    expect(switchTag(html)).toContain(`aria-checked="${on}"`);
    expect(switchTag(html).includes('disabled=""')).toBe(held);
    expect(html.includes(`Off is not supported here: ${REASON}`)).toBe(unavailable);
  });

  it("names the reason in the page's language", () => {
    setActiveStrings(zh);
    try {
      expect(draw(true, true, "zh")).toContain("本机不支持关闭：无法关闭临时目录");
    } finally {
      setActiveStrings(en);
    }
  });
});
