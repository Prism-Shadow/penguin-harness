import type { WorkbenchPackage, WorkbenchResponse } from "@prismshadow/penguin-server/plugin";

export type Action = Record<string, unknown>;

export function requireValue(condition: unknown, code = "invalid"): asserts condition {
  if (!condition) throw new RangeError(code);
}

export function text(value: unknown, max = 100, optional = false): string {
  requireValue(typeof value === "string" && value.length <= max && (optional || value.trim()));
  return value.trim();
}

export function integer(value: unknown, min: number, max: number): number {
  requireValue(
    typeof value === "number" && Number.isInteger(value) && value >= min && value <= max,
  );
  return value;
}

export function date(value: unknown): string {
  const day = text(value, 10);
  requireValue(/^\d{4}-\d{2}-\d{2}$/.test(day));
  const time = Date.parse(day);
  requireValue(Number.isFinite(time) && new Date(time).toISOString().startsWith(day));
  return day;
}

export function workbench<State>(
  initial: State,
  change: (state: State, action: Action) => void,
): WorkbenchPackage {
  return {
    modules: {
      Workbench: {
        create({ use: { host } }) {
          type Saved = { revision: number; state: State };
          const read = () => (host.getState() as Saved | null) ?? { revision: 0, state: initial };
          let queue: Promise<unknown> = Promise.resolve();
          return {
            api: {
              main: {
                async handle(req): Promise<WorkbenchResponse> {
                  if (req.path !== "/state") return { status: 404, body: { error: "missing" } };
                  if (req.method === "GET") return { body: read() };
                  if (req.method !== "POST") return { status: 405, body: { error: "method" } };
                  const update = async (): Promise<WorkbenchResponse> => {
                    const saved = read();
                    const action = req.body as Action | null;
                    if (!action || typeof action !== "object")
                      return { status: 400, body: { error: "invalid" } };
                    if (action.revision !== saved.revision)
                      return { status: 409, body: { error: "conflict", ...saved } };
                    // A failed disk write or invalid action must not mutate the live host state.
                    const state = structuredClone(saved.state);
                    try {
                      change(state, action);
                    } catch (err) {
                      if (err instanceof RangeError)
                        return { status: 400, body: { error: err.message } };
                      throw err;
                    }
                    const next = { revision: saved.revision + 1, state };
                    await host.setState(next);
                    return { body: next };
                  };
                  const result = queue.then(update);
                  queue = result.catch(() => {});
                  return result;
                },
              },
            },
          };
        },
      },
    },
  };
}
