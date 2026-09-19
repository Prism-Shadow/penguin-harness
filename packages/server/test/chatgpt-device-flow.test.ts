import { afterEach, expect, it, vi } from "vitest";
import { ChatGPTDeviceFlow } from "../src/services/chatgpt-device-flow.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const owner = { projectId: "project", userId: "user" };
const jwt = (payload: object) =>
  `x.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.x`;

it("binds flows to the owner, respects polling and only applies one successful exchange", async () => {
  vi.useFakeTimers();
  const apply = vi.fn(async () => 2);
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({ device_auth_id: "secret-device", user_code: "AAAA-BBBB", interval: "5" }),
    )
    .mockResolvedValueOnce(new Response("", { status: 403 }))
    .mockResolvedValueOnce(
      Response.json({ authorization_code: "secret-code", code_verifier: "secret-verifier" }),
    )
    .mockResolvedValueOnce(
      Response.json({
        access_token: "secret-access",
        refresh_token: "secret-refresh",
        expires_in: 3600,
        id_token: jwt({ "https://api.openai.com/auth": { chatgpt_account_id: "account" } }),
      }),
    );
  vi.stubGlobal("fetch", fetcher);
  const flow = new ChatGPTDeviceFlow(apply);
  const started = await flow.start(owner);
  expect(JSON.stringify(started)).not.toContain("secret");
  const handle = { ...owner, flowId: started.flowId };
  await expect(flow.poll({ ...handle, userId: "other" })).rejects.toThrow("expired");
  expect((await flow.poll(handle)).status).toBe("pending");
  expect(fetcher).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(5000);
  expect((await flow.poll(handle)).status).toBe("pending");
  vi.advanceTimersByTime(5000);
  const replies = await Promise.all([flow.poll(handle), flow.poll(handle)]);
  expect(replies.some((r) => r.status === "done")).toBe(true);
  expect(JSON.stringify(replies)).not.toContain("secret");
  expect(apply).toHaveBeenCalledTimes(1);
  await flow.poll(handle);
  expect(apply).toHaveBeenCalledTimes(1);
  flow.cancel(handle);
});

it("expires and cancels device authorization without persisting credentials", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () =>
      Response.json({ device_auth_id: "secret", user_code: "AAAA-BBBB" }),
    ),
  );
  const apply = vi.fn(async () => 1);
  const flow = new ChatGPTDeviceFlow(apply);
  const first = await flow.start(owner);
  const second = await flow.start(owner);
  expect(flow.has(first.flowId)).toBe(false);
  vi.advanceTimersByTime(900000);
  expect(flow.has(second.flowId)).toBe(false);
  expect(apply).not.toHaveBeenCalled();
});
