# System prompt exposes Provider and Model ID; skills state the key-first premise

The Agent system prompt's Environment section now carries the session model reference, and the AI-app skills spell out the key-and-root prerequisites up front.

- The `# Environment` section gains `Provider: {{PROVIDER}}` and `Model ID: {{MODEL_ID}}` placeholders (the session model's provider group and upstream id, filled from the resolved model entry) right before `Session ID`, and the fields are reordered to `Project Dir → Agent ID → CWD → Provider → Model ID → Session ID`. `assembleSystemPrompt` / `SessionEnvironmentValues` / `sessionEnvironment` thread the two new values through; the configuration docs' placeholder table (en/zh) follows.
- penguin-sdk (v8) and agenthub-models (v5) open with the prerequisite: for AI-app development, have the user add the model API key in **this agent's key vault** *before* building, and keep the app's Penguin data root **inside the CWD workspace** (`--root ./penguin_data`), never `~/.penguin`; model ids can come from the penguin CLI catalog.
