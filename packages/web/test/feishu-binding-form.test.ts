/**
 * feishu-binding-form.ts unit tests: the form ↔ DTO conversion behind the binding dialog.
 * The load-bearing rule is the secret round-trip — the field always loads empty, an empty
 * submit keeps the stored secret (the PUT body omits it), and only a first bind requires
 * one — plus the blank-domain-means-default fallback.
 */
import { describe, expect, it } from "vitest";
import type { FeishuBindingInfo } from "@prismshadow/penguin-server/api";
import {
  FEISHU_DEFAULT_DOMAIN,
  bindingToForm,
  emptyFeishuForm,
  formToPut,
  formToTest,
} from "../src/features/chat/feishu-binding-form";

const STORED: FeishuBindingInfo = {
  sessionId: "session-1",
  appId: "cli_abc",
  appSecretMasked: "abcd…wxyz",
  baseDomain: "https://open.larksuite.com",
  lastChatKnown: true,
  createdAt: "2026-08-25T00:00:00.000Z",
  updatedAt: "2026-08-25T00:00:00.000Z",
};

describe("emptyFeishuForm / bindingToForm", () => {
  it("starts new forms on the default domain, and never loads a secret back", () => {
    expect(emptyFeishuForm()).toEqual({
      appId: "",
      appSecret: "",
      baseDomain: FEISHU_DEFAULT_DOMAIN,
    });
    // The masked value must not land in the editable field — an unedited save would
    // otherwise overwrite the real secret with its mask.
    expect(bindingToForm(STORED)).toEqual({
      appId: "cli_abc",
      appSecret: "",
      baseDomain: "https://open.larksuite.com",
    });
  });
});

describe("formToPut", () => {
  it("omits a blank secret so the server keeps the stored one", () => {
    const res = formToPut(bindingToForm(STORED), true);
    expect(res).toEqual({
      ok: true,
      body: { appId: "cli_abc", baseDomain: "https://open.larksuite.com" },
    });
  });

  it("carries a typed secret, trimmed", () => {
    const res = formToPut({ ...bindingToForm(STORED), appSecret: "  new-secret  " }, true);
    expect(res.ok && res.body.appSecret).toBe("new-secret");
  });

  it("requires appId always, and a secret only on a first bind", () => {
    const blank = formToPut({ ...emptyFeishuForm() }, false);
    expect(blank).toEqual({ ok: false, errors: { appId: "required", appSecret: "required" } });
    // The same empty secret is fine once one is stored.
    const rebind = formToPut({ ...emptyFeishuForm(), appId: "cli_x" }, true);
    expect(rebind.ok).toBe(true);
  });

  it("defaults a blank domain and rejects a non-http(s) one", () => {
    const blankDomain = formToPut({ appId: "cli_x", appSecret: "s", baseDomain: "   " }, false);
    expect(blankDomain.ok && blankDomain.body.baseDomain).toBe(FEISHU_DEFAULT_DOMAIN);
    const bad = formToPut({ appId: "cli_x", appSecret: "s", baseDomain: "open.feishu.cn" }, false);
    expect(bad).toEqual({ ok: false, errors: { baseDomain: "url_invalid" } });
    const ftp = formToPut(
      { appId: "cli_x", appSecret: "s", baseDomain: "ftp://open.feishu.cn" },
      false,
    );
    expect(ftp.ok).toBe(false);
  });
});

describe("formToTest", () => {
  it("carries only the filled-in fields, so blanks fall back to the stored binding server-side", () => {
    expect(formToTest({ appId: "", appSecret: "", baseDomain: "" })).toEqual({});
    expect(
      formToTest({ appId: " cli_x ", appSecret: "s", baseDomain: FEISHU_DEFAULT_DOMAIN }),
    ).toEqual({ appId: "cli_x", appSecret: "s", baseDomain: FEISHU_DEFAULT_DOMAIN });
  });
});
