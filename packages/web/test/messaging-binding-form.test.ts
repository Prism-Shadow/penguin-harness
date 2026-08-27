/**
 * messaging-binding-form.ts unit tests: the channel-aware form ↔ DTO conversion behind
 * the binding editor. The load-bearing rules are the secret round-trip — secret fields
 * always load empty, an empty submit keeps the stored secret (the PUT body omits it), and
 * only a first bind requires one — the models-idiom clear checkbox (applied on save, a
 * typed secret wins over it), the per-channel submit routing (only the selected channel's
 * fields are validated and sent), the blank-domain-means-default fallback, and the two saved
 * fields that are not credentials — `linePerMessage` and `finalReplyOnly`, which load per
 * channel and are always sent (an omitted flag would mean "keep", leaving no way to turn either
 * option back off).
 */
import { describe, expect, it } from "vitest";
import type {
  FeishuBindingInfo,
  QQBindingInfo,
  TelegramBindingInfo,
} from "@prismshadow/penguin-server/api";
import {
  FEISHU_DEFAULT_DOMAIN,
  bindingsToForm,
  emptyMessagingForm,
  formDirty,
  formTestable,
  formToPut,
  formToTest,
} from "../src/features/messaging/messaging-binding-form";

const STORED_FEISHU: FeishuBindingInfo = {
  channel: "feishu",
  sessionId: "session-1",
  appId: "cli_abc",
  appSecretMasked: "abcd…wxyz",
  baseDomain: "https://open.larksuite.com",
  enabled: false,
  linePerMessage: false,
  finalReplyOnly: false,
  lastChatKnown: true,
  createdAt: "2026-08-25T00:00:00.000Z",
  updatedAt: "2026-08-25T00:00:00.000Z",
};

const STORED_TELEGRAM: TelegramBindingInfo = {
  channel: "telegram",
  sessionId: "session-1",
  botId: "7000000001",
  botTokenMasked: "7000…1111",
  enabled: true,
  // Set on one fixture only, so a per-channel load cannot pass by copying the other channel.
  linePerMessage: true,
  finalReplyOnly: false,
  lastChatKnown: false,
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
};

const STORED_QQ: QQBindingInfo = {
  channel: "qq",
  sessionId: "session-1",
  appId: "102000001",
  appSecretMasked: "qq-a…1234",
  enabled: false,
  linePerMessage: false,
  // The other flag, set on a different fixture: neither can pass by riding the other.
  finalReplyOnly: true,
  lastChatKnown: true,
  createdAt: "2026-08-27T00:00:00.000Z",
  updatedAt: "2026-08-27T00:00:00.000Z",
};

describe("emptyMessagingForm / bindingsToForm", () => {
  it("starts empty forms on Feishu with the default domain, both channels blank", () => {
    expect(emptyMessagingForm()).toEqual({
      channel: "feishu",
      feishu: {
        appId: "",
        appSecret: "",
        baseDomain: FEISHU_DEFAULT_DOMAIN,
        clearSecret: false,
        linePerMessage: false,
        finalReplyOnly: false,
      },
      telegram: { botToken: "", clearToken: false, linePerMessage: false, finalReplyOnly: false },
      qq: {
        appId: "",
        appSecret: "",
        clearSecret: false,
        linePerMessage: false,
        finalReplyOnly: false,
      },
    });
  });

  it("loads every saved config's non-secret fields, selects the enabled channel, and never loads a secret back", () => {
    // The masked value must not land in an editable field — an unedited save would
    // otherwise overwrite the real secret with its mask.
    const both = bindingsToForm([STORED_FEISHU, STORED_TELEGRAM]);
    expect(both).toEqual({
      channel: "telegram", // the enabled one wins the initial selection
      feishu: {
        appId: "cli_abc",
        appSecret: "",
        baseDomain: "https://open.larksuite.com",
        clearSecret: false,
        linePerMessage: false,
        finalReplyOnly: false,
      },
      // Each channel's delivery preferences come from its own stored config.
      telegram: { botToken: "", clearToken: false, linePerMessage: true, finalReplyOnly: false },
      // An unsaved channel keeps its empty sub-state, so switching to it shows a blank form.
      qq: {
        appId: "",
        appSecret: "",
        clearSecret: false,
        linePerMessage: false,
        finalReplyOnly: false,
      },
    });
    // All three coexist: every saved channel loads its own non-secret fields.
    const all = bindingsToForm([STORED_FEISHU, STORED_TELEGRAM, STORED_QQ]);
    expect(all.feishu.appId).toBe("cli_abc");
    expect(all.qq.appId).toBe("102000001");
    expect(all.qq.appSecret).toBe("");
    // Each flag loads from the channel that stored it, and from nowhere else.
    expect(all.qq.finalReplyOnly).toBe(true);
    expect(all.telegram.finalReplyOnly).toBe(false);
    expect(all.feishu.linePerMessage).toBe(false);
    // No enabled channel: the first saved one is selected; nothing saved: Feishu.
    expect(bindingsToForm([STORED_FEISHU]).channel).toBe("feishu");
    expect(bindingsToForm([STORED_QQ]).channel).toBe("qq");
    expect(bindingsToForm([]).channel).toBe("feishu");
  });
});

