// A deck started in the app center and reopened full screen keeps one Session and history.
// Pick a different model after the first reply; the provider reports which upstream it received.
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";
const BASE = process.env.BASE_URL;
test("choosing a model in Slides changes only the presentation's next turn", async ({ page }) => {
  await provisionAndLogin(page.request, "bentomodeluser", "password123");
  const { projects } = await (await page.request.get(BASE + "/api/projects")).json();
  const project = projects[0].projectId;
  const projectApi = BASE + "/api/projects/" + project;
  const first = "claude-bento-first",
    second = "claude-bento-second";
  const models = [first, second].map((modelId) => ({
    modelId,
    displayName: modelId === first ? "Draft" : "Review",
    provider: "custom",
    apiKey: "sk-mock",
    baseUrl: process.env.MOCK_URL,
    contextWindow: 200000,
  }));
  const configured = await page.request.put(projectApi + "/models", {
    data: { defaultModel: { provider: "custom", modelId: first }, models },
  });
  expect(configured.ok(), await configured.text()).toBeTruthy();
  const installed = await page.request.post(projectApi + "/agents/default_agent/plugins", {
    data: { names: ["use-bento-slides"] },
  });
  expect(installed.ok(), await installed.text()).toBeTruthy();
  await page.goto(BASE + "/apps");
  await page
    .getByRole("button", { name: /AI (PPT|Slides)/ })
    .first()
    .click();
  const app = page.frameLocator("iframe[src*='/workbenches/slides/ui/']:visible");
  await app.locator("#start-sample").click();
  const ask = async (text) => {
    await app.locator("#prompt").fill(text);
    await app.locator("#send").click();
  };
  await ask("Check the cover");
  await expect(app.locator("#talk")).toContainText("Served by " + first, { timeout: 30000 });
  const wb = projectApi + "/agents/default_agent/workbenches/slides/api";
  const decks = await (await page.request.get(wb + "/decks")).json();
  const deckId = decks.decks[0].id;
  const session = async () =>
    (await (await page.request.get(wb + "/ask?deck=" + deckId)).json()).sessionId;
  const original = await session();
  await expect(app.locator("#chat-model button")).toContainText("Draft");

  await app.locator("#chat-model button").click();
  const picker = page.getByRole("dialog").last();
  await expect(picker).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
  await page.goto(BASE + "/app/" + project + "/default_agent/slides/main");
  await app.locator("#recent-decks .file-row button").first().click();
  await app.locator("#chat-model button").click();
  await page.route(
    "**/sessions/*/switch-model",
    (route) =>
      route.fulfill({
        status: 403,
        json: { error: { code: "permission_denied", message: "Permission denied." } },
      }),
    { times: 1 },
  );
  await picker.getByText("Review", { exact: true }).click();
  await app.locator('#choice-confirm [value="switch"]').click();
  await expect(app.locator("#notice")).toContainText("Permission denied.");
  await expect(app.locator("#chat-model button")).toContainText("Draft");
  await app.locator("#chat-model button").click();
  await picker.getByText("Review", { exact: true }).click();
  await app.locator('#choice-confirm [value="switch"]').click();
  await expect(app.locator("#chat-model button")).toContainText("Review");
  await ask("Shorten slide two");
  await expect(app.locator("#talk")).toContainText("Served by " + second, { timeout: 30000 });
  await expect(app.locator("#talk")).toContainText("Check the cover");
  await expect(app.locator("#chat-model button")).toBeEnabled();
  expect(await session()).toBe(original);
  const catalog = await (await page.request.get(projectApi + "/models")).json();
  expect(catalog.defaultModel).toEqual({ provider: "custom", modelId: first });
  await page.reload();
  await app.locator("#recent-decks .file-row button").first().click();
  await expect(app.locator("#chat-model button")).toContainText("Review");
  await expect(app.locator("#talk")).toContainText("Served by " + second);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await app.locator("#chat-model button").click();
    await expect(picker.getByText("Review", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    expect(await app.locator("#app").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  }

  await page.setViewportSize({ width: 1280, height: 720 });
  await app.locator("#show-decks").click();
  await app.locator("#start-model button").click();
  await picker.getByText("Review", { exact: true }).click();
  await app.locator("#start-prompt").fill("Plan a workshop");
  await app.locator("#start-ask button[type=submit]").click();
  await expect(app.locator("#talk")).toContainText("Served by " + second);
  await expect(app.locator("#talk")).not.toContainText("Check the cover");
  await expect(app.locator("#chat-model button")).toContainText("Review");
  expect((await (await page.request.get(projectApi + "/models")).json()).defaultModel).toEqual({
    provider: "custom",
    modelId: first,
  });
  await app.locator("#show-decks").click();
  await expect(app.locator("#start-model button")).toContainText("Draft");
});

// Gate a real provider request so both selectors can be exercised while the engine is waiting.
// The first model accepts Anthropic effort. The second speaks plain Chat Completions.
test("changes a running deck's choices without interrupting or resending its task", async ({
  page,
}) => {
  const { createServer } = await import("node:http");
  const { setAccountPrefs } = await import("./account-prefs.mjs");
  const requests = [];
  const gate = Promise.withResolvers();
  const abortGate = Promise.withResolvers();
  let heldForAbort = false;
  let delayed = false;
  const listen = async (handler) => {
    const server = createServer(async (req, res) => {
      try {
        const parts = [];
        for await (const part of req) parts.push(part);
        await handler(JSON.parse(Buffer.concat(parts).toString()), req, res);
      } catch (error) {
        res.writeHead(500).end(String(error));
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    return { server, url: "http://127.0.0.1:" + server.address().port };
  };
  const draft = await listen(async (body, req, res) => {
    const text = JSON.stringify(body.messages);
    const title = text.includes("You are a title generator.");
    if (!title) requests.push({ model: body.model, effort: body.output_config?.effort, text });
    if (!title && text.includes("Hold the layout review") && !delayed) {
      delayed = true;
      await gate.promise;
      res.writeHead(200, { "content-type": "text/event-stream" });
      const event = (type, fields) =>
        res.write("event: " + type + "\ndata: " + JSON.stringify({ type, ...fields }) + "\n\n");
      event("message_start", {
        message: {
          id: "slide-review",
          type: "message",
          role: "assistant",
          model: body.model,
          content: [],
          usage: { input_tokens: 30, output_tokens: 0 },
        },
      });
      event("content_block_start", {
        index: 0,
        content_block: { type: "tool_use", id: "slide-tool", name: "exec_command", input: {} },
      });
      event("content_block_delta", {
        index: 0,
        delta: {
          type: "input_json_delta",
          partial_json: JSON.stringify({ cmd: "echo slide-review" }),
        },
      });
      event("content_block_stop", { index: 0 });
      event("message_delta", {
        delta: { stop_reason: "tool_use", stop_sequence: null },
        usage: { output_tokens: 12 },
      });
      event("message_stop", {});
      res.end();
      return;
    }
    const result = await fetch(process.env.MOCK_URL + req.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    res.writeHead(result.status, { "content-type": result.headers.get("content-type") });
    res.end(Buffer.from(await result.arrayBuffer()));
  });
  const review = await listen(async (body, _req, res) => {
    requests.push({
      model: body.model,
      effort: body.reasoning_effort,
      text: JSON.stringify(body.messages),
    });
    if (!heldForAbort && JSON.stringify(body.messages).includes("Check the budget slide")) {
      heldForAbort = true;
      await abortGate.promise;
      if (res.destroyed) return;
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    const write = (delta, finish_reason) =>
      res.write(
        "data: " +
          JSON.stringify({
            id: "slide-review",
            object: "chat.completion.chunk",
            created: 1,
            model: body.model,
            choices: [{ index: 0, delta, finish_reason }],
          }) +
          "\n\n",
      );
    write({ role: "assistant", content: "Reviewed on the second endpoint." }, null);
    write({}, "stop");
    res.write(
      "data: " +
        JSON.stringify({
          id: "slide-review",
          object: "chat.completion.chunk",
          created: 1,
          model: body.model,
          choices: [],
          usage: { prompt_tokens: 32, completion_tokens: 8, total_tokens: 40 },
        }) +
        "\n\n",
    );
    res.end("data: [DONE]\n\n");
  });
  try {
    await provisionAndLogin(page.request, "bentolivechoices", "password123");
    await setAccountPrefs(page.request, { lang: "en" });
    const { projects } = await (await page.request.get(BASE + "/api/projects")).json();
    const project = projects[0].projectId;
    const projectApi = BASE + "/api/projects/" + project;
    const first = "claude-bento-first",
      second = "bento-review-chat";
    const config = await page.request.put(projectApi + "/models", {
      data: {
        defaultModel: { provider: "custom", modelId: first },
        models: [
          {
            provider: "custom",
            modelId: first,
            displayName: "Draft endpoint",
            clientType: "ant-messages",
            baseUrl: draft.url,
            apiKey: "sk-mock",
            contextWindow: 200000,
          },
          {
            provider: "custom",
            modelId: second,
            displayName: "Review endpoint",
            clientType: "openai-chat",
            baseUrl: review.url,
            apiKey: "sk-mock",
            contextWindow: 200000,
          },
        ],
      },
    });
    expect(config.ok(), await config.text()).toBe(true);
    expect(
      (
        await page.request.post(projectApi + "/agents/default_agent/plugins", {
          data: { names: ["use-bento-slides"] },
        })
      ).ok(),
    ).toBe(true);
    await page.goto("/app/" + project + "/default_agent/slides/main");
    const wb = page.frameLocator("iframe[src*='/workbenches/slides/ui/']:visible");
    const pickEffort = async (control, level) => {
      await wb
        .locator(control + " button")
        .first()
        .click();
      await wb.getByText(level, { exact: true }).last().click();
    };
    await pickEffort("#start-effort", "low");
    await wb.locator("#start-prompt").fill("Hold the layout review");
    await wb.locator("#start-ask button[type=submit]").click();
    await expect
      .poll(() =>
        requests.filter((r) => r.text.includes("Hold the layout review")).map((r) => r.effort),
      )
      .toEqual(["low"]);
    await wb.locator("#prompt").fill("Keep this unsent draft.");
    await pickEffort("#chat-effort", "high");
    await wb.locator('#choice-confirm [value="switch"]').click();
    await wb.locator("#chat-model button").click();
    await page.getByRole("dialog").getByText("Review endpoint", { exact: true }).click();
    await wb.locator('#choice-confirm [value="switch"]').click();
    await expect(wb.locator("#chat-model button")).toContainText("Review endpoint");
    await expect(wb.locator("#chat-effort button")).toContainText("high");
    await expect(wb.getByText(/Queued switch|next request uses the thinking/i)).toHaveCount(0);
    await expect(wb.locator("#prompt")).toHaveValue("Keep this unsent draft.");
    const handler = projectApi + "/agents/default_agent/workbenches/slides/api";
    const { decks } = await (await page.request.get(handler + "/decks")).json();
    const current = async () =>
      (await (await page.request.get(handler + "/ask?deck=" + decks[0].id)).json()).sessionId;
    const original = await current();
    await wb.locator("#send").click();
    await page.reload();
    await wb.locator("#recent-decks .file-row button").first().click();
    await expect(wb.locator("#chat-model button")).toContainText("Review endpoint");
    await expect(wb.locator("#chat-effort button")).toContainText("high");
    await expect(wb.locator("#notice")).toBeHidden();
    gate.resolve();
    await expect(wb.locator("#talk")).toContainText("Reviewed on the second endpoint.", {
      timeout: 45000,
    });
    expect(
      requests.some(
        (r) => r.model === first && r.effort === "high" && r.text.includes("tool_result"),
      ),
    ).toBe(true);
    expect(
      requests.some(
        (r) =>
          r.model === second &&
          r.text.includes("Keep this unsent draft.") &&
          r.effort === undefined,
      ),
    ).toBe(true);
    expect(await current()).toBe(original);
    await page.reload();
    await wb.locator("#recent-decks .file-row button").first().click();
    await expect(wb.locator("#chat-effort button")).toContainText("high");
    await expect(wb.locator("#chat-model button")).toContainText("Review endpoint");
    await wb.locator("#prompt").fill("Check the budget slide");
    await wb.locator("#send").click();
    await expect.poll(() => heldForAbort).toBe(true);
    await wb.locator("#stop").click();
    abortGate.resolve();
    const retry = wb.getByRole("button", { name: "Retry" });
    await expect(retry).toBeVisible();
    await pickEffort("#chat-effort", "low");
    await wb.locator('#choice-confirm [value="switch"]').click();
    await expect(wb.locator("#chat-effort button")).toContainText("low");
    await retry.click();
    await expect
      .poll(
        () =>
          requests.filter((r) => r.model === second && r.text.includes("Check the budget slide"))
            .length,
      )
      .toBe(2);
    const lastTurn = wb.locator("#talk li").last();
    await expect(lastTurn).toContainText("Reviewed on the second endpoint.");
    await expect(lastTurn.getByRole("button", { name: "Retry" })).toHaveCount(0);
    expect(await current()).toBe(original);
  } finally {
    abortGate.resolve();
    gate.resolve();
    for (const { server } of [draft, review]) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  }
});

for (const mode of ["queued", "idle-only", "removed"]) {
  const strictHost = mode === "idle-only";
  test("selecting a model before the first task acknowledgement: " + mode, async ({ page }) => {
    const { createServer } = await import("node:http");
    const { setAccountPrefs } = await import("./account-prefs.mjs");
    const first = "claude-bento-first";
    const second = "claude-bento-second";
    const prompt = "Prepare the weekly inventory slides";
    const followup = "Add a page for the remaining orders";
    const releaseTask = Promise.withResolvers();
    const releaseAck = Promise.withResolvers();
    const ack = Promise.withResolvers();
    const arrivals = [];
    const source = createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      const text = JSON.stringify(body.messages);
      if (text.includes(prompt) && !text.includes("You are a title generator.")) {
        arrivals.push(body.model);
        await releaseTask.promise;
      }
      const reply = await fetch(process.env.MOCK_URL + req.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: raw,
      });
      res.writeHead(reply.status, { "content-type": reply.headers.get("content-type") });
      res.end(Buffer.from(await reply.arrayBuffer()));
    });
    await new Promise((resolve) => source.listen(0, "127.0.0.1", resolve));
    try {
      await provisionAndLogin(page.request, "bentoack" + mode.replace("-", ""), "password123");
      await setAccountPrefs(page.request, { lang: "zh" });
      const { projects } = await (await page.request.get(BASE + "/api/projects")).json();
      const project = projects[0].projectId;
      const api = BASE + "/api/projects/" + project;
      const models = [first, second].map((modelId) => ({
        provider: "custom",
        modelId,
        clientType: "ant-messages",
        contextWindow: 200000,
        apiKey: "fixture-credential",
        baseUrl:
          modelId === first ? "http://127.0.0.1:" + source.address().port : process.env.MOCK_URL,
      }));
      expect(
        (
          await page.request.put(api + "/models", {
            data: { models, defaultModel: { provider: "custom", modelId: first } },
          })
        ).ok(),
      ).toBe(true);
      expect(
        (
          await page.request.post(api + "/agents/default_agent/plugins", {
            data: { names: ["use-bento-slides"] },
          })
        ).ok(),
      ).toBe(true);
      await page.goto("/app/" + project + "/default_agent/slides/main");
      const frame = page.frameLocator("iframe[src*='/workbenches/slides/ui/']:visible");
      await frame.locator("#start-sample").click();
      // The server admits the real task while its first HTTP acknowledgement is still in transit.
      await page.route(
        "**/workbenches/slides/api/ask",
        async (route) => {
          const response = await route.fetch();
          ack.resolve((await response.json()).sessionId);
          await releaseAck.promise;
          await route.fulfill({ response });
        },
        { times: 1 },
      );
      await frame.locator("#prompt").fill(prompt);
      await frame.locator("#send").click();
      const sessionId = await ack.promise;
      const deck = (
        await (
          await page.request.get(api + "/agents/default_agent/workbenches/slides/api/decks")
        ).json()
      ).decks[0];
      await expect.poll(() => arrivals).toEqual([first]);
      const sessionPath = BASE + "/api/sessions/" + sessionId;
      const session = async () => (await (await page.request.get(sessionPath)).json()).session;
      expect((await session()).status).toBe("running");
      const responses = [];
      if (strictHost) {
        // The same HTTP endpoint without the opt-in follows the older host's idle-only contract.
        await page.route("**/sessions/*/switch-model", async (route) => {
          const { provider, modelId } = route.request().postDataJSON();
          const response = await route.fetch({ postData: { provider, modelId } });
          responses.push(response.status());
          await route.fulfill({ response });
        });
      }
      const mutations = [];
      page.on("request", (r) => {
        if (r.method() === "POST" && r.url().endsWith("/switch-model"))
          mutations.push(r.postDataJSON());
      });
      await frame.locator("#prompt").fill(followup);
      await frame.locator("#chat-model button").click();
      await page.getByRole("dialog").getByText(second, { exact: true }).click();
      const confirm = frame.locator("#choice-confirm");
      await expect(confirm).toBeVisible();
      expect(mutations).toEqual([]);
      await confirm.locator('[value="switch"]').click();
      if (strictHost) {
        await expect.poll(() => responses).toEqual([409]);
        expect((await session()).pendingModel).toBeUndefined();
      } else {
        await expect
          .poll(async () => (await session()).pendingModel)
          .toEqual({ provider: "custom", modelId: second });
      }
      expect(mutations).toEqual([{ provider: "custom", modelId: second, whenIdle: true }]);
      expect((await session()).modelId).toBe(first);
      await expect(frame.locator("#chat-model button")).toContainText(second);
      await expect(frame.getByText(/已排队切换|Queued switch/i)).toHaveCount(0);
      await expect(frame.locator("#prompt")).toHaveValue(followup);
      await expect(frame.locator("#notice")).toBeHidden();
      releaseAck.resolve();
      if (mode === "removed") {
        // The real catalog changes after the host has already accepted its target.
        expect(
          (
            await page.request.put(api + "/models", {
              data: { models: [models[0]], defaultModel: { provider: "custom", modelId: first } },
            })
          ).ok(),
        ).toBe(true);
        releaseTask.resolve();
        await expect.poll(async () => (await session()).modelSwitchFailure?.modelId).toBe(second);
        await expect(frame.locator("#chat-model button")).toContainText(first);
        await expect(frame.locator("#notice")).toHaveText("模型切换失败。");
        await expect(frame.locator("#prompt")).toHaveValue(followup);
        expect(mutations).toHaveLength(1);
        await page.reload();
        await frame.locator("#recent-decks .file-row button").first().click();
        await expect(frame.locator("#chat-model button")).toContainText(first);
        await expect(frame.locator("#notice")).toBeHidden();
        return;
      }
      if (strictHost) {
        await expect(frame.locator("#send")).toBeDisabled();
        // Selecting the running model withdraws the local wait without sending another mutation.
        await frame.locator("#chat-model button").click();
        await page.getByRole("dialog").getByText(first, { exact: true }).click();
        await expect(frame.locator("#send")).toBeEnabled();
        await expect(frame.locator("#chat-model button")).toContainText(first);
        expect(responses).toEqual([409]);
        await frame.locator("#chat-model button").click();
        await page.getByRole("dialog").getByText(second, { exact: true }).click();
        await confirm.locator('[value="switch"]').click();
        await expect.poll(() => responses).toEqual([409, 409]);
        releaseTask.resolve();
        await expect.poll(async () => (await session()).modelId, { timeout: 30000 }).toBe(second);
        expect(responses).toEqual([409, 409, 202]);
      }
      await frame.locator("#send").click();
      releaseTask.resolve();
      await expect(frame.locator("#talk")).toContainText("Served by " + second, {
        timeout: 45000,
      });
      const talk = await (
        await page.request.get(
          api + "/agents/default_agent/workbenches/slides/api/ask?deck=" + deck.id,
        )
      ).json();
      expect(talk.sessionId).toBe(sessionId);
      expect(talk.messages.filter((m) => m.role === "user").map((m) => m.text)).toEqual([
        prompt,
        followup,
      ]);
      expect((await session()).modelId).toBe(second);
    } finally {
      releaseAck.resolve();
      releaseTask.resolve();
      source.closeAllConnections();
      await new Promise((resolve) => source.close(resolve));
    }
  });
}
