/**
 * Demo agent module, v1 (the agent.tar.gz stand-in: a single file a URL can
 * reach). Zero dependencies — everything heavy comes from the platform.
 *
 * Contract: `export const agent = { name, version, create(host, state) }`
 * where create returns `{ park(), run(input) }`. State is a plain JSON
 * document owned by the agent; upcasting older state shapes is the agent's
 * own business (see v2).
 */
export const agent = {
  name: "echo",
  version: 1,
  create(_host, state) {
    let calls = state !== null && typeof state === "object" ? (state.calls ?? 0) : 0;
    return {
      park: () => ({ calls }),
      run(input) {
        calls += 1;
        return { reply: `echo: ${JSON.stringify(input)}`, calls };
      },
    };
  },
};
