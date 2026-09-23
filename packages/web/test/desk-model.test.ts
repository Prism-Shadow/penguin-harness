import { describe, expect, it } from "vitest";
import type { OrgDeskResponse } from "@prismshadow/penguin-server/api";
import { switchDeskModel } from "../src/features/company/desk-model";
import type { DeskModelApi } from "../src/features/company/desk-model";

const desk = (sessionId: string): OrgDeskResponse => ({
  agentId: "acme_ceo",
  sessionId,
  workspace: "/w",
  openedAt: "2026-09-20T00:00:00Z",
  created: false,
});

function fakeApi(current: string) {
  const calls: string[] = [];
  const api: DeskModelApi = {
    getOrgDesk: async () => (calls.push("get"), desk(current)),
    patchOrgEmployee: async (_p, _o, agentId, body) =>
      void calls.push(`patch ${agentId} ${body.model.provider}/${body.model.modelId}`),
    renewOrgDesk: async () => (calls.push("renew"), desk("desk-2")),
  };
  return { api, calls };
}

const AT = { projectId: "p", orgId: "acme", agentId: "acme_ceo" };
const REF = { provider: "openai", modelId: "gpt-x" };

describe("switching the model of a desk", () => {
  it("writes the employee's model, THEN renews the desk, and answers the new desk", async () => {
    // The order is the point: the renewed desk is opened on whatever the chart says.
    const { api, calls } = fakeApi("desk-1");
    expect(await switchDeskModel(api, { ...AT, sessionId: "desk-1" }, REF)).toBe("desk-2");
    expect(calls).toEqual(["get", "patch acme_ceo openai/gpt-x", "renew"]);
  });

  it("leaves anything that is not the employee's current desk to an ordinary fork", async () => {
    const { api, calls } = fakeApi("desk-1");
    expect(await switchDeskModel(api, { ...AT, sessionId: "a-ticket-session" }, REF)).toBeNull();
    expect(calls).toEqual(["get"]);
  });

  it("does not renew a desk whose model could not be written", async () => {
    const { api, calls } = fakeApi("desk-1");
    api.patchOrgEmployee = async () => {
      throw new Error("Model is not in the Project config");
    };
    await expect(switchDeskModel(api, { ...AT, sessionId: "desk-1" }, REF)).rejects.toThrow(
      "Model is not in the Project config",
    );
    expect(calls).toEqual(["get"]);
  });
});