describe("formToPut (feishu)", () => {
  it("omits a blank secret so the server keeps the stored one", () => {
    const res = formToPut(bindingsToForm([STORED_FEISHU]), true);
    expect(res).toEqual({
      ok: true,
      channel: "feishu",
      body: {
        appId: "cli_abc",
        baseDomain: "https://open.larksuite.com",
        linePerMessage: false,
        finalReplyOnly: false,
      },
    });
  });

  it("carries a typed secret, trimmed", () => {
    const form = bindingsToForm([STORED_FEISHU]);
    form.feishu.appSecret = "  new-secret  ";
    const res = formToPut(form, true);
    expect(res.ok && res.channel === "feishu" && res.body.appSecret).toBe("new-secret");
  });

  it("requires appId always, and a secret only on a first bind", () => {
    const blank = formToPut(emptyMessagingForm(), false);
    expect(blank).toEqual({ ok: false, errors: { appId: "required", appSecret: "required" } });
    // The same empty secret is fine once one is stored.
    const rebind = emptyMessagingForm();
    rebind.feishu.appId = "cli_x";
    expect(formToPut(rebind, true).ok).toBe(true);
  });

  it("maps the checked clear box to clearAppSecret, with a typed secret winning over it", () => {
    const clearing = bindingsToForm([STORED_FEISHU]);
    clearing.feishu.clearSecret = true;
    expect(formToPut(clearing, true)).toEqual({
      ok: true,
      channel: "feishu",
      body: {
        appId: "cli_abc",
        clearAppSecret: true,
        baseDomain: "https://open.larksuite.com",
        linePerMessage: false,
        finalReplyOnly: false,
      },
    });
    // The models idiom: a typed replacement wins over a stale checked box.
    clearing.feishu.appSecret = "replacement-secret";
    const typed = formToPut(clearing, true);
    expect(typed.ok && typed.channel === "feishu" && typed.body).toEqual({
      appId: "cli_abc",
      appSecret: "replacement-secret",
      baseDomain: "https://open.larksuite.com",
      linePerMessage: false,
      finalReplyOnly: false,
    });
    // Without a stored secret there is nothing to clear: the flag never reaches the body.
    const nothingStored = emptyMessagingForm();
    nothingStored.feishu.appId = "cli_x";
    nothingStored.feishu.clearSecret = true;
    expect(formToPut(nothingStored, false)).toEqual({
      ok: false,
      errors: { appSecret: "required" },
    });
  });

  it("defaults a blank domain and rejects a non-http(s) one", () => {
    const form = emptyMessagingForm();
    form.feishu = {
      appId: "cli_x",
      appSecret: "s",
      baseDomain: "   ",
      clearSecret: false,
      linePerMessage: false,
      finalReplyOnly: false,
    };
    const blankDomain = formToPut(form, false);
    expect(blankDomain.ok && blankDomain.channel === "feishu" && blankDomain.body.baseDomain).toBe(
      FEISHU_DEFAULT_DOMAIN,
    );
    form.feishu.baseDomain = "open.feishu.cn";
    expect(formToPut(form, false)).toEqual({ ok: false, errors: { baseDomain: "url_invalid" } });
    form.feishu.baseDomain = "ftp://open.feishu.cn";
    expect(formToPut(form, false).ok).toBe(false);
  });
});

