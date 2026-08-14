/**
 * Demo agent module, v2: louder replies, and the state document gains
 * `lastInput`. The old v1 state ({ calls }) is upcast by hand in create() —
 * agent-internal state versioning is the module's own business.
 */
export const agent = {
  name: "echo",
  version: 2,
  create(_host, state) {
    const old = state !== null && typeof state === "object" ? state : {};
    let calls = old.calls ?? 0;
    let lastInput = old.lastInput ?? null;
    return {
      park: () => ({ calls, lastInput }),
      run(input) {
        calls += 1;
        lastInput = input;
        return { reply: `ECHO!! ${JSON.stringify(input)}`, calls, lastInput };
      },
    };
  },
};
