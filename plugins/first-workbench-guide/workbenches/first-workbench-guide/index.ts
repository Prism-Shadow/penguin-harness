import { randomBytes } from "node:crypto";
import type { WorkbenchPackage, WorkbenchResponse } from "@prismshadow/penguin-server/plugin";

type Model = { provider: string; modelId: string };
type Design = { title: string; items: { group: string; task: string; doneWhen: string }[] };
type Guide = {
  model: Model;
  request: string;
  lang: string;
  sessionId: string;
  boardId: string;
  phase: "chatting" | "answered" | "generating" | "ready" | "chat-error" | "design-error";
  answer?: string;
  design?: Design;
  error?: string;
};
function text(value: unknown, max: number): value is string {
  return typeof value === "string" && !!value.trim() && value.length <= max;
}
function designOf(answer: string): Design | null {
  try {
    const source = answer.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, "$1");
    if (source.length > 24_000) return null;
    const d = JSON.parse(source);
    if (!text(d?.title, 96) || !Array.isArray(d.items) || !d.items.length || d.items.length > 24)
      return null;
    if (
      !d.items.every(
        (i: Design["items"][number]) =>
          text(i?.group, 60) && text(i.task, 180) && text(i.doneWhen, 320),
      )
    )
      return null;
    return {
      title: d.title.trim(),
      items: d.items.map((i: Design["items"][number]) => ({
        group: i.group.trim(),
        task: i.task.trim(),
        doneWhen: i.doneWhen.trim(),
      })),
    };
  } catch {
    return null;
  }
}

