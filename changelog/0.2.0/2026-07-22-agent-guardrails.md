# Reserved-port and API-key guardrails in the default system prompt

Two recurring failure patterns are now addressed in the default agent prompt.

## Reserved service ports

Agents occasionally freed a busy port by killing its listener — sometimes the harness's own services. The SDK now exports `DEFAULT_SERVER_PORT` and `RESERVED_PORTS` (7364 main server / Web UI, 7365 web dev, 7366 landing dev, 7367 docs dev) from core; the CLI and server derive their defaults from the constant instead of hardcoding 7364. The prompt's kill rule now names these ports explicitly: never kill a process listening on them, and when a wanted port is busy, pick another free port rather than freeing it.

## API auth/key errors: retry once, then ask

On an API authentication/authorization or API-key error (401/403, invalid or missing key), the agent retries at most once; if the error persists it stops calling tools and asks the user to supply or update the key (`penguin config vault set` for per-agent secrets, `penguin config model add` for model credentials). Updated secrets only take effect in the next conversation, so further retries cannot succeed — the prompt says so.

The default prompt is a seed for each agent's editable `system_config.yaml`: existing agents keep their current prompt; new agents get the rules.
