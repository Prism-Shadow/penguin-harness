/**
 * The composer family (src/components/chat/composer): the card with its text body and one-row
 * toolbar, the action button's two faces, the slash list and the picker panel a switch command
 * opens, and the toolbar trigger's two shapes. Every word comes from the caller.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  ChipRow,
  ComposerCard,
  SendButton,
  SlashMenu,
  SlashPicker,
} from "../src/components/chat/composer/composer";
import { ToolbarTrigger } from "../src/components/chat/composer/toolbar-trigger";
import { classTokens, renderStatic } from "../src/testing";

const noop = () => {};

describe("ComposerCard", () => {
  const card = (hint?: string) =>
    renderStatic(
      createElement(ComposerCard, {
        attachments: createElement("p", null, "ATTACHED"),
        chips: createElement("p", null, "CHIPS"),
        textarea: { value: "draft", placeholder: "Type a message", onChange: noop },
        tools: createElement("button", { type: "button" }, "TOOL"),
        ...(hint !== undefined ? { hint } : {}),
        actions: createElement("button", { type: "button" }, "ACTION"),
      }),
    );

  it("is the glass card, sized by its own width, ringed while anything in it has focus", () => {
    const tokens = classTokens(card());
    expect(tokens).toContain("ui-glass");
  });

  it("stacks the attachments, the chips, a two-line text body, then the toolbar", () => {
    const html = card("Type / for commands");
    const textarea = /<textarea\b[^>]*>/.exec(html)?.[0] ?? "";
    expect(textarea).toContain('rows="2"');
    expect(textarea).toContain('placeholder="Type a message"');
    const order = ["ATTACHED", "CHIPS", "<textarea", "TOOL", "Type / for commands", "ACTION"].map(
      (s) => html.indexOf(s),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((i) => i >= 0)).toBe(true);
    // The hint shows only once the card is wide enough, and names itself on hover.
    expect(html).toContain('data-tooltip="Type / for commands"');
  });

  it("draws no hint when there is none", () => {
    expect(card()).not.toContain("@lg:block");
  });
});

describe("ChipRow", () => {
  it("offers a named remove button on each chip", () => {
    const html = renderStatic(
      createElement(ChipRow, {
        chips: [{ key: "a", label: "research", removeLabel: "Remove research" }],
      }),
    );
    expect(html).toContain('aria-label="Remove research"');
  });
});

describe("SendButton", () => {
  it("sends, named and hinted by what it does now", () => {
    const html = renderStatic(
      createElement(SendButton, { action: "send", label: "Send", onClick: noop }),
    );
    expect(html).toContain('aria-label="Send"');
    expect(html).toContain('data-tooltip="Send"');
    expect(html).not.toContain('disabled=""');
  });

  it("greys out while there is nothing to send", () => {
    const html = renderStatic(
      createElement(SendButton, { action: "send", label: "Send", disabled: true, onClick: noop }),
    );
    expect(html).toContain('disabled=""');
  });

  it("stops, and can always be pressed", () => {
    const html = renderStatic(
      createElement(SendButton, { action: "stop", label: "Stop", disabled: true, onClick: noop }),
    );
    expect(html).toContain('aria-label="Stop"');
    expect(html).not.toContain('disabled=""');
    // No icon in a tint of itself: the danger tint arrives on hover only.
    expect(html).toContain("<rect");
  });
});

describe("SlashMenu", () => {
  const menu = renderStatic(
    createElement(SlashMenu, {
      items: [
        { command: "/compact", description: "Compress the context" },
        { command: "/goal", description: "Work towards a goal" },
      ],
      active: 1,
      onActiveChange: noop,
      onRun: noop,
      maxHeight: 200,
    }),
  );

  it("opens as a glass menu panel over the composer, capped at the room above it", () => {
    expect(classTokens(menu)).toContain("ui-glass");
    expect(menu).toContain("max-height:200px");
  });

  it("lists each command with what it does as its hint", () => {
    expect(menu).toContain(">/compact</span>");
    expect(menu).toContain('data-tooltip="Compress the context"');
  });

  it("lists one row per matching command", () => {
    const rows = menu.split("<button").slice(1);
    expect(rows).toHaveLength(2);
  });
});

describe("SlashPicker", () => {
  it("names the switch in a title bar above the caller's picker", () => {
    const html = renderStatic(
      createElement(SlashPicker, {
        title: "Switch model",
        children: createElement("p", null, "PICKER"),
      }),
    );
    expect(html.indexOf("Switch model")).toBeLessThan(html.indexOf("PICKER"));
  });
});

describe("ToolbarTrigger", () => {
  it("is an icon button named by the caller, its tooltip the name unless given another", () => {
    const html = renderStatic(
      createElement(ToolbarTrigger, { glyph: "M12 5v14M5 12h14", ariaLabel: "Add" }),
    );
    expect(html).toContain('aria-label="Add"');
    expect(html).toContain('data-tooltip="Add"');
    expect(html).not.toContain("aria-expanded");
  });

  it("carries a count, and none at zero", () => {
    const three = renderStatic(
      createElement(ToolbarTrigger, { glyph: "M12 5v14", ariaLabel: "Skills", badge: 3 }),
    );
    expect(three).toContain(">3</span>");
    const zero = renderStatic(
      createElement(ToolbarTrigger, { glyph: "M12 5v14", ariaLabel: "Skills", badge: 0 }),
    );
    expect(zero).not.toContain(">0<");
  });

  it("as a pill shows its value and says it opens a list", () => {
    const html = renderStatic(
      createElement(ToolbarTrigger, {
        glyph: "M12 5v14",
        label: "High",
        caret: true,
        ariaLabel: "Thinking level",
        tooltip: "Thinking level: High",
        expanded: false,
      }),
    );
    expect(html).toContain('aria-label="Thinking level"');
    expect(html).toContain('data-tooltip="Thinking level: High"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(">High</span>");
  });
});