export default {
  modules: {
    Workbench: {
      create({ use: { host } }) {
        // GET can settle a completed turn; serialize it with starts and retries from other frames.
        let queue: Promise<unknown> = Promise.resolve();
        const all = () => (host.getState() ?? {}) as Record<string, Guide>;
        const save = (key: string, guide: Guide) => host.setState({ ...all(), [key]: guide });
        return {
          api: {
            main: {
              async handle(req): Promise<WorkbenchResponse> {
                if (req.path === "/capabilities" && req.method === "GET")
                  return { body: { fromConversation: true } };
                const route = /^\/guides\/([a-f0-9]{32})(?:\/(plugin\.zip|installation))?$/.exec(
                  req.path,
                );
                if (!route) return { status: 404 };
                const [, key, artifact] = route;
                if (artifact) {
                  const guide = all()[key];
                  if (req.method !== "GET" || guide?.phase !== "ready") return { status: 404 };
                  // The host emits this handler into .build/<revision>/; the packed source stays at the root.
                  const moduleUrl = new URL("../../archives.mjs", import.meta.url).href;
                  const { archive } = await import(moduleUrl);
                  const bytes: Uint8Array = archive(
                    guide,
                    artifact === "plugin.zip" ? "plugin" : "workbench",
                  );
                  if (artifact === "installation")
                    return { body: { dataBase64: Buffer.from(bytes).toString("base64") } };
                  return {
                    headers: {
                      "content-type": "application/zip",
                      "content-disposition": 'attachment; filename="' + guide.boardId + '.zip"',
                    },
                    bytes,
                  };
                }
                const work = async (): Promise<WorkbenchResponse> => {
                  let guide = all()[key];
                  if (req.method === "GET") {
                    if (!guide) return { body: null };
                    if (guide.phase === "chatting" || guide.phase === "generating") {
                      const result = await host.sessionResult(guide.sessionId);
                      if (result.status !== "running") {
                        const chatting = guide.phase === "chatting";
                        if (result.status === "failed" || !result.text.trim()) {
                          guide = {
                            ...guide,
                            phase: chatting ? "chat-error" : "design-error",
                            error: result.error ?? "empty-reply",
                          };
                        } else if (chatting) {
                          guide = { ...guide, phase: "answered", answer: result.text };
                        } else {
                          const design = designOf(result.text);
                          guide = design
                            ? { ...guide, phase: "ready", design }
                            : { ...guide, phase: "design-error", error: "invalid-design" };
                        }
                        await save(key, guide);
                      }
                    }
                    return { body: guide };
                  }
                  if (req.method !== "POST") return { status: 405 };
                  const input = req.body as {
                    action?: unknown;
                    model?: Model;
                    request?: string;
                    lang?: string;
                    feedback?: string;
                    answer?: string;
                  } | null;
                  const chat = input?.action === "chat";
                  const fromChat = input?.action === "generate-from-chat";
                  if (!chat && !fromChat && input?.action !== "generate")
                    return { status: 400, body: { error: "invalid" } };
                  if (chat && guide && guide.phase !== "chat-error") return { body: guide };
                  if (!chat && guide && ["ready", "generating"].includes(guide.phase))
                    return { body: guide };
                  if (
                    !chat &&
                    ((!guide && !fromChat) ||
                      (guide && !["answered", "design-error"].includes(guide.phase)))
                  )
                    return { status: 409, body: { error: "chat-first" } };
                  let prompt: string;
                  if (chat || (fromChat && !guide)) {
                    if (
                      !text(input?.model?.modelId, 512) ||
                      !text(input.model.provider, 512) ||
                      !text(input.request, 4000) ||
                      (fromChat && !text(input.answer, 24000))
                    )
                      return { status: 400, body: { error: "invalid" } };
                    const model = { provider: input.model.provider, modelId: input.model.modelId };
                    const session = await host.createSession({ model, approvalMode: "deny-all" });
                    guide = {
                      // npm redacts UUIDs in pack --json, whose filename the plugin importer uses.
                      boardId:
                        "checklist-" +
                        Array.from({ length: 5 }, () => randomBytes(3).toString("hex")).join("-"),
                      model,
                      request: input.request.trim(),
                      lang: input.lang === "zh" ? "zh" : "en",
                      sessionId: session.sessionId,
                      phase: fromChat ? "answered" : "chatting",
                      ...(fromChat ? { answer: input.answer } : {}),
                    };
                  }
                  if (!guide) return { status: 409, body: { error: "chat-first" } };
                  if (chat) {
                    prompt =
                      "The user is making a checklist for their work. Respond directly to their request with a short practical plan. Stay in this conversation and use no tools.\n\n" +
                      guide.request;
                  } else {
                    if (
                      input?.feedback !== undefined &&
                      (typeof input.feedback !== "string" || input.feedback.length > 2000)
                    )
                      return { status: 400, body: { error: "invalid" } };
                    guide = { ...guide, phase: "generating", error: undefined };
                    prompt = [
                      "Turn the user's request and our preceding discussion into a checklist app for their specific situation. Use no tools.",
                      'Return only JSON with this shape: {"title":"...","items":[{"group":"...","task":"...","doneWhen":"..."}]}',
                      "Use a short title (at most 96 characters) and 3–12 actionable tasks grouped by topic. For each, give an observable completion condition. Group, task and condition are at most 60, 180 and 320 characters respectively.",
                      guide.lang === "zh"
                        ? "Write the content in Simplified Chinese."
                        : "Write the content in English.",
                      fromChat
                        ? "User request and visible answer from their conversation:\n" +
                          JSON.stringify({ request: guide.request, answer: guide.answer })
                        : "",
                      input?.feedback ? "The user's revisions: " + input.feedback : "",
                    ].join("\n");
                  }
                  // Save the Session before starting its turn so a reload can reconcile a lost response.
                  await save(key, guide);
                  try {
                    await host.run(guide.sessionId, [{ text: prompt }]);
                  } catch (err) {
                    guide = {
                      ...guide,
                      phase: chat ? "chat-error" : "design-error",
                      error: err instanceof Error ? err.message : String(err),
                    };
                    await save(key, guide);
                  }
                  return { status: 202, body: guide };
                };
                const next = queue.then(work);
                queue = next.catch(() => undefined);
                return next;
              },
            },
          },
        };
      },
    },
  },
} satisfies WorkbenchPackage;
