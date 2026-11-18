import type { WorkbenchPackage } from "@prismshadow/penguin-server/plugin";

type Job = {
  id: string;
  sessionId: string;
  prompt: string;
  ratio: string;
  created: string;
  failure?: string;
  stopRequested?: boolean;
};
const ratios = new Set(["1:1", "16:9", "9:16", "4:3", "3:4"]);
const idPattern = /^[a-z\d-]{36}$/i;

export default {
  modules: {
    Workbench: {
      create({ use }) {
        const host = use.host;
        const all = (): Job[] => {
          const stored = host.getState() as { jobs?: Job[] } | null;
          return Array.isArray(stored?.jobs) ? stored.jobs : [];
        };
        // Starting or retrying in two windows must never create a second Session
        // for the same request, or overwrite another window's history.
        let pending: Promise<unknown> = Promise.resolve();
        function change<T>(operation: () => Promise<T>) {
          const result = pending.then(operation, operation);
          pending = result.catch(() => undefined);
          return result;
        }
        return {
          api: {
            main: {
              async handle(req) {
                if (req.method === "GET" && req.path === "/jobs") return { body: { jobs: all() } };
                if (req.method === "POST" && req.path === "/jobs") {
                  const body = (req.body ?? {}) as Partial<{
                    id: string;
                    prompt: string;
                    ratio: string;
                    lang: string;
                  }>;
                  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
                  const { id, ratio } = body;
                  if (
                    !id ||
                    !idPattern.test(id) ||
                    !prompt ||
                    prompt.length > 6000 ||
                    !ratio ||
                    !ratios.has(ratio)
                  ) {
                    return { status: 400, body: { error: "invalidBrief" } };
                  }
                  return change(async () => {
                    const existing = all().find((j) => j.id === id);
                    if (existing) return { body: { job: existing } };
                    const { sessionId } = await host.createSession();
                    const job: Job = {
                      id,
                      sessionId,
                      prompt,
                      ratio,
                      created: new Date().toISOString(),
                    };
                    await host.setState({ jobs: [job, ...all()] });
                    const language = body.lang === "zh" ? "Chinese" : "English";
                    const instructions = [
                      "[use_skills]\nskills: multimodal-tools\n[/use_skills]\n",
                      "Generate one image through the project's configured image model by executing penguin tools image with --json. Use the supplied Session ID and aspect ratio. Pass the image brief as one literal argument. Your response must describe the real tool result or its failure.",
                      `Session ID: ${sessionId}. Aspect ratio: ${ratio}. Respond in ${language}.`,
                      "Image brief (JSON string): " + JSON.stringify(prompt),
                    ].join("\n");
                    try {
                      await host.run(sessionId, [{ text: instructions }]);
                    } catch (e) {
                      job.failure = e instanceof Error ? e.message : String(e);
                      await host.setState({ jobs: all().map((j) => (j.id === id ? job : j)) });
                    }
                    return { body: { job } };
                  });
                }
                const match = /^\/jobs\/([a-z\d-]{36})(\/stop-requested)?$/i.exec(req.path);
                if (!match) return { status: 404, body: { error: "notFound" } };
                const job = all().find((j) => j.id === match[1]);
                if (!job) return { status: 404, body: { error: "notFound" } };
                if (req.method === "GET" && !match[2]) {
                  const session = job.failure
                    ? { status: "failed", text: "", error: job.failure }
                    : await host.sessionResult(job.sessionId);
                  return { body: { job, session } };
                }
                if (req.method === "POST" && match[2])
                  return change(async () => {
                    const jobs = all().map((j) =>
                      j.id === job.id ? { ...j, stopRequested: true } : j,
                    );
                    await host.setState({ jobs });
                    return { body: { ok: true } };
                  });
                return { status: 405, body: { error: "method" } };
              },
            },
          },
        };
      },
    },
  },
} satisfies WorkbenchPackage;