describe("formToPut (telegram)", () => {
  it("submits only the token, trimmed; blank keeps the stored one", () => {
    const form = emptyMessagingForm("telegram");
    form.telegram.botToken = "  7000000001:secret-token-AAAA  ";
    expect(formToPut(form, false)).toEqual({
      ok: true,
      channel: "telegram",
      body: {
        botToken: "7000000001:secret-token-AAAA",
        linePerMessage: false,
        finalReplyOnly: false,
      },
    });
    // With a stored token an empty field means "keep it": the body omits the token — but not
    // the delivery flag, which is a plain field and always carries its current value.
    form.telegram.botToken = "";
    expect(formToPut(form, true)).toEqual({
      ok: true,
      channel: "telegram",
      body: { linePerMessage: false, finalReplyOnly: false },
    });
    // A first bind must carry one.
    expect(formToPut(form, false)).toEqual({ ok: false, errors: { botToken: "required" } });
  });

  it("maps the checked clear box to clearBotToken, with a typed token winning over it", () => {
    const form = emptyMessagingForm("telegram");
    form.telegram.clearToken = true;
    expect(formToPut(form, true)).toEqual({
      ok: true,
      channel: "telegram",
      body: { clearBotToken: true, linePerMessage: false, finalReplyOnly: false },
    });
    form.telegram.botToken = "7000000001:replacement-token";
    const typed = formToPut(form, true);
    expect(typed.ok && typed.channel === "telegram" && typed.body).toEqual({
      botToken: "7000000001:replacement-token",
      linePerMessage: false,
      finalReplyOnly: false,
    });
  });

  it("rejects a token whose bot id cannot be read (the server's identity rule, mirrored)", () => {
    const form = emptyMessagingForm("telegram");
    form.telegram.botToken = "not-a-token";
    expect(formToPut(form, false)).toEqual({ ok: false, errors: { botToken: "token_invalid" } });
    form.telegram.botToken = "abc:def-ghi-jkl";
    expect(formToPut(form, true).ok).toBe(false);
  });

  it("never validates the unselected channel's fields", () => {
    // A blank Feishu form must not block a Telegram submit, and vice versa.
    const form = emptyMessagingForm("telegram");
    form.telegram.botToken = "7000000001:secret-token-AAAA";
    expect(formToPut(form, false).ok).toBe(true);
    const feishuSide = emptyMessagingForm("feishu");
    feishuSide.feishu = {
      appId: "cli_x",
      appSecret: "s",
      baseDomain: FEISHU_DEFAULT_DOMAIN,
      clearSecret: false,
      linePerMessage: false,
      finalReplyOnly: false,
    };
    feishuSide.telegram.botToken = "garbage";
    expect(formToPut(feishuSide, false).ok).toBe(true);
  });
});

describe("the delivery flags", () => {
  it("sends both on every channel, whatever their values, so either can be turned back off", () => {
    // The rule that makes them work at all: an omitted flag means "keep the stored value",
    // so a body that drops the ones currently off can never turn an option off again.
    for (const [form, channel] of [
      [emptyMessagingForm("feishu"), "feishu"],
      [emptyMessagingForm("telegram"), "telegram"],
      [emptyMessagingForm("qq"), "qq"],
    ] as const) {
      form.feishu.appId = "cli_x";
      form.qq.appId = "102000001";
      form.telegram.botToken = "7000000001:secret-token-AAAA";
      for (const values of [
        { linePerMessage: false, finalReplyOnly: false },
        { linePerMessage: true, finalReplyOnly: false },
        { linePerMessage: false, finalReplyOnly: true },
        { linePerMessage: true, finalReplyOnly: true },
      ]) {
        Object.assign(form[channel], values);
        const res = formToPut(form, true);
        expect(res.ok).toBe(true);
        expect(res.ok && res.body.linePerMessage).toBe(values.linePerMessage);
        expect(res.ok && res.body.finalReplyOnly).toBe(values.finalReplyOnly);
      }
    }
  });
});

