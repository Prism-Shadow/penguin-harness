/**
 * A switch one of whose positions the machine cannot honour (the sandbox's "Temporary directory
 * writable" where the backends in use cannot close it).
 *
 * - Given the "false" position unavailable and the switch on, the switch is held on (disabled)
 *   and the reason is named under it, in the page's language.
 * - Given the switch already off (a backend went away since), it stays movable, so the setting
 *   can be put right.
 * - Given no position unavailable, the switch is an ordinary one.
 */
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

  it("is held at the other position, naming why", () => {
    const html = draw(true, true);
    expect(switchTag(html)).toContain('aria-checked="true"');
    expect(switchTag(html)).toContain('disabled=""');
    expect(html).toContain(`Off is not supported here: ${REASON}`);
  });

  it("names the reason in the page's language", () => {
    setActiveStrings(zh);
    try {
      expect(draw(true, true, "zh")).toContain("本机不支持关闭：无法关闭临时目录");
    } finally {
      setActiveStrings(en);
    }
  });

  it("stays movable where it already stands at the unsupported position", () => {
    const html = draw(true, false);
    expect(switchTag(html)).toContain('aria-checked="false"');
    expect(switchTag(html)).not.toContain('disabled=""');
    expect(html).toContain("Off is not supported here");
  });

  it("is an ordinary switch with nothing unavailable", () => {
    const html = draw(false, true);
    expect(switchTag(html)).not.toContain('disabled=""');
    expect(html).not.toContain("not supported");
  });
});
