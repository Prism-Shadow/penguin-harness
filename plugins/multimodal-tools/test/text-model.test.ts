/**
 * Text generation and transcript editing, against a scripted model and a data root on disk.
 *
 * - Editing a transcript asks the model for the least thinking it accepts and tells it, in the
 *   instructions, to answer at once without thinking; the model's text comes back as it gave it.
 * - With nothing bound to text generation, editing and `penguin tools t2t` run on the Project's
 *   default chat model; a bound model wins over it.
 * - Until an owner sets the switch, editing is on once speech recognition is bound and there is a
 *   text model, and off otherwise; a switch an owner turned off stays off when speech recognition
 *   is bound later.
 */
import fs from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { Tools } from "../src/tools.js";
import { answer, bindings, modelTable, runCli, scriptedModel, tempRoot } from "./helpers.js";

const PROJECT = "research";
const CHAT = { provider: "deepseek", modelId: "deepseek-flash" };
const WRITER = { provider: "openai", modelId: "gpt-6-luna" };
const ASR = { provider: "deepseek", modelId: "deepseek-asr" };
const terminal = { userId: "u1", isAdmin: false, projectId: PROJECT };

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => fs.rm(r, { recursive: true, force: true })));
});

async function setup(
  reply: string,
  { bound = {}, defaultModel }: { bound?: Record<string, typeof CHAT>; defaultModel?: typeof CHAT },
) {
  const root = await tempRoot();
  roots.push(root);
  const model = scriptedModel(() => answer([{ type: "text.done", text: reply }]));
  const live = { ...bound };
  const tools = new Tools({
    requests: model,
    bindings: bindings(live),
    models: modelTable([{ ...CHAT }, { ...WRITER }, { ...ASR }], undefined, defaultModel),
    root,
  });
  return { model, tools, live };
}

describe("transcript editing", () => {
  it("asks for no thinking, tells the model to answer at once, and returns its text as given", async () => {
    const { model, tools } = await setup("So the plan is, we ship on Friday.", {
      bound: { t2t: WRITER, s2t: ASR },
    });
    const edited = await tools.polish.run(
      PROJECT,
      undefined,
      "um so the plan is uh we ship on friday",
    );
    expect(edited).toEqual({ text: "So the plan is, we ship on Friday.", model: WRITER });
    const [sent] = model.received;
    expect(sent?.request.config?.thinking_level).toBe("none");
    expect(sent?.request.config?.system_prompt).toBe(
      (await tools.polish.view(PROJECT)).defaultPrompt,
    );
    expect(sent?.request.config?.system_prompt).toMatch(/do not think/i);
    expect(sent?.request.messages[0]?.content_items).toEqual([
      { type: "text.done", text: "um so the plan is uh we ship on friday" },
    ]);
  });

  it("runs on the default chat model while nothing is bound to text generation", async () => {
    const { model, tools } = await setup("Hello.", { bound: { s2t: ASR }, defaultModel: CHAT });
    expect((await tools.polish.view(PROJECT)).model).toEqual(CHAT);
    expect(await tools.polish.run(PROJECT, undefined, "hello")).toEqual({
      text: "Hello.",
      model: CHAT,
    });
    expect(model.received[0]?.model).toEqual(CHAT);
  });

  it("is on by itself once speech recognition is bound and a text model exists, until an owner sets it", async () => {
    const { tools, live } = await setup("Hi.", { defaultModel: CHAT });
    expect((await tools.polish.view(PROJECT)).enabled).toBe(false);
    live.s2t = ASR;
    expect((await tools.polish.view(PROJECT)).enabled).toBe(true);

    await tools.polish.update(PROJECT, { enabled: false });
    expect((await tools.polish.view(PROJECT)).enabled).toBe(false);
    await expect(tools.polish.run(PROJECT, undefined, "hi")).rejects.toMatchObject({
      code: "voice_polish_disabled",
    });
  });

  it("stays off by itself when there is no text model to run on", async () => {
    const { model, tools } = await setup("Hi.", { bound: { s2t: ASR } });
    expect((await tools.polish.view(PROJECT)).enabled).toBe(false);
    await expect(tools.polish.update(PROJECT, { enabled: true })).rejects.toMatchObject({
      status: 400,
    });
    expect(model.received).toEqual([]);
  });

  it("keeps a switch turned off before speech recognition was bound", async () => {
    const { tools, live } = await setup("Hi.", { defaultModel: CHAT });
    await tools.polish.update(PROJECT, { enabled: false });
    live.s2t = ASR;
    expect((await tools.polish.view(PROJECT)).enabled).toBe(false);
  });
});

describe("penguin tools t2t", () => {
  it("runs on the default chat model while nothing is bound, and on the bound model once one is", async () => {
    const { model, tools, live } = await setup("A haiku.", { defaultModel: CHAT });
    const first = await runCli(tools, ["tools", "t2t", "write", "a", "haiku"], terminal);
    expect(first.exitCode, first.stderr).toBe(0);
    expect(model.received.at(-1)?.model).toEqual(CHAT);
    const listed = await runCli(tools, ["tools", "list", "--json"], terminal);
    expect(JSON.parse(listed.stdout)).toContainEqual(
      expect.objectContaining({ operation: "t2t", via: "default", model: CHAT }),
    );

    live.t2t = WRITER;
    expect((await runCli(tools, ["tools", "t2t", "again"], terminal)).exitCode).toBe(0);
    expect(model.received.at(-1)?.model).toEqual(WRITER);
  });
});
