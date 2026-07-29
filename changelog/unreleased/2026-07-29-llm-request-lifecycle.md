# Core: a provider that ignores Stop can no longer wedge a Session

Pressing Stop mid-request could leave a Session running forever — no way to send, no way to compact, and a second Stop did nothing. Short of restarting, the Session was finished. Reported against Kimi.

The request loop already guarded half of this. Interrupting while the loop sits suspended at a `yield` — the common case, where the engine is blocked waiting for a tool approval — is caught by the abort check it runs before pulling from upstream again. Interrupting while the loop is **blocked inside the pull itself** was not covered: the provider's stream promise never settled, so nothing came back to check. The idle timer could not rescue it either, because by then the request's internal AbortController was already aborted and the timer's own abort was a no-op. Nothing was left to end the run.

The pull is now raced against a promise that settles the moment that controller aborts — whether the trigger was the user or the idle timer — so the request always closes out regardless of what upstream does. The abandoned stream is asked to close on a best-effort basis and deliberately not waited on: a stream that ignored its abort signal may well ignore that too. The terminal state is classified by which trigger fired, so Stop still ends the run as interrupted and an idle stall still ends it as a timeout that reconnects.

This is provider-agnostic on purpose. Whether a request terminates when its signal fires is the harness's guarantee to keep, not something to inherit from whichever SDK happens to be underneath.
