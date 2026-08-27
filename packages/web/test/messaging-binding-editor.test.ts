/**
 * The messaging binding editor's rendered shape (src/features/messaging/messaging-binding-editor.tsx).
 *
 * Six rules this pins, all of which are invisible to a type checker: the form opens on its
 * FIELDS (the explanation lives in the collapsed FAQ under the save area, not above the first
 * input), each channel's credential-source link rides the credential field's corner, that
 * link's label names the place it actually opens, the connection switch — which IS the
 * bind/unbind — carries that sentence as its own tooltip rather than as a line the form
 * would have to make room for, a stored secret is removed by the models-page clear checkbox
 * and that checkbox is gated, on screen, while the channel holds the connection, and a
 * connection error's detail reaches the reader whole rather than as a few words of a shared
 * row.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { MessagingChannel } from "@prismshadow/penguin-server/api";
import {
  MessagingBindingBody,
  MessagingBindingHelp,
  telegramTestNotices,
  type MessagingBindingEditorState,
  type MessagingChannelFacts,
} from "../src/features/messaging/messaging-binding-editor";
import { emptyMessagingForm } from "../src/features/messaging/messaging-binding-form";
import { S, setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { formatDateTime } from "../src/lib/format";

afterEach(() => setActiveStrings(zh));

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
    sessionId: "session-under-test",
    form: emptyMessagingForm(channel),
    patchForm: () => {},
    selectChannel: () => {},
    channels: { feishu: DARK, telegram: DARK, qq: DARK, ...facts },
    fieldErrors: {},
    dirty: false,
    busy: false,
    toggling: false,
    testing: false,
    sendingTest: false,
    testable: false,
    toggleBlocked: false,
    toggleHint: null,
    adoptBinding: () => {},
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

  it("hangs each channel's credential source on its credential field's corner", () => {
    // The models dialog's "get API key" idiom: the link sits where the value is pasted, so the
    // reader never has to leave the field to find out where the value comes from.
    expect(render(stateOf("feishu"))).toContain('href="https://open.feishu.cn/app"');
    // Telegram's Bot Token is issued by @BotFather in the app, not by a web console — the
    // corner link goes there rather than into the API reference it used to point at.
    const telegram = render(stateOf("telegram"));
    expect(telegram).toContain('href="https://t.me/BotFather"');
    expect(telegram).not.toContain("core.telegram.org/bots/api");
    // QQ's trailing slash is load-bearing — https://q.qq.com/qqbot/dashboard answers 404 —
    // so it is pinned here rather than left to be tidied away by someone normalizing URLs.
    const qq = render(stateOf("qq"));
    expect(qq).toContain('href="https://q.qq.com/qqbot/dashboard/"');
    expect(qq).not.toContain('href="https://q.qq.com/qqbot/dashboard"');
  });

  it("labels that corner link with what it opens, never with a console Telegram has not got", () => {
    // The defect this pins: a link labelled "open developer console" that landed in the API
    // manual. Both dictionaries, because the label is per-locale and `S` is zh until a test
    // says otherwise — an assertion against the active dictionary alone would leave English
    // free to carry the very wording this fixed.
    for (const dict of [zh, en]) {
      setActiveStrings(dict);
      // Label and target in ONE assertion: pinned apart, they pass just as happily with the
      // right href on the wrong anchor.
      const telegram = render(stateOf("telegram"));
      const corner = /<a href="https:\/\/t\.me\/BotFather"[^>]*>([^<]*)<\/a>/.exec(telegram);
      expect(corner?.[1]).toBe(`${dict.telegram.openBotFather} ↗`);
      expect(telegram).not.toContain(dict.messaging.console);
      // ...and the channels that do have a console keep it.
      expect(render(stateOf("feishu"))).toContain(dict.messaging.console);
      expect(render(stateOf("qq"))).toContain(dict.messaging.console);
    }
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

  it("carries the bind/unbind sentence on the switch itself, as a tooltip rather than a line", () => {
    // Enabling the connection is what binds the bot to this conversation, which a label
    // reading "enable connection" does not say. It is semantics, so it is disclosed: on the
    // control, where nothing below has to move to make room for it.
    const html = render(stateOf("feishu"));
    expect(html).toContain(`title="${S.messaging.bindByEnableHint}"`);
    expect(html).not.toContain(`>${S.messaging.bindByEnableHint}<`);
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

  it('closes the form with the delivery options, each explanation behind its label\'s "?"', () => {
    for (const channel of ["feishu", "telegram", "qq"] as MessagingChannel[]) {
      const html = render(stateOf(channel));
      // Every channel carries both: they are delivery preferences, not credentials.
      expect(html).toContain(S.messaging.linePerMessage);
      expect(html).toContain(S.messaging.finalReplyOnly);
      // Semantics disclose — each sentence is in a popover panel, which renders collapsed.
      expect(html).toContain(S.common.moreInfoAbout(S.messaging.linePerMessage));
      expect(html).toContain(S.common.moreInfoAbout(S.messaging.finalReplyOnly));
      expect(html).not.toContain(S.messaging.linePerMessageHelp);
      expect(html).not.toContain(S.messaging.finalReplyOnlyHelp);
      // After the credential fields, not among them.
      const fieldAt = html.indexOf(
        channel === "telegram"
          ? S.telegram.botToken
          : channel === "qq"
            ? S.qq.appId
            : S.feishu.appId,
      );
      expect(fieldAt).toBeGreaterThanOrEqual(0);
      expect(html.indexOf(S.messaging.finalReplyOnly)).toBeGreaterThan(fieldAt);
      // In the order the two take effect: which messages are sent, then how each is split.
      expect(html.indexOf(S.messaging.linePerMessage)).toBeGreaterThan(
        html.indexOf(S.messaging.finalReplyOnly),
      );
    }
  });

  it("renders each delivery switch from its own form field", () => {
    // One row per option, each fed from the SELECTED channel's sub-state: a row wired to the
    // wrong field renders a switch that is on while the form says off, which no type checker
    // and no snapshot of the default state would catch.
    const form = emptyMessagingForm("telegram");
    form.telegram.finalReplyOnly = true;
    // Markdown rendering defaults ON, so the fresh form already has two of the three rows in
    // opposite states — which is what makes each row's slice worth reading separately.
    const html = render(stateOf("telegram", {}, { form }));
    const finalAt = html.indexOf(S.messaging.finalReplyOnly);
    const lineAt = html.indexOf(S.messaging.linePerMessage);
    const markdownAt = html.indexOf(S.messaging.renderMarkdown);
    expect(finalAt).toBeGreaterThanOrEqual(0);
    expect(lineAt).toBeGreaterThan(finalAt);
    expect(markdownAt).toBeGreaterThan(lineAt);
    // Each switch reads its own field: flipped, unflipped, and on by default.
    expect(html.slice(finalAt, lineAt)).toContain('aria-checked="true"');
    expect(html.slice(lineAt, markdownAt)).toContain('aria-checked="false"');
    expect(html.slice(markdownAt)).toContain('aria-checked="true"');
  });

  it('closes the form with the Markdown option too, its per-channel explanation behind the "?"', () => {
    const help = {
      feishu: S.messaging.renderMarkdownHelpFeishu,
      telegram: S.messaging.renderMarkdownHelpTelegram,
      qq: S.messaging.renderMarkdownHelpQQ,
    } as const;
    for (const channel of ["feishu", "telegram", "qq"] as MessagingChannel[]) {
      const html = render(stateOf(channel));
      expect(html).toContain(S.messaging.renderMarkdown);
      // Semantics disclose — the sentence is in the popover panel, which renders collapsed.
      expect(html).toContain(S.common.moreInfoAbout(S.messaging.renderMarkdown));
      expect(html).not.toContain(help[channel]);
      // One sentence per channel: what a channel can show is the whole of what the reader
      // needs here, and a shared line would have to say "depending on the channel".
      for (const other of ["feishu", "telegram", "qq"] as MessagingChannel[]) {
        if (other !== channel) expect(html).not.toContain(help[other]);
      }
      // After the credential fields, like the other delivery preference.
      const fieldAt = html.indexOf(
        channel === "telegram"
          ? S.telegram.botToken
          : channel === "qq"
            ? S.qq.appId
            : S.feishu.appId,
      );
      expect(html.indexOf(S.messaging.renderMarkdown)).toBeGreaterThan(fieldAt);
    }
  });

  it("states QQ's replies-only rule on screen, not in a collapsed fold", () => {
    // The one piece of channel copy that cannot wait to be unfolded. QQ delivers only
    // replies to messages sent from QQ, so a user who binds it and then works in the web app
    // sees nothing arrive and concludes the binding is broken. Every other channel's
    // explanation stays in the FAQ; this one is a line under the fields.
    const html = render(stateOf("qq"));
    expect(html).toContain(S.qq.repliesOnly);
    // Under the credential fields, so the controls above hold one height across channels.
    expect(html.indexOf(S.qq.repliesOnly)).toBeGreaterThan(html.indexOf(S.qq.appSecret));
    // ...and it belongs to QQ alone.
    expect(render(stateOf("feishu"))).not.toContain(S.qq.repliesOnly);
  });

  it("offers all three channels in the selector", () => {
    const html = render(stateOf("qq"));
    for (const name of [
      S.messaging.channelName.feishu,
      S.messaging.channelName.telegram,
      S.messaging.channelName.qq,
    ]) {
      expect(html).toContain(`>${name}</button>`);
    }
    expect(html).toContain("grid-cols-3");
  });

  it("says whether anything has arrived, and which end failed when something did", () => {
    // A bot Telegram is withholding messages from is `connected` with no error, forever.
    // Without this line the panel has nothing to distinguish it from a healthy binding
    // nobody has written to.
    const quiet = render(
      stateOf("telegram", {
        telegram: {
          ...DARK,
          secretConfigured: true,
          enabled: true,
          status: { state: "connected" },
        },
      }),
    );
    expect(quiet).toContain(S.messaging.inboundNone);

    const seen = render(
      stateOf("telegram", {
        telegram: {
          ...DARK,
          secretConfigured: true,
          enabled: true,
          status: { state: "connected", lastInboundAt: "2026-08-26T09:30:00.000Z" },
        },
      }),
    );
    expect(seen).toContain(S.messaging.inboundLastAt(formatDateTime("2026-08-26T09:30:00.000Z")));
    expect(seen).not.toContain(S.messaging.inboundNone);

    // The two post-arrival failures are the same silence in the chat and different actions
    // for the reader, so the line names the stage rather than only the message.
    const detail = "Bad Request: have no rights to send a message";
    const at = "2026-08-26T09:31:00.000Z";
    const failed = render(
      stateOf("telegram", {
        telegram: {
          ...DARK,
          secretConfigured: true,
          enabled: true,
          status: {
            state: "connected",
            lastInboundAt: "2026-08-26T09:30:00.000Z",
            lastDeliveryError: { at, stage: "send", detail },
          },
        },
      }),
    );
    expect(failed).toContain(S.messaging.deliveryFailedSend(formatDateTime(at), detail));
    expect(failed).not.toContain(S.messaging.deliveryFailedInbound(formatDateTime(at), detail));
    // The failure's own time is in the sentence, not parked in title=: nothing clears the
    // record on a later success, so a rights problem fixed three days ago would otherwise
    // read as live — and a hover-only title is unreachable on a touch screen.
    expect(failed).toContain(`>${S.messaging.deliveryFailedSend(formatDateTime(at), detail)}</p>`);
    expect(failed).toContain(`title="${detail}"`);
    // Arrival is still reported: a send failure is not a delivery failure.
    expect(failed).toContain(S.messaging.inboundLastAt(formatDateTime("2026-08-26T09:30:00.000Z")));
  });

  it("names the inbound stage when a message arrived and its task never started", () => {
    // The stage is an instruction, not a wording: "it never started" sends the reader to the
    // Session, "the reply never went out" sends them to the bot's rights in the chat. Only
    // the send branch had ever been rendered here, so the other could break unseen.
    // No apostrophe in the fixture: renderToStaticMarkup escapes one, and the assertion
    // below matches the rendered text rather than the string the dictionary returned.
    const detail = "The Workspace this Session runs in no longer exists";
    const at = "2026-08-26T09:31:00.000Z";
    const html = render(
      stateOf("telegram", {
        telegram: {
          ...DARK,
          secretConfigured: true,
          enabled: true,
          status: {
            state: "connected",
            lastInboundAt: "2026-08-26T09:30:00.000Z",
            lastDeliveryError: { at, stage: "inbound", detail },
          },
        },
      }),
    );
    expect(html).toContain(`>${S.messaging.deliveryFailedInbound(formatDateTime(at), detail)}</p>`);
    expect(html).not.toContain(S.messaging.deliveryFailedSend(formatDateTime(at), detail));
  });

  it("reports arrival while connecting and while erroring: it is traffic, not the socket", () => {
    const live: MessagingChannelFacts = { ...DARK, secretConfigured: true, enabled: true };
    // Telegram's connect runs getMe, getWebhookInfo, a backlog drain and a first getUpdates
    // before it reads as connected, and a token two programs are fighting over sits in
    // `error` half the time. Gating this line on `connected` hid it in both — the flapping
    // case being the one the panel was written for.
    const connecting = render(
      stateOf("telegram", { telegram: { ...live, status: { state: "connecting" } } }),
    );
    expect(connecting).toContain(S.messaging.inboundNone);

    const erroring = render(
      stateOf("telegram", {
        telegram: {
          ...live,
          status: {
            state: "error",
            lastError: "another program is already polling this bot",
            lastInboundAt: "2026-08-26T09:30:00.000Z",
          },
        },
      }),
    );
    // In `error`, a bot that has been receiving fine and one that never has are different
    // problems, and lastConnectionError is hidden there — this line is all that separates them.
    expect(erroring).toContain(
      S.messaging.inboundLastAt(formatDateTime("2026-08-26T09:30:00.000Z")),
    );

    // A binding with no connection has no such record and must not claim one.
    const dark = render(stateOf("telegram", { telegram: { ...DARK, secretConfigured: true } }));
    expect(dark).not.toContain(S.messaging.inboundNone);
  });

  it("leaves the last connection failure on screen after the connection recovers", () => {
    const detail = "another program is already polling this bot";
    const html = render(
      stateOf("telegram", {
        telegram: {
          ...DARK,
          secretConfigured: true,
          enabled: true,
          status: {
            state: "connected",
            lastConnectionError: { at: "2026-08-26T09:00:00.000Z", detail },
          },
        },
      }),
    );
    // A flapping connector is `connected` in every snapshot between its failures, so without
    // this the reader sees a healthy binding and no trace of the cause.
    expect(html).toContain(
      S.messaging.lastConnectionError(formatDateTime("2026-08-26T09:00:00.000Z"), detail),
    );

    // While the connection is actually down, `lastError` is the live one and this must not
    // double up beside it.
    const down = render(
      stateOf("telegram", {
        telegram: {
          ...DARK,
          secretConfigured: true,
          enabled: true,
          status: {
            state: "error",
            lastError: detail,
            lastConnectionError: { at: "2026-08-26T09:00:00.000Z", detail },
          },
        },
      }),
    );
    expect(down).toContain(`>${detail}</p>`);
    expect(down).not.toContain(
      S.messaging.lastConnectionError(formatDateTime("2026-08-26T09:00:00.000Z"), detail),
    );
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
    // The channel-neutral half of that fold: how one bot moves between conversations, which
    // is the question the enable-time 409 sends a reader here with.
    expect(html).toContain(S.messaging.faqWhatBinding);
    expect(html).toContain(S.messaging.troubleNoChat);
    expect(html).toContain(S.feishu.setupSteps[0]);
  });

  it("carries the Telegram-only troubleshooting entries, and neither of them on Feishu", () => {
    const telegram = renderToStaticMarkup(
      createElement(MessagingBindingHelp, { channel: "telegram" as MessagingChannel }),
    );
    // Group Privacy is on by default and produces silence, not an error, so the fold is the
    // only place a user who has not run a credential test can find out about it.
    expect(telegram).toContain(S.messaging.troubleGroupPrivacy);
    expect(telegram).toContain(S.messaging.troubleOnePoller);

    const feishu = renderToStaticMarkup(
      createElement(MessagingBindingHelp, { channel: "feishu" as MessagingChannel }),
    );
    expect(feishu).not.toContain(S.messaging.troubleGroupPrivacy);
    expect(feishu).not.toContain(S.messaging.troubleOnePoller);
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
    // The BotFather guide, not "From BotFather to 'Hello World'": the reader of this fold is
    // creating a bot to paste a token from, not writing one.
    expect(telegram).toContain('href="https://core.telegram.org/bots/features#botfather"');
    expect(telegram).toContain(S.telegram.setupSteps[0]);
    const qq = renderToStaticMarkup(
      createElement(MessagingBindingHelp, { channel: "qq" as MessagingChannel }),
    );
    // The onboarding guide, not the API reference: this fold is read by someone creating a
    // bot and looking for its credentials.
    expect(qq).toContain('href="https://bot.q.qq.com/wiki/"');
    expect(qq).toContain(S.qq.setupSteps[0]);
    // What the QR button spares the reader belongs beside those steps, not beside the
    // button: it is semantics, and a control is not a title for a standing sentence.
    expect(qq).toContain(S.qq.scanHint);
    // The reply budget is how this channel delivers a long answer, not a fault: it rides the
    // "what binding does" fold, while the passive-reply failure rides troubleshooting.
    expect(qq).toContain(S.qq.replyBudget);
    expect(qq).toContain(S.messaging.troubleQQPassive);
    expect(telegram).not.toContain(S.messaging.troubleQQPassive);
  });
});

describe("the Group Privacy copy, in both dictionaries", () => {
  // `S` is the zh dictionary at import time, so each rule is asserted per dictionary — the
  // two drifted apart once already (zh promised 三选一 and listed two options).
  const entries = [
    [en.messaging.troubleGroupPrivacy, "Making the bot an administrator"],
    [zh.messaging.troubleGroupPrivacy, "把机器人设为该群的管理员"],
  ] as const;

  it("leads the fold entry with the admin route, then the @BotFather one", () => {
    // Making the bot an administrator is the only remedy that fixes the group without
    // touching its membership, and it is what a user whose bot already works has done — so
    // it comes first, and the /setprivacy route (which requires a re-add) follows it.
    for (const [entry, adminRemedy] of entries) {
      expect(entry).toContain(adminRemedy);
      expect(entry).toContain("/setprivacy");
      expect(entry.indexOf(adminRemedy)).toBeLessThan(entry.indexOf("/setprivacy"));
    }
  });

  it("points the toast at that fold instead of repeating the remedies in it", () => {
    // The notice rides an `info` toast: four seconds, no hover-pause. So the toast carries
    // the diagnosis and names the fold — by the fold's own title, which stays true if the
    // fold is renamed — and the steps stay where they can be read.
    for (const dict of [en, zh]) {
      expect(dict.messaging.testPrivacyOn).toContain(dict.messaging.faqTroubleTitle);
      expect(dict.messaging.testPrivacyOn).not.toContain("/setprivacy");
    }
  });
});

describe("telegramTestNotices", () => {
  it("adds the privacy notice as a second line, leaving the success line untouched", () => {
    // Two lines, not one longer one: the credentials passed and a direct chat will answer,
    // so the success line is the truth and the privacy line is a separate caveat.
    expect(
      telegramTestNotices({
        ok: true,
        latencyMs: 12,
        botUsername: "@penguin_bot",
        groupPrivacy: true,
      }),
    ).toEqual([
      { tone: "success", text: S.messaging.testOkAs("@penguin_bot", 12) },
      { tone: "info", text: S.messaging.testPrivacyOn },
    ]);
  });

  it("says nothing extra when privacy is off, or when getMe never reported it", () => {
    expect(telegramTestNotices({ ok: true, latencyMs: 12, groupPrivacy: false })).toEqual([
      { tone: "success", text: S.messaging.testOk(12) },
    ]);
    // Absent is unknown, and unknown is not a problem: a notice on a field the API never
    // sent would send a user to @BotFather for nothing.
    expect(telegramTestNotices({ ok: true, latencyMs: 12 })).toEqual([
      { tone: "success", text: S.messaging.testOk(12) },
    ]);
  });

  it("reports a failed test as one error line and nothing else", () => {
    expect(telegramTestNotices({ ok: false, error: "Unauthorized", groupPrivacy: true })).toEqual([
      { tone: "error", text: S.messaging.testFail("Unauthorized") },
    ]);
  });

  it("is shown by testConnection, one toast per notice, each in its own tone", () => {
    // The hook itself is out of reach from a node-only suite (`environment: "node"`, no
    // jsdom), and dropping the info branch would silently lose the only line that reports
    // Group Privacy — so the dispatch is pinned here (account-menu.test.ts convention).
    const src = readFileSync(
      fileURLToPath(
        new URL("../src/features/messaging/messaging-binding-editor.tsx", import.meta.url),
      ),
      "utf8",
    );
    const loop = /for \(const notice of telegramTestNotices\(res\)\) \{[\s\S]*?\n {8}\}/.exec(src);
    expect(
      loop,
      "testConnection should show every notice telegramTestNotices returns",
    ).not.toBeNull();
    expect(loop![0]).toContain("toastError(notice.text)");
    expect(loop![0]).toContain("toastInfo(notice.text)");
    expect(loop![0]).toContain("toastSuccess(notice.text)");
  });
});
