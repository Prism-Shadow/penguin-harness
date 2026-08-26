/**
 * messaging-binding-form.ts unit tests: the channel-aware form ↔ DTO conversion behind
 * the binding editor. The load-bearing rules are the secret round-trip — secret fields
 * always load empty, an empty submit keeps the stored secret (the PUT body omits it), and
 * only a first bind requires one — the models-idiom clear checkbox (applied on save, a
 * typed secret wins over it), the per-channel submit routing (only the selected channel's
 * fields are validated and sent), and the blank-domain-means-default fallback.
 */
import { describe, expect, it } from "vitest";
import type { FeishuBindingInfo, TelegramBindingInfo } from "@prismshadow/penguin-server/api";
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
  lastChatKnown: false,
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
};

describe("emptyMessagingForm / bindingsToForm", () => {
  it("starts empty forms on Feishu with the default domain, both channels blank", () => {
    expect(emptyMessagingForm()).toEqual({
      channel: "feishu",
      feishu: { appId: "", appSecret: "", baseDomain: FEISHU_DEFAULT_DOMAIN, clearSecret: false },
      telegram: { botToken: "", clearToken: false },
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
      },
      telegram: { botToken: "", clearToken: false },
    });
    // No enabled channel: the first saved one is selected; nothing saved: Feishu.
    expect(bindingsToForm([STORED_FEISHU]).channel).toBe("feishu");
    expect(bindingsToForm([]).channel).toBe("feishu");
  });
});

describe("formToPut (feishu)", () => {
  it("omits a blank secret so the server keeps the stored one", () => {
    const res = formToPut(bindingsToForm([STORED_FEISHU]), true);
    expect(res).toEqual({
      ok: true,
      channel: "feishu",
      body: { appId: "cli_abc", baseDomain: "https://open.larksuite.com" },
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
      body: { appId: "cli_abc", clearAppSecret: true, baseDomain: "https://open.larksuite.com" },
    });
    // The models idiom: a typed replacement wins over a stale checked box.
    clearing.feishu.appSecret = "replacement-secret";
    const typed = formToPut(clearing, true);
    expect(typed.ok && typed.channel === "feishu" && typed.body).toEqual({
      appId: "cli_abc",
      appSecret: "replacement-secret",
      baseDomain: "https://open.larksuite.com",
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
    form.feishu = { appId: "cli_x", appSecret: "s", baseDomain: "   ", clearSecret: false };
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
      body: { botToken: "7000000001:secret-token-AAAA" },
    });
    // With a stored token an empty field means "keep it": the body omits the token.
    form.telegram.botToken = "";
    expect(formToPut(form, true)).toEqual({ ok: true, channel: "telegram", body: {} });
    // A first bind must carry one.
    expect(formToPut(form, false)).toEqual({ ok: false, errors: { botToken: "required" } });
  });

  it("maps the checked clear box to clearBotToken, with a typed token winning over it", () => {
    const form = emptyMessagingForm("telegram");
    form.telegram.clearToken = true;
    expect(formToPut(form, true)).toEqual({
      ok: true,
      channel: "telegram",
      body: { clearBotToken: true },
    });
    form.telegram.botToken = "7000000001:replacement-token";
    const typed = formToPut(form, true);
    expect(typed.ok && typed.channel === "telegram" && typed.body).toEqual({
      botToken: "7000000001:replacement-token",
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
    };
    feishuSide.telegram.botToken = "garbage";
    expect(formToPut(feishuSide, false).ok).toBe(true);
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
