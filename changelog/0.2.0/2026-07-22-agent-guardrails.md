# Reserved-port and API-key guardrails in the default system prompt

Two recurring failure patterns are now addressed in the default agent prompt.

## Reserved service ports

Agents occasionally freed a busy port by killing its listener — sometimes the harness's own services. The SDK now exports `DEFAULT_SERVER_PORT` and `RESERVED_PORTS` from core as the single source the CLI and server derive their defaults from (still runtime-overridable via `--port` / `PORT`). The prompt rule deliberately carries no hardcoded numbers: never kill a process you did not start — including PenguinHarness's own services — never take a harness service port for your own servers, and when a wanted port is busy, pick another free port instead of killing the listener.

## API auth/key errors: retry once, then ask

On an API authentication/authorization or API-key error (401/403, invalid or missing key), the agent retries at most once; if the error persists it stops calling tools and asks the user to update the key in the agent's vault or the model settings outside the chat — secret values never belong in the conversation. Updated secrets only take effect in the next conversation, so further retries cannot succeed — the prompt says so.

The default prompt is a seed for each agent's editable `system_config.yaml`: existing agents keep their current prompt; new agents get the rules.