describe("formToTest", () => {
  it("carries only the selected channel's filled-in fields, so blanks fall back to the stored binding server-side", () => {
    // The fresh form prefills the default domain, and a prefilled value is a filled value.
    expect(formToTest(emptyMessagingForm())).toEqual({
      channel: "feishu",
      body: { baseDomain: FEISHU_DEFAULT_DOMAIN },
    });
    const blanked = emptyMessagingForm();
    blanked.feishu.baseDomain = "";
    expect(formToTest(blanked)).toEqual({ channel: "feishu", body: {} });
    const feishu = emptyMessagingForm();
    feishu.feishu = {
      appId: " cli_x ",
      appSecret: "s",
      baseDomain: FEISHU_DEFAULT_DOMAIN,
      clearSecret: false,
      linePerMessage: false,
      finalReplyOnly: false,
    };
    expect(formToTest(feishu)).toEqual({
      channel: "feishu",
      body: { appId: "cli_x", appSecret: "s", baseDomain: FEISHU_DEFAULT_DOMAIN },
    });
    const telegram = emptyMessagingForm("telegram");
    expect(formToTest(telegram)).toEqual({ channel: "telegram", body: {} });
    telegram.telegram.botToken = " 7000000001:tok-en-AAAA ";
    expect(formToTest(telegram)).toEqual({
      channel: "telegram",
      body: { botToken: "7000000001:tok-en-AAAA" },
    });
  });
});

describe("formDirty / formTestable", () => {
  it("marks the selected channel dirty on any field change; a typed secret and a checked clear box count", () => {
    const baseline = bindingsToForm([STORED_FEISHU]);
    expect(formDirty(bindingsToForm([STORED_FEISHU]), baseline)).toBe(false);
    const edited = bindingsToForm([STORED_FEISHU]);
    edited.feishu.appId = "cli_other";
    expect(formDirty(edited, baseline)).toBe(true);
    const secret = bindingsToForm([STORED_FEISHU]);
    secret.feishu.appSecret = "typed";
    expect(formDirty(secret, baseline)).toBe(true);
    const clearing = bindingsToForm([STORED_FEISHU]);
    clearing.feishu.clearSecret = true;
    expect(formDirty(clearing, baseline)).toBe(true);
    // Telegram: the token field always loads empty, so typed-token / checked-clear are the dirty signals.
    const tgBaseline = bindingsToForm([STORED_TELEGRAM]);
    const tg = bindingsToForm([STORED_TELEGRAM]);
    expect(formDirty(tg, tgBaseline)).toBe(false);
    tg.telegram.botToken = "7000000001:new";
    expect(formDirty(tg, tgBaseline)).toBe(true);
    tg.telegram.botToken = "";
    tg.telegram.clearToken = true;
    expect(formDirty(tg, tgBaseline)).toBe(true);
  });

  it("counts either delivery flag as an edit on every channel", () => {
    // Telegram is the one that would silently break: without these fields its only dirty
    // signals are the token and the clear box, so flipping a switch would leave Save disabled.
    const tgBaseline = bindingsToForm([STORED_TELEGRAM]);
    const tg = bindingsToForm([STORED_TELEGRAM]);
    tg.telegram.linePerMessage = !tg.telegram.linePerMessage;
    expect(formDirty(tg, tgBaseline)).toBe(true);
    const tgFinal = bindingsToForm([STORED_TELEGRAM]);
    tgFinal.telegram.finalReplyOnly = true;
    expect(formDirty(tgFinal, tgBaseline)).toBe(true);
    const baseline = bindingsToForm([STORED_FEISHU]);
    const feishu = bindingsToForm([STORED_FEISHU]);
    feishu.feishu.linePerMessage = true;
    expect(formDirty(feishu, baseline)).toBe(true);
    const feishuFinal = bindingsToForm([STORED_FEISHU]);
    feishuFinal.feishu.finalReplyOnly = true;
    expect(formDirty(feishuFinal, baseline)).toBe(true);
    // The unselected channel's flags are not the selected channel's business.
    const otherChannel = bindingsToForm([STORED_FEISHU]);
    otherChannel.telegram.linePerMessage = true;
    otherChannel.telegram.finalReplyOnly = true;
    expect(formDirty(otherChannel, baseline)).toBe(false);
  });

  it("allows the probe when the selected channel has a testable draft or a stored secret", () => {
    // Feishu drafts need both halves of the credential pair.
    expect(formTestable(emptyMessagingForm(), false)).toBe(false);
    const half = emptyMessagingForm();
    half.feishu.appId = "cli_x";
    expect(formTestable(half, false)).toBe(false);
    half.feishu.appSecret = "s";
    expect(formTestable(half, false)).toBe(true);
    // A stored secret makes the stored config testable without retyping anything.
    expect(formTestable(emptyMessagingForm(), true)).toBe(true);
    // Telegram: the token is the whole credential.
    expect(formTestable(emptyMessagingForm("telegram"), false)).toBe(false);
    expect(formTestable(emptyMessagingForm("telegram"), true)).toBe(true);
    const typed = emptyMessagingForm("telegram");
    typed.telegram.botToken = "7000000001:tok";
    expect(formTestable(typed, false)).toBe(true);
  });
});

