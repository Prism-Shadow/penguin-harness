/**
 * Fake API keys for testing: the provider SDK requires a credential at **construction time**
 * (throwing "Missing credentials" if absent), and `createSession` constructs an LLM client for
 * the default model.
 *
 * The default model uses the OpenAI protocol (DeepSeek), so `OPENAI_API_KEY` must have a value;
 * Anthropic's is stubbed too, for test cases that explicitly specify a claude model. The keys
 * are only used to construct the client; tests never actually send a request. CI has no keys
 * at all, while most local dev machines do -- without stubbing, tests would "pass locally,
 * fail in CI."
 */
const KEYS = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"] as const;

/** Stubs in fake keys and returns a restore function (call it in afterEach). */
export function stubProviderKeys(): () => void {
  const prev = KEYS.map((k) => [k, process.env[k]] as const);
  for (const k of KEYS) process.env[k] = "test-key-not-used";
  return () => {
    for (const [k, v] of prev) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}
