/**
 * The messaging binding editor's rendered shape (src/features/messaging/messaging-binding-editor.tsx).
 *
 * Five rules this pins, all of which are invisible to a type checker: the form opens on its
 * FIELDS (the explanation lives in the collapsed FAQ under the save area, not above the first
 * input), each channel's developer-console link rides the credential field's corner, a stored
 * secret is removed by the models-page clear checkbox rather than an unbind button — that
 * checkbox is gated, on screen, while the channel holds the connection — and a connection
 * error's detail reaches the reader whole rather than as a few words of a shared row.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { MessagingChannel } from "@prismshadow/penguin-server/api";
import {
  MessagingBindingBody,
  MessagingBindingHelp,
  type MessagingBindingEditorState,
  type MessagingChannelFacts,
} from "../src/features/messaging/messaging-binding-editor";
import { emptyMessagingForm } from "../src/features/messaging/messaging-binding-form";
import { S } from "../src/lib/strings";

const DARK: MessagingChannelFacts = {
  secretConfigured: false,
  secretMasked: null,
  enabled: false,
  status: { state: "disconnected" },
  lastChatKnown: false,
};

/** A state object shaped like the hook's, with the handlers stubbed (this renders, never acts). */
function stateOf(
  channel: MessagingChannel,
  facts: Partial<Record<MessagingChannel, MessagingChannelFacts>> = {},
  extra: Partial<MessagingBindingEditorState> = {},
): MessagingBindingEditorState {
  const noop = async () => {};
  return {
    form: emptyMessagingForm(channel),
    patchForm: () => {},
    selectChannel: () => {},
    channels: { feishu: DARK, telegram: DARK, ...facts },
    fieldErrors: {},
    dirty: false,
    busy: false,
    toggling: false,
    testing: false,
    sendingTest: false,
    testable: false,
    toggleBlocked: false,
    toggleHint: null,
    save: noop,
    toggleEnabled: noop,
    testConnection: noop,
    sendTestMessage: noop,
    ...extra,
  };
}

const render = (state: MessagingBindingEditorState) =>
  renderToStaticMarkup(createElement(MessagingBindingBody, { b: state }));

describe("MessagingBindingBody", () => {
  it("opens on the fields: no explanatory prose above the first input", () => {
    const feishu = render(stateOf("feishu"));
    expect(feishu).toContain(S.feishu.appId);
    // The intro moved into the FAQ fold; leading the form with it is what this change undid.
    expect(feishu).not.toContain(S.feishu.intro);
    expect(render(stateOf("telegram"))).not.toContain(S.telegram.intro);
  });

  it("hangs each channel's developer-console link on its credential field's corner", () => {
    // The models dialog's "get API key" idiom: the link sits where the value is pasted, so the
    // reader never has to leave the field to find out where the value comes from.
    expect(render(stateOf("feishu"))).toContain('href="https://open.feishu.cn/app"');
    expect(render(stateOf("telegram"))).toContain('href="https://core.telegram.org/bots/api"');
  });

  it("offers a stored secret's removal as the clear checkbox, gated on screen while enabled", () => {
    const saved: MessagingChannelFacts = {
      secretConfigured: true,
      secretMasked: "abcd…7890",
      enabled: false,
      status: { state: "disconnected" },
      lastChatKnown: false,
    };
    const dark = render(stateOf("feishu", { feishu: saved }));
    expect(dark).toContain("abcd…7890");
    expect(dark).toContain(S.feishu.clearSecret);
    expect(dark).toContain('type="checkbox"/>');
    expect(dark).not.toContain(S.messaging.disableBeforeClearHint);

    // Enabled: clearing would leave a live connection running on a credential the store no
    // longer has, so the box is disabled — and says why, since a disabled control does not
    // reliably fire hover.
    const live = render(
      stateOf("feishu", { feishu: { ...saved, enabled: true, status: { state: "connected" } } }),
    );
    expect(live).toContain('type="checkbox" disabled=""');
    expect(live).toContain(S.messaging.disableBeforeClearHint);
  });

  it("gives a connection error its own line, whole, instead of a share of the status row", () => {
    // The connection failures worth reporting name the action in the sentence — a share of
    // a row that already carries a switch, a label and a status word cut this one to
    // "Conflict: ter", which tells the reader nothing they can act on.
    const lastError =
      "getUpdates failed: another program is already polling this bot — one bot token can serve only one PenguinHarness server at a time (code 409)";
    const html = render(
      stateOf("telegram", {
        telegram: {
          ...DARK,
          secretConfigured: true,
          enabled: true,
          status: { state: "error", lastError },
        },
      }),
    );
    // A paragraph of its own, carrying the message whole.
    expect(html).toContain(`>${lastError}</p>`);
    // Outside the toggle row: the row closes before the message begins.
    const rowAt = html.indexOf("flex flex-wrap items-center gap-2 text-xs");
    expect(rowAt).toBeGreaterThanOrEqual(0);
    expect(html.slice(rowAt, html.indexOf(lastError, rowAt))).toContain("</div>");
    // Bounded so an error still cannot push the probes far, with the whole text on hover.
    expect(html).toContain("line-clamp-2");
    expect(html).toContain(`title="${lastError}"`);
  });

  it("shows the switch's gating reason when the other channel holds the connection", () => {
    const hint = S.messaging.otherEnabledHint(S.messaging.channelName.feishu);
    const html = render(
      stateOf(
        "telegram",
        { feishu: { ...DARK, secretConfigured: true, enabled: true } },
        { toggleBlocked: true, toggleHint: hint },
      ),
    );
    expect(html).toContain(hint);
  });
});

describe("MessagingBindingHelp", () => {
  it("stacks three self-titled folds, all collapsed, carrying the relocated explanation", () => {
    const html = renderToStaticMarkup(
      createElement(MessagingBindingHelp, { channel: "feishu" as MessagingChannel }),
    );
    for (const title of [
      S.messaging.faqSetupTitle,
      S.messaging.faqWhatTitle,
      S.messaging.faqTroubleTitle,
    ]) {
      expect(html).toContain(title);
    }
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(3);
    expect(html.match(/<div id="[^"]+" hidden/g)).toHaveLength(3);
    // The panels stay in the DOM while folded (aria-controls has to resolve), so the text is
    // present — hidden, not absent.
    expect(html).toContain(S.feishu.intro);
    expect(html).toContain(S.messaging.troubleNoChat);
    expect(html).toContain(S.feishu.setupSteps[0]);
  });

  it("puts each channel's tutorial link in its setup fold", () => {
    const feishu = renderToStaticMarkup(
      createElement(MessagingBindingHelp, { channel: "feishu" as MessagingChannel }),
    );
    expect(feishu).toContain(
      'href="https://open.feishu.cn/document/develop-an-echo-bot/introduction"',
    );
    const telegram = renderToStaticMarkup(
      createElement(MessagingBindingHelp, { channel: "telegram" as MessagingChannel }),
    );
    expect(telegram).toContain('href="https://core.telegram.org/bots/tutorial"');
    expect(telegram).toContain(S.telegram.setupSteps[0]);
  });
});