describe("the QQ channel", () => {
  it("loads its non-secret field and leaves the secret empty, like the other channels", () => {
    const form = bindingsToForm([STORED_QQ]);
    // The selector lands on the only saved channel; the App ID loads, the secret never does.
    expect(form.channel).toBe("qq");
    expect(form.qq.appId).toBe("102000001");
    expect(form.qq.appSecret).toBe("");
    expect(form.qq.clearSecret).toBe(false);
    // Both delivery preferences load from the stored config, each on its own.
    expect(form.qq.finalReplyOnly).toBe(true);
    expect(form.qq.linePerMessage).toBe(false);
  });

  it("submits the pair, omits a blank secret, and always sends the delivery flag", () => {
    const form = bindingsToForm([STORED_QQ]);
    const kept = formToPut(form, true);
    expect(kept).toEqual({
      ok: true,
      channel: "qq",
      // No `appSecret` key at all: an omitted secret is what tells the server to keep the
      // stored one, and the masked value must never round-trip.
      body: { appId: "102000001", linePerMessage: false, finalReplyOnly: true },
    });

    form.qq.appSecret = "  fresh-secret  ";
    expect(formToPut(form, true)).toEqual({
      ok: true,
      channel: "qq",
      body: {
        appId: "102000001",
        appSecret: "fresh-secret",
        linePerMessage: false,
        finalReplyOnly: true,
      },
    });
  });

  it("requires both halves on a first bind and honours the clear checkbox after one", () => {
    const fresh = emptyMessagingForm("qq");
    expect(formToPut(fresh, false)).toEqual({
      ok: false,
      errors: { appId: "required", appSecret: "required" },
    });

    const stored = bindingsToForm([STORED_QQ]);
    stored.qq.clearSecret = true;
    expect(formToPut(stored, true)).toEqual({
      ok: true,
      channel: "qq",
      body: {
        appId: "102000001",
        clearAppSecret: true,
        linePerMessage: false,
        finalReplyOnly: true,
      },
    });
    // A typed secret wins over a stale clear checkbox (the models idiom).
    stored.qq.appSecret = "typed";
    expect(formToPut(stored, true)).toEqual({
      ok: true,
      channel: "qq",
      body: {
        appId: "102000001",
        appSecret: "typed",
        linePerMessage: false,
        finalReplyOnly: true,
      },
    });
  });

  it("routes its probe and its dirty/testable checks to its own fields", () => {
    const form = bindingsToForm([STORED_QQ]);
    expect(formToTest(form)).toEqual({ channel: "qq", body: { appId: "102000001" } });

    const baseline = bindingsToForm([STORED_QQ]);
    expect(formDirty(form, baseline)).toBe(false);
    form.qq.linePerMessage = true;
    expect(formDirty(form, baseline)).toBe(true);
    const qqFinal = bindingsToForm([STORED_QQ]);
    qqFinal.qq.finalReplyOnly = !qqFinal.qq.finalReplyOnly;
    expect(formDirty(qqFinal, baseline)).toBe(true);

    // A stored secret is testable as-is; a draft needs both halves.
    expect(formTestable(emptyMessagingForm("qq"), true)).toBe(true);
    const half = emptyMessagingForm("qq");
    half.qq.appId = "102000001";
    expect(formTestable(half, false)).toBe(false);
    half.qq.appSecret = "s";
    expect(formTestable(half, false)).toBe(true);
  });
});
