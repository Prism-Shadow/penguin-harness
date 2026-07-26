# LLM request errors surface their underlying cause

A failed LLM request used to record a bare, unactionable message like `terminated`. Node's `fetch` wraps the real transport failure as a `TypeError: terminated` and hangs the actual reason — a socket close, `ECONNRESET`, a provider aborting the stream — on the error's `cause`; taking only `.message` when building the request outcome threw that away.

The outcome message now walks the `cause` chain and appends each level's message and error `code`, so the same failure surfaces as e.g. `terminated: other side closed (UND_ERR_SOCKET)`. This flows straight through to the abort reason (`llm request error: …`), the Cost Center's recent-errors table, and Traces. Segments are de-duplicated, a non-Error cause tail is kept, and the walk guards against a cyclic `cause` chain. Covered by a `describeError` unit test.
