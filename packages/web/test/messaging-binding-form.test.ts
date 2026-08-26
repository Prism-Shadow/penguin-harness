/**
 * messaging-binding-form.ts unit tests: the channel-aware form ↔ DTO conversion behind
 * the binding editor. The load-bearing rules are the secret round-trip — secret fields
 * always load empty, an empty submit keeps the stored secret (the PUT body omits it), and
 * only a first bind requires one — the per-channel submit routing (only the selected
 * channel's fields are validated and sent), and the blank-domain-means-default fallback.
 */
import { describe, expect, it } from "vitest";
import type { FeishuBindingInfo, TelegramBindingInfo } from "@prismshadow/penguin-server/api";
import {
  FEISHU_DEFAULT_DOMAIN,
  bindingToForm,
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
  enabled: false,
  lastChatKnown: false,
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
};

describe("emptyMessagingForm / bindingToForm", () => {
  it("starts new forms on Feishu with the default domain, both channels blank", () => {
    expect(emptyMessagingForm()).toEqual({
      channel: "feishu",
      feishu: { appId: "", appSecret: "", baseDomain: FEISHU_DEFAULT_DOMAIN },
      telegram: { botToken: "" },
    });
  });

  it("loads the stored binding's channel and fields, and never loads a secret back", () => {
    // The masked value must not land in an editable field — an unedited save would
    // otherwise overwrite the real secret with its mask.
    expect(bindingToForm(STORED_FEISHU)).toEqual({
      channel: "feishu",
      feishu: { appId: "cli_abc", appSecret: "", baseDomain: "https://open.larksuite.com" },
      telegram: { botToken: "" },
    });
    const telegram = bindingToForm(STORED_TELEGRAM);
    expect(telegram.channel).toBe("telegram");
    expect(telegram.telegram.botToken).toBe("");
  });
});

describe("formToPut (feishu)", () => {
  it("omits a blank secret so the server keeps the stored one", () => {
    const res = formToPut(bindingToForm(STORED_FEISHU), true);
    expect(res).toEqual({
      ok: true,
      channel: "feishu",
      body: { appId: "cli_abc", baseDomain: "https://open.larksuite.com" },
    });
  });

  it("carries a typed secret, trimmed", () => {
    const form = bindingToForm(STORED_FEISHU);
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

  it("defaults a blank domain and rejects a non-http(s) one", () => {
    const form = emptyMessagingForm();
    form.feishu = { appId: "cli_x", appSecret: "s", baseDomain: "   " };
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
    feishuSide.feishu = { appId: "cli_x", appSecret: "s", baseDomain: FEISHU_DEFAULT_DOMAIN };
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
    feishu.feishu = { appId: " cli_x ", appSecret: "s", baseDomain: FEISHU_DEFAULT_DOMAIN };
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
  it("marks the selected channel dirty on any field change; a typed secret always counts", () => {
    const baseline = bindingToForm(STORED_FEISHU);
    expect(formDirty(bindingToForm(STORED_FEISHU), baseline)).toBe(false);
    const edited = bindingToForm(STORED_FEISHU);
    edited.feishu.appId = "cli_other";
    expect(formDirty(edited, baseline)).toBe(true);
    const secret = bindingToForm(STORED_FEISHU);
    secret.feishu.appSecret = "typed";
    expect(formDirty(secret, baseline)).toBe(true);
    // Telegram: the token field always loads empty, so typed-token is the one dirty signal.
    const tg = bindingToForm(STORED_TELEGRAM);
    expect(formDirty(tg, bindingToForm(STORED_TELEGRAM))).toBe(false);
    tg.telegram.botToken = "7000000001:new";
    expect(formDirty(tg, bindingToForm(STORED_TELEGRAM))).toBe(true);
  });

  it("allows the probe when the selected channel has a draft identity or its own stored binding", () => {
    expect(formTestable(emptyMessagingForm(), null)).toBe(false);
    expect(formTestable(emptyMessagingForm(), "feishu")).toBe(true);
    // A stored FEISHU binding does not make the TELEGRAM side testable.
    expect(formTestable(emptyMessagingForm("telegram"), "feishu")).toBe(false);
    expect(formTestable(emptyMessagingForm("telegram"), "telegram")).toBe(true);
    const typed = emptyMessagingForm("telegram");
    typed.telegram.botToken = "7000000001:tok";
    expect(formTestable(typed, null)).toBe(true);
  });
});
