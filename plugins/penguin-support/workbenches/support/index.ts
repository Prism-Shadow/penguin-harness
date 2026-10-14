import type { WorkbenchPackage, WorkbenchResponse } from "@prismshadow/penguin-server/plugin";

type Message = { role: "user" | "assistant"; text: string; at: string };
type Ticket = {
  id: string;
  title: string;
  status: "running" | "answered" | "resolved" | "open" | "failed";
  sessionId: string;
  messages: Message[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
};
type State = { tickets: Ticket[] };

export default {
  modules: {
    Workbench: {
      create({ use }) {
        const host = use.host;
        let pending: Promise<unknown> = Promise.resolve();
        const locked = <T>(fn: () => Promise<T>): Promise<T> => {
          const result = pending.then(fn);
          pending = result.catch(() => undefined);
          return result;
        };
        const read = (): State => {
          const state = host.getState() as State | null;
          return state && Array.isArray(state.tickets) ? structuredClone(state) : { tickets: [] };
        };
        const save = (state: State) => host.setState(state);
        const start = async (ticket: Ticket, text: string, state: State) => {
          ticket.status = "running";
          ticket.error = null;
          ticket.updatedAt = new Date().toISOString();
          await save(state);
          try {
            await host.run(ticket.sessionId, [{ text }]);
            ticket.title = host.sessionTitle(ticket.sessionId) ?? ticket.title;
            await save(state);
          } catch (e) {
            ticket.status = "failed";
            ticket.error = e instanceof Error ? e.message : String(e);
            await save(state);
          }
        };
        return {
          api: {
            main: {
              async handle(req): Promise<WorkbenchResponse> {
                return locked(async () => {
                  const state = read();
                  if (req.method === "GET" && req.path === "/tickets") {
                    let changed = false;
                    for (const ticket of state.tickets) {
                      // Session titles can arrive before the answer, or be edited afterwards.
                      // A missing/removed Session must not hide an already saved question.
                      try {
                        const title = host.sessionTitle(ticket.sessionId);
                        if (title && title !== ticket.title) {
                          ticket.title = title;
                          changed = true;
                        }
                      } catch {}
                    }
                    for (const ticket of state.tickets.filter((t) => t.status === "running")) {
                      try {
                        const result = await host.sessionResult(ticket.sessionId);
                        if (result.status === "running") continue;
                        ticket.status = result.status === "completed" ? "answered" : "failed";
                        ticket.error = result.error;
                        ticket.updatedAt = new Date().toISOString();
                        if (result.status === "completed")
                          ticket.messages.push({
                            role: "assistant",
                            text: result.text,
                            at: ticket.updatedAt,
                          });
                      } catch (e) {
                        ticket.status = "failed";
                        ticket.error = e instanceof Error ? e.message : String(e);
                      }
                      changed = true;
                    }
                    if (changed) await save(state);
                    return { body: state };
                  }
                  const body = req.body as Record<string, unknown> | null;
                  if (req.method !== "POST" || !body || typeof body !== "object")
                    return { status: 400, body: { error: "Expected a JSON request." } };
                  const text = typeof body.text === "string" ? body.text.trim() : "";
                  if (text.length > 20000)
                    return {
                      status: 400,
                      body: { error: "Please keep the question under 20,000 characters." },
                    };
                  if (req.path === "/tickets") {
                    if (!text)
                      return {
                        status: 400,
                        body: { error: "A question is required." },
                      };
                    const { sessionId } = await host.createSession();
                    const now = new Date().toISOString();
                    const ticket: Ticket = {
                      id: crypto.randomUUID(),
                      title: host.sessionTitle(sessionId) ?? "",
                      status: "open",
                      sessionId,
                      messages: [{ role: "user", text, at: now }],
                      error: null,
                      createdAt: now,
                      updatedAt: now,
                    };
                    state.tickets.unshift(ticket);
                    await start(ticket, text, state);
                    return { status: 201, body: ticket };
                  }
                  const ticket = state.tickets.find((t) => req.path === "/tickets/" + t.id);
                  if (!ticket) return { status: 404, body: { error: "Question not found." } };
                  if (ticket.status === "running")
                    return {
                      status: 409,
                      body: { error: "This question is still being researched." },
                    };
                  if (body.action === "resolve" || body.action === "reopen") {
                    ticket.status = body.action === "resolve" ? "resolved" : "open";
                    ticket.updatedAt = new Date().toISOString();
                    await save(state);
                  } else if (body.action === "retry") {
                    if (ticket.status !== "failed")
                      return {
                        status: 409,
                        body: { error: "Only a failed question can be retried." },
                      };
                    const question = [...ticket.messages]
                      .reverse()
                      .find((m) => m.role === "user")!.text;
                    await start(ticket, question, state);
                  } else {
                    if (!text) return { status: 400, body: { error: "A follow-up is required." } };
                    ticket.messages.push({ role: "user", text, at: new Date().toISOString() });
                    await start(ticket, text, state);
                  }
                  return { body: ticket };
                });
              },
            },
          },
        };
      },
    },
  },
} satisfies WorkbenchPackage;
