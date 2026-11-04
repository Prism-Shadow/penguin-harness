import type { WorkbenchPackage, WorkbenchResponse } from "@prismshadow/penguin-server/plugin";

type Message = { role: "user" | "assistant"; text: string; at: string };
type Ticket = {
  id: string;
  title: string;
  status: "running" | "answered" | "resolved" | "open" | "failed";
  sessionId: string;
  messages: Message[];
  error: string | null;
  /** A person stopped its last task (the main Session's abort record said so); absent otherwise. */
  stopped?: boolean;
  createdAt: string;
  updatedAt: string;
};
type State = { tickets: Ticket[] };

/**
 * `host.subscribe` as this handler uses it. A server from before it has no such method and its
 * `.harness/` types do not name it, so the handler reads it through this shape and, without
 * it, leaves every answer to GET /tickets.
 */
type Subscribe = (
  sessionId: string,
  listener: (record: {
    origin?: string[];
    payload: { type?: unknown; error_code?: unknown };
  }) => void,
) => () => void;

/** The abort codes of a person interrupting a task; the turn cap's `max_turns` is not one. */
const STOP_CODES: ReadonlySet<unknown> = new Set([
  "user_abort",
  "backoff_interrupted",
  "compaction_interrupted",
]);

/** How often, and how many times, a Session that sent its task_end is checked for idle. */
const IDLE_CHECK_MS = 50;
const IDLE_CHECKS = 40;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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

        // The Sessions of running tickets, followed live so an answer is saved the moment its
        // task ends, whether or not the page is open. GET /tickets still reconciles: nothing is
        // followed across a server restart until the workbench loads again.
        const subscribe = (host as unknown as { subscribe?: unknown }).subscribe;
        const live = typeof subscribe === "function" ? (subscribe as Subscribe).bind(host) : null;
        const following = new Map<string, () => void>();
        /** Sessions whose current task a person stopped, until that task is reconciled. */
        const stopped = new Set<string>();
        const unfollow = (sessionId: string) => {
          following.get(sessionId)?.();
          following.delete(sessionId);
        };
        const idle = (sessionId: string) => {
          try {
            return host.sessionStatus(sessionId) === "idle";
          } catch {
            return true; // The Session is gone: reconciling marks the ticket failed.
          }
        };
        /** Moves a running ticket to its answer or failure; false while its Session still runs. */
        const reconcile = async (ticket: Ticket): Promise<boolean> => {
          try {
            const result = await host.sessionResult(ticket.sessionId);
            if (result.status === "running") return false;
            ticket.status = result.status === "completed" ? "answered" : "failed";
            ticket.error = result.error;
            if (result.status === "failed" && stopped.has(ticket.sessionId)) ticket.stopped = true;
            ticket.updatedAt = new Date().toISOString();
            if (result.status === "completed")
              ticket.messages.push({ role: "assistant", text: result.text, at: ticket.updatedAt });
          } catch (e) {
            ticket.status = "failed";
            ticket.error = e instanceof Error ? e.message : String(e);
          }
          stopped.delete(ticket.sessionId);
          unfollow(ticket.sessionId);
          return true;
        };
        // A task_end arrives before its Session reads idle, and sessionResult answers `running`
        // until it does: wait for idle first. A Session still busy after that (a queued
        // follow-up started) stays followed for its next task_end.
        const settle = async (sessionId: string) => {
          for (let i = 0; i < IDLE_CHECKS && !idle(sessionId); i++) await sleep(IDLE_CHECK_MS);
          await locked(async () => {
            const state = read();
            const ticket = state.tickets.find(
              (t) => t.sessionId === sessionId && t.status === "running",
            );
            if (!ticket) unfollow(sessionId);
            else if (await reconcile(ticket)) await save(state);
          });
        };
        const follow = (sessionId: string) => {
          if (!live || following.has(sessionId)) return;
          try {
            const stop = live(sessionId, (record) => {
              // Only the main Session's own records decide; a subagent's carry `origin`.
              if (record.origin?.length) return;
              const { type, error_code } = record.payload;
              if (type === "abort" && STOP_CODES.has(error_code)) stopped.add(sessionId);
              if (type !== "task_end") return;
              settle(sessionId).catch((e) =>
                host.log(`Could not save the answer of ${sessionId}: ${String(e)}`),
              );
            });
            following.set(sessionId, stop);
          } catch {
            // A Session outside this Project: GET /tickets records the failure on the ticket.
          }
        };
        // Reloads and restarts end every subscription; take up the questions still running.
        for (const ticket of read().tickets)
          if (ticket.status === "running") follow(ticket.sessionId);

        const start = async (ticket: Ticket, text: string, state: State) => {
          ticket.status = "running";
          ticket.error = null;
          delete ticket.stopped;
          stopped.delete(ticket.sessionId);
          ticket.updatedAt = new Date().toISOString();
          await save(state);
          // Before run: a subscription replays nothing, and a short task could end first.
          follow(ticket.sessionId);
          try {
            await host.run(ticket.sessionId, [{ text }]);
            ticket.title = host.sessionTitle(ticket.sessionId) ?? ticket.title;
            await save(state);
          } catch (e) {
            unfollow(ticket.sessionId);
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
                    // The fallback for a task_end nobody heard: one that ended while the
                    // server restarted or the workbench reloaded.
                    for (const ticket of state.tickets.filter((t) => t.status === "running"))
                      if (await reconcile(ticket)) changed = true;
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
