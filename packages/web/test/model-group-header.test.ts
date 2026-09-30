/**
 * A provider group's header on the models page (group-header.ts): which actions each kind of
 * group offers, in the order they stand, and the connection status of a group whose key comes
 * from an authorization flow.
 *
 * The matrix, per group kind: the balance where the catalog declares one (TokenDance, DeepSeek)
 * and the group holds a key; Connect with its status on the three groups with a flow; Enter key
 * everywhere but custom; the speed test everywhere; Add model only where hand-added models are
 * taken (custom, vLLM, user-defined); Delete group only on a user-defined group. A member keeps
 * the two read-only parts and nothing that writes. A divider follows the balance wherever
 * something comes after it.
 */
import { describe, expect, it } from "vitest";
import { MODEL_PROVIDERS, providerInfo } from "@prismshadow/penguin-core/model-catalog";
import type { ModelProviderInfo } from "@prismshadow/penguin-core/model-catalog";
import {
  connectionStatus,
  dividerAfterBalance,
  groupHeaderActions,
  groupKeyFromEnv,
  groupKeyStored,
  hasConnectFlow,
} from "../src/features/models/group-header";
import { userProviderInfo } from "../src/features/models/model-grouping";

const group = (id: string): ModelProviderInfo => providerInfo(id) ?? userProviderInfo(id);
const owner = (id: string, keyStored = false, balancePinned = false) =>
  groupHeaderActions(group(id), { isOwner: true, keyStored, balancePinned });
const member = (id: string, keyStored = false, balancePinned = false) =>
  groupHeaderActions(group(id), { isOwner: false, keyStored, balancePinned });

const keyed = [{ credential: { apiKeyMasked: "sk-t…1234" } }, {}];
const keyless = [{}, { credential: {} }];

describe("the group header's actions, in order, by group kind", () => {
  it("TokenDance: balance once a key is stored, Connect, Enter key, speed test — no Add model", () => {
    expect(owner("tokendance", true)).toEqual(["balance", "connect", "groupKey", "speedTest"]);
    // Without a key there is nothing to ask the vendor with.
    expect(owner("tokendance", false)).toEqual(["connect", "groupKey", "speedTest"]);
  });

  it("Penguin Go and ModelScope connect; a connected Penguin Go also syncs its catalog", () => {
    expect(owner("penguin-go", false)).toEqual(["connect", "groupKey", "speedTest"]);
    expect(owner("penguin-go", true)).toEqual(["connect", "platformSync", "groupKey", "speedTest"]);
    expect(owner("modelscope", true)).toEqual(["connect", "groupKey", "speedTest"]);
  });

  it("DeepSeek shows its balance and connects nowhere; the other vendors and gateways key and test only", () => {
    expect(owner("deepseek", true)).toEqual(["balance", "groupKey", "speedTest"]);
    for (const id of [
      "openrouter",
      "siliconflow",
      "opencode-go",
      "anthropic",
      "openai",
      "google",
    ]) {
      expect(owner(id, true), id).toEqual(["groupKey", "speedTest"]);
    }
  });

  it("vLLM, custom and user-defined groups take hand-added models; only a user-defined group deletes", () => {
    expect(owner("vllm")).toEqual(["groupKey", "speedTest", "addModel"]);
    // Custom's rows each reach their own endpoint: no key written across them.
    expect(owner("custom")).toEqual(["speedTest", "addModel"]);
    expect(owner("my-own-group")).toEqual(["groupKey", "speedTest", "addModel", "deleteGroup"]);
  });

  it("Add model appears on no built-in group but custom and vLLM", () => {
    const adding = MODEL_PROVIDERS.filter((p) => owner(p.id, true).includes("addModel")).map(
      (p) => p.id,
    );
    expect(adding.sort()).toEqual(["custom", "vllm"]);
  });

  it("a member keeps the balance and the connection status, and nothing that writes", () => {
    expect(member("tokendance", true)).toEqual(["balance", "connect"]);
    expect(member("deepseek", true)).toEqual(["balance"]);
    expect(member("vllm")).toEqual([]);
    expect(member("my-own-group")).toEqual([]);
  });

  it("a pinned balance stays in its header after the key is gone, so the pin can come off there", () => {
    expect(owner("deepseek", false, true)).toEqual(["balance", "groupKey", "speedTest"]);
    // Only where the catalog declares a balance at all.
    expect(owner("openrouter", false, true)).toEqual(["groupKey", "speedTest"]);
  });
});

describe("a key lent by the server's environment", () => {
  it("shows DeepSeek's balance, as a stored key does", () => {
    const facts = { isOwner: true, keyStored: false, keyFromEnv: true, balancePinned: false };
    expect(groupHeaderActions(group("deepseek"), facts)).toEqual([
      "balance",
      "groupKey",
      "speedTest",
    ]);
    expect(groupHeaderActions(group("deepseek"), { ...facts, isOwner: false })).toEqual([
      "balance",
    ]);
  });

  it("is read off the rows' masked preview, and does not make a group connected", () => {
    const envRows = [{ envKeyMasked: "sk-d…0003" }, {}];
    expect(groupKeyFromEnv(envRows)).toBe(true);
    expect(groupKeyFromEnv(keyed)).toBe(false);
    expect(groupKeyFromEnv([])).toBe(false);
    expect(connectionStatus(group("tokendance"), envRows)).toBe("notConnected");
  });
});

describe("the connection status beside Connect", () => {
  it("is exactly the three groups with an authorization flow", () => {
    const connecting = MODEL_PROVIDERS.filter(hasConnectFlow).map((p) => p.id);
    expect(connecting).toEqual(["tokendance", "penguin-go", "modelscope"]);
  });

  it("reads connected once any row holds a stored key, however it got there", () => {
    expect(groupKeyStored(keyed)).toBe(true);
    expect(groupKeyStored(keyless)).toBe(false);
    expect(groupKeyStored([])).toBe(false);
    expect(connectionStatus(group("tokendance"), keyed)).toBe("connected");
    expect(connectionStatus(group("penguin-go"), keyless)).toBe("notConnected");
    expect(connectionStatus(group("modelscope"), [])).toBe("notConnected");
  });

  it("is absent on a group that does not connect", () => {
    expect(connectionStatus(group("deepseek"), keyed)).toBeNull();
    expect(connectionStatus(group("my-own-group"), keyed)).toBeNull();
  });
});

describe("the divider after the balance", () => {
  it("stands between the balance and whatever follows it", () => {
    expect(dividerAfterBalance(owner("tokendance", true))).toBe(true);
    expect(dividerAfterBalance(owner("deepseek", true))).toBe(true);
    // A member of TokenDance: the balance, then the connection status.
    expect(dividerAfterBalance(member("tokendance", true))).toBe(true);
  });

  it("is left out where it would separate nothing", () => {
    // A member of DeepSeek sees the balance alone.
    expect(dividerAfterBalance(member("deepseek", true))).toBe(false);
    // No balance to lead: no key stored, or a group without one.
    expect(dividerAfterBalance(owner("tokendance", false))).toBe(false);
    expect(dividerAfterBalance(owner("openai", true))).toBe(false);
    expect(dividerAfterBalance([])).toBe(false);
  });
});
