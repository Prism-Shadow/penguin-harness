/**
 * A Session stream that dies silently mid-run: the page must catch up without a reload.
 *
 * The browser reaches the server through a TCP relay. Mid-reply the relay swallows the open
 * Session stream's bytes and closes nothing, as a half-open connection or a stuck proxy does.
 * The run finishes on the server; then the page's clock jumps past the liveness window, and
 * the page must reconnect from the last event it saw and show the whole reply exactly once.
 * The mock LLM's "slow text test" streams 40 chunks, one every 200 ms.
 */
import net from "node:net";
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = "stalluser";
const P = "password123";

/** Create a session for the user's auto-provisioned project (models PUT is idempotent). */
async function createSession(page) {
  const projects = await (await page.request.get(`${BASE}/api/projects`)).json();
  const projectId = projects.projects[0].projectId;
  const put = await page.request.put(`${BASE}/api/projects/${projectId}/models`, {
    data: {
      defaultModel: { provider: "custom", modelId: "claude-4-8" },
      models: [
        {
          provider: "custom",
          modelId: "claude-4-8",
          apiKey: "sk-mock",
          baseUrl: MOCK,
          contextWindow: 200000,
        },
      ],
    },
  });
  expect(put.ok(), "put models").toBeTruthy();
  const res = await page.request.post(
    `${BASE}/api/projects/${projectId}/agents/default_agent/sessions`,
    { data: { provider: "custom", modelId: "claude-4-8", approvalMode: "allow-all" } },
  );
  expect(res.ok(), `create session: ${await res.text()}`).toBeTruthy();
  return (await res.json()).session.sessionId;
}

/** A TCP relay in front of the server; `silenceSessionStreams()` mutes the open Session streams. */
async function startRelay() {
  const target = new URL(BASE);
  const pairs = new Set();
  const server = net.createServer((client) => {
    const upstream = net.connect(Number(target.port), "127.0.0.1");
    const pair = { client, upstream, sessionStream: false, silent: false };
    pairs.add(pair);
    client.on("data", (chunk) => {
      if (/^GET \/api\/sessions\/[^/\s]+\/stream[?\s]/m.test(chunk.toString("latin1"))) {
        pair.sessionStream = true;
      }
      upstream.write(chunk);
    });
    upstream.on("data", (chunk) => {
      if (!pair.silent) client.write(chunk);
    });
    const end = () => {
      pairs.delete(pair);
      client.destroy();
      upstream.destroy();
    };
    for (const socket of [client, upstream]) {
      socket.on("close", end);
      socket.on("error", end);
    }
  });
  await new Promise((resolve) => server.listen(0, resolve));
  return {
    url: `http://localhost:${server.address().port}`,
    silenceSessionStreams() {
      const streams = [...pairs].filter((pair) => pair.sessionStream);
      for (const pair of streams) pair.silent = true;
      return streams.length;
    },
    close() {
      for (const pair of pairs) {
        pair.client.destroy();
        pair.upstream.destroy();
      }
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

test("a Session stream that goes silent mid-run catches up on its own, without a reload", async ({
  page,
}) => {
  await provisionAndLogin(page.request, U, P);
  const sessionId = await createSession(page);
  const relay = await startRelay();
  try {
    // A fake clock that runs at real speed until the test jumps it forward.
    await page.clock.install();
    await page.goto(`${relay.url}/chat/${sessionId}`);
    // Survives only if the page is never reloaded.
    await page.evaluate(() => {
      window.__stallMarker = "same page";
    });

    const ta = page.getByPlaceholder(/输入消息/);
    await ta.waitFor();
    await ta.fill("slow text test");
    await page.getByRole("button", { name: "发送" }).click();
    const reply = page.locator(".md-body", { hasText: /chunk-1\s/ }).first();
    await expect(reply).toContainText("chunk-3 ");

    expect(relay.silenceSessionStreams(), "a Session stream was open").toBeGreaterThan(0);

    // The run finishes on the server while the page hears nothing.
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`${BASE}/api/sessions/${sessionId}`)).json()).session
            .status,
        { timeout: 30_000 },
      )
      .toBe("idle");
    await expect(reply).not.toContainText("chunk-40");

    // Past the liveness window: the page notices the silence and reconnects.
    await page.clock.fastForward(60_000);
    await expect(reply).toContainText("chunk-40", { timeout: 15_000 });
    const text = await reply.textContent();
    expect(text.match(/chunk-5 /g)).toHaveLength(1);
    expect(text.match(/chunk-39 /g)).toHaveLength(1);
    expect(await page.evaluate(() => window.__stallMarker)).toBe("same page");
  } finally {
    await relay.close();
  }
});
